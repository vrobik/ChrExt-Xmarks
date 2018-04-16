/*
 Copyright 2007-2008 Foxmarks Inc.

 foxmarks-nodes.js: implements class Node and Nodeset, encapsulating
 our datamodel for the bookmarks.

 */

// To do:
// * Add integrity checking to commands
// * We're currently filtering out modified- and visited-only updates
//   in the Compare algorithm. This is okay for modified but probably
//   inappropriate for visited: visited will only get updated when some
//   other attribute of the node changes, which may never happen. On the
//   other hand, we don't want to sync every change to last visited. We
//   may want to do something like a standard sync and a thorough sync;
//   do a thorough sync either once a week or randomly 1 in 10 times. The
//   thorough sync is when we'd perpetuate the last-visit updates.
// * In merge algorithm, special treatment for toolbar folders.

// Module-wide constants

var NODE_ROOT     = "ROOT";
var PERMS_FILE    = 0644;
var MODE_RDONLY   = 0x01;
var MODE_WRONLY   = 0x02;
var MODE_CREATE   = 0x08;
var MODE_APPEND   = 0x10;
var MODE_TRUNCATE = 0x20;


function encode_utf8(s)
{
    return unescape(encodeURIComponent(s));
}

function decode_utf8(s)
{
    return decodeURIComponent(escape(s));
}


// class Node

function Node(nid, attrs) {
    this.nid = nid;
    for (a in attrs) {
        if (attrs.hasOwnProperty(a)) this[a] = attrs[a];
    }
    // TODO: remove all the assumptions that ntype will be a bookmark
    if (!this.ntype)
        this.ntype = "bookmark";
    //if (!this.ntype)
    //    throw("Node.ntype now required");
}

Node.prototype = {
    constructor: Node,

    toSource: function() {
        if (!this.ntype)
            throw("Node.ntype now required");
        return 'new Node("' + this.nid + '",' + 
            JSON.stringify(this.GetSafeAttrs(true)) + ')';
    },

    GetSafeAttrs: function(withChildren) {
        var attrs = {};

        for (var attr in this) {
            if (this.hasOwnProperty(attr) && attr != 'nid' &&
                attr != 'private' && attr != 'dbkey') {
                if (withChildren || attr != 'children') {
                    attrs[attr] = this[attr];
                }
            }
        }

        return attrs;
    },

    FindChild: function(nid) {
        if (this["children"]) {
            return this.children.indexOf(nid);
        } else {
            return -1;
        }
    },

    // Merge the contents of another node into this node.
    // Ignore structural attributes (like nid, pnid, children)
    // and pay special attention to tags, giving consideration
    // to individual tags within each tag list.
    Merge: function(other) {
        var attrs = other.GetSafeAttrs();
        var self = this;
        for (var attr in attrs) {
            if (!attrs.hasOwnProperty(attr)) {
               continue;
            }
            if (attr == 'tags' && self.tags) {
                var modified = false;
                other.tags.forEach(function(t) {
                    if (self.tags.indexOf(t) < 0) {
                        self.tags.push(t);
                        modified = true;
                    }
                });
                if (modified) {
                    self.tags.sort();
                }
            } else {
                if (!self[attr]) {
                    self[attr] = other[attr];
                }
            }
        }
    },

    // Hash this node, with the property that any attributes that
    // we are interested in syncing, and all child hashes, are
    // covered by the digest.  We only compute one level; it is assumed
    // this is called in leaves-up manner via a post-order DFS.
    ComputeHash: function(nodeset, hash_attrs) {

        elements = [];
        for (var i = 0; i < hash_attrs.length; i++) {
            attr = hash_attrs[i];
            elements.push(encode_utf8(this[attr] || ""));
        }

        var hashstr = elements.join(",");

        children = this.children || [];

        for (var i = 0; i < children.length; i++) {
            cnid = children[i];
            hashstr += "_" + nodeset.Node(cnid).hash;
        }

        this.hash = hex_md5(hashstr);
    }

};

// class Nodeset

function Nodeset(datasource, cloneSource) {
    if(datasource === undefined || datasource instanceof Nodeset)
        throw("Nodeset() -- datasource is required");

    this.hash = null;
    this._datasource = datasource;
    this._cloneSource = cloneSource;
    this._node = {};
    this._callback = null;
    this._length = cloneSource ? cloneSource.length : 0;
    this._hashmap = [];
    this._inserts = [];
}



Nodeset.FetchAdd = function(node) {
    this.AddNode(node);
}

Nodeset.FetchComplete = function(status) {
    this._children = null;

    // Reapply missing nodes or attribute updates
    var base = Xmarks.Settings.GetBaseline(this._baselineSuffix);
    if (base) {
        var nonChromeCommands = base.GetNonChromeCommands();
        this.ApplyCommandsWithFallback(nonChromeCommands, base);
        
        // Reset root's name
        var baseRootName = base.Node(NODE_ROOT).name;
        var ourRoot = this.Node(NODE_ROOT, true);
        if (baseRootName) {
            ourRoot.name = baseRootName;
        } else {
            delete ourRoot.name;
        }
    }

    this.callback(this.corrupt ? 1006 : status);
    this.callback = null;
}

var ct = {}
Nodeset.Continue = {
    notify: function(timer) {
        var set = ct.self;
        var nids = ct.nids;
        var result;
        var s = Date.now();
        while (nids.length > 0 && Date.now() - s < 100) {
            var next = nids.shift();
            var nid = next[0];
            var pnid = next[1];

            if (!set.Node(nid, false, true)) {
                Xmarks.LogWrite("Warning: OnTree() was about to reference " +
                    nid + " which doesn't exist");
                break;
            }

            try {
                result = ct.action.apply(ct.Caller, [nid, pnid]);
            } catch (e) {
                if(typeof e == "number"){
                    result = e;
                } else {
                    Xmarks.LogWrite("OnTree error (notify): " + JSON.stringify(e) + " e:" + e);
                    result = "3; exception: " + e;
                }
            }

            if (result)
                break;

            // if action above deleted nid...
            if (set.Node(nid, false, true) == null)
                continue;

            if (set.Node(nid).ntype == "folder") {
                var children = set.Node(nid).children;
                var ix = 0;
                for (var child in children) {
                    if (!children.hasOwnProperty(child))
                        continue;
                    if (ct.depthfirst) {
                        nids.splice(ix++, 0, [children[child], nid]);
                    } else {
                        nids.push([children[child], nid]);
                    }
                }
            }
        }

        if (nids.length > 0 && !result) {
            timer.initWithCallback(Nodeset.Continue, 10,
                Ci.nsITimer.TYPE_ONE_SHOT);
        } else {
            ct.complete.apply(ct.Caller, [result]);
        }
    }
}

Nodeset.prototype = {
    constructor: Nodeset,

    get length() {
        return this._length;
    },

    NodeName: function(nid) {
        var node = this.Node(nid, false, true);

        if (node && node.name) {
            return node.name + "(" + nid + ")";
        } else {
            return nid;
        }
    },
    handleNidConflict: function(lnode, snode, conflicts){
        return this._datasource.handleNidConflict(lnode, snode, conflicts);
    },
        
    AddNode: function(node) {
        if (this._children && node.children) {
            var self = this;
            for (var index = 0; index < node.children.length; index++) {
                var cnid = node.children[index];
                if (self._children[cnid] != undefined) {
                    node.children.splice(index--, 1);
                    Xmarks.LogWrite("Warning: Filtering " + self.NodeName(cnid) + 
                            " as a corrupted duplicate in parent " +
                            node["name"] + " (" + node.nid + ")");
                } else {
                    self._children[cnid] = true;
                }
            }
        }   

        if (this._node[node.nid]) { // Oh oh! Node already exists.
            Xmarks.LogWrite("Warning: Node " + this.NodeName(node.nid) +
                    " in folder " + this.NodeName(node.pnid) + 
                    " already exists in folder " +
                    this.NodeName(this._node[node.nid].pnid));
            // Log error only; don't prevent sync as cleanup happened above
            // this.corrupt = true;
            return;
        }
        this._node[node.nid] = node;
        this._length++;
    },

    FetchFromNative: function(baselineSuffix, callback) {
        this._children = {}
        // this.source = new NativeDatasource();
        this.callback = callback;
        this._baselineSuffix = baselineSuffix;
        this._datasource.ProvideNodes(this, Nodeset.FetchAdd, Nodeset.FetchComplete);
    },

    BaselineLoaded: function(baseline, callback) {
        return this._datasource.BaselineLoaded(baseline, callback);
    },
    FlushToNative: function(callback) {
        // var source = new NativeDatasource();
        this._datasource.AcceptNodes(this, callback);
        return;
    },
    ClearNative: function(callback) {
        this._datasource.ClearLocalStore(callback);
        return;
    },

    ProvideCommandset: function(callback) {
        var self = this;
        var cs = new Commandset();

            
        function Add(nid, pnid) {
            cs.append(new Command("insert", nid,
                self.Node(nid).GetSafeAttrs()));
            return 0;
        }

        function Done(status) {
            callback(status, cs);
        }

        this.OnTree(Add, Done);
        return;
    },

    ProvideHashes: function(callback) {
        var self = this;
        var hashes = [];

        this.OnTree(Add, Done);
        return;

        function Add(nid, pnid) {
            // the only attrs we need to pass back:
            //   - hash
            //   - nid (key)
            //   - pnid
            //   - children
            node = self.Node(nid);
            hashes.push({ "nid" : nid,
                          "pnid" : node.pnid || '',
                          "children" : node.children || [],
                          "hash" : node.hash });
            return 0;
        }

        function Done(status) {
            callback(status, hashes);
        }
    },

    _GetFile: function() {
        var file = Cc['@mozilla.org/file/directory_service;1']
            .getService(Ci.nsIProperties)
            .get('ProfD', Ci.nsIFile);

        file.append(this._datasource.getBaselineName());
        return file;
    },

    GetNonChromeCommands: function() {
        // TODO: also remove unid if there are no children
        Xmarks.LogWrite("Generating non-Chrome Command set");
        var self = this;
        var allCommands = new Commandset();

        var root = this.Node(NODE_ROOT);
        if (root.name) {
            allCommands.append(new Command("update", NODE_ROOT, {"name": root.name}));
        }

        if (root.tnid && this.Node(root.tnid, false, true) != null) {
            var tnid = this.Node(root.tnid);
            if (tnid.name) {
                allCommands.append(new Command("update", tnid.nid, {"name": tnid.name}));
            }
            
            // Make sure we move it to the correct place too
            var nextNid = FindNextChild(tnid.nid);
            if (tnid.pnid != NODE_ROOT) {
                allCommands.append(new Command("move", tnid.nid, {"pnid": tnid.pnid, "bnid": nextNid}));
            } else {
                // Note: nextNid may be "", which is okay; this forces the node to go to the end of list
                allCommands.append(new Command("reorder", tnid.nid, {"pnid": NODE_ROOT, "bnid": nextNid}));
            }
        }
        if (root.unid) {
            allCommands.append(new Command("update", NODE_ROOT, {"unid": root.unid}));
        }

        GenerateCommandsForNid(NODE_ROOT);
        return allCommands;

        function GenerateCommandsForNid(aNid) {
            var children = self.Node(aNid).children || [];
            for (var i = 0; i < children.length; i++) {
                var aNode = self.Node(children[i]);
                if (aNode.ntype != "bookmark" && aNode.ntype != "folder" && aNode.ntype != "password") {
                    // A ntype that Chrome doesn't write, generate insert command for it
                    var aCommand = new Command("insert", aNode.nid, aNode.GetSafeAttrs());
                    var nextNid = FindNextChild(aNode.nid);
                    if (nextNid != "") {
                        aCommand.args["bnid"] = nextNid;
                    }

                    allCommands.append(aCommand);
                } else if (aNode.ntype == "bookmark") {
                    if (!Xmarks.IsValidChromeBookmark(aNode.url, aNode.shortcuturl)) {
                        // A bookmark with an invalid URL, Chrome can't handle it
                        var aCommand = new Command("insert", aNode.nid, aNode.GetSafeAttrs());
                        var nextNid = FindNextChild(aNode.nid);
                        if (nextNid != "") {
                            aCommand.args["bnid"] = nextNid;
                        }

                        allCommands.append(aCommand);
                    }
                } else if (aNode.ntype == "folder") {
                    GenerateCommandsForNid(aNode.nid);
                }
            }
        }

        function FindNextChild(nid) {
            var child = self.Node(nid);
            var allChildren = self.Node(child.pnid).children;
            for (var i = 0; i < allChildren.length - 1; i++) {
                if (allChildren[i] == nid) {
                    return allChildren[i + 1];
                }
            }

            return "";
        }
    },

    //
    // Apply commands to us.  If bnids or pnids can't be found, attempt to gracefully find spot to insert
    //
    ApplyCommandsWithFallback: function(commands, baseline) {
        Xmarks.LogWrite("Applying intermediate commands");
        
        // Apply in reverse order because command[i] may reference command[i + 1] as a BNID.
        for (var i = commands.length - 1; i >= 0; i--) {
            var aCommand = commands.set[i];
            Xmarks.LogWrite("Processing " + JSON.stringify(aCommand));

            if (aCommand.action != "insert" && this.Node(aCommand.nid, false, true) == null) {
                Xmarks.LogWrite("NID no longer exists, ignoring command");
                continue;
            }

            var pnid = aCommand.args["pnid"];
            var bnid = aCommand.args["bnid"];
            if (aCommand.action == "insert" || aCommand.action == "move") {
                if (!pnid || this.Node(pnid, false, true) == null) {
                    // No pnid or pnid no longer exists in the local datasource.
                    // No need to reinsert this node
                    Xmarks.LogWrite("No pnid in local nodeset, skipping command");
                    continue;
                }
            } 

            var localBnid = this.Node(bnid, false, true);
            if (bnid && (localBnid == null || localBnid.pnid != pnid)) {
                 // Command has bnid that no longer exists in the this folder (or no longer exists at all).
                 // Find a new BNID by walking through the children of pnid of the original baseline.  The
                 // first node in that list that exists in the new nodeset (and in the correct folder) is
                 // our new BNID.
                 // Note: if no new BNID is found, setting an empty string is okay (it will be appended to the end).
                 var newBnid = "";

                 if (baseline.Node(bnid) != null) {
                    // bnid is in baseline, find the next child that also exists in ns
                    var baselineParent = baseline.Node(pnid);
                    var originalIndex = GetChildIndex(baselineParent, aCommand.nid);
                    while (++originalIndex < baselineParent.children.length) {
                        var potentialBnid = baselineParent.children[originalIndex];
                        var potentialNode = self.Node(potentialBnid, false, true);
                        if (potentialNode != null && potentialNode.pnid == pnid) {
                            // ns has this node in the right folder, this is our new bnid
                            newBnid = potentialBnid;
                            break;
                        }
                    }
                }

                Xmarks.LogWrite("Replacing invalid BNID with: [" + newBnid + "]");
                aCommand.args["bnid"] = newBnid;
            }

            try {
                this.Execute(aCommand);
            } catch (ex) {
                Xmarks.LogWrite("Error applying command during ApplyCommandsWithFallback: " + JSON.stringify(ex));
            }
        }

        function GetChildIndex(pnode, childNid) {
            var parentChildren = pnode.children || [];
            for (var i = 0; i < parentChildren.length; i++) {
                if (parentChildren[i] == childNid) {
                    return i;
                }
            }

            return -1;
        }
    },

    SaveToFile: function(callback) {

        var self = this;
        var first = true;

        var file = this._GetFile();

        var fstream = Cc["@mozilla.org/network/safe-file-output-stream;1"]
            .createInstance(Ci.nsIFileOutputStream);
        fstream.init(file, (MODE_WRONLY | MODE_TRUNCATE | MODE_CREATE), 
            PERMS_FILE, 0);

        var cstream = Cc["@mozilla.org/intl/converter-output-stream;1"]
            .createInstance(Ci.nsIConverterOutputStream);
        cstream.init(fstream, "UTF-8", 0, 0x0000);

        cstream.writeString('({ version:"'+ Xmarks.FoxmarksVersion() +
                '", currentRevision:' + self.currentRevision + 
                ', _node: {' );


        function WriteNode(nid, pnid) {
            var node = self.Node(nid);
            cstream.writeString((first ? "" : ",") + 
                    "'" + nid.replace(/'/g, "\\'") + "'" + ":" + 
                    node.toSource());
            first = false;
            return 0;
        }

        function WriteDone(status) {
            if (!status) {
                cstream.writeString("}})");
                // Flush the character converter, then finish the file stream,
                // guaranteeing that an existing file isn't overwritten unless
                // the whole thing succeeds.
                cstream.flush();            
                try {
                    fstream.QueryInterface(Ci.nsISafeOutputStream).finish();
                } catch (e) {
                    fstream.close();
                    Xmarks.LogWrite("Error in Writing: " + e.message);
                    status = 1009;
                }
            }
            callback(status);
        }
        this.OnTree(WriteNode, WriteDone);
        return;
    },
    

    LoadFromFile: function() {
        var file = this._GetFile();
        var fstream = Cc["@mozilla.org/network/file-input-stream;1"]
            .createInstance(Ci.nsIFileInputStream);
        fstream.init(file, MODE_RDONLY, PERMS_FILE, 0);
        var cstream = Cc["@mozilla.org/intl/converter-input-stream;1"]
            .createInstance(Ci.nsIConverterInputStream);
        cstream.init(fstream, "UTF-8", 32768, 0xFFFD);
        var str = {}; 
        
        var contents = "";

        while (cstream.readString(32768, str) != 0) {
            contents += str.value;
        }
        fstream.close();
        cstream.close();

        var result = eval(contents);

        if (result["version"]) {
            this._node = result._node;
            this.currentRevision = result.currentRevision;
            this.version = result.version;
        } else {    // For backwards compatibility
            this._node = result;
            Xmarks.LogWrite("Baseline file has no currentRevision");
            //this.currentRevision = Xmarks.settings.GetSyncRevision(this._datasource.syncType);
        }

        var self = this;
        self._length = 0;
        forEach(this._node, function() { self._length++; } );
    },


    Declone: function(callback) {
        // If we are cloned from some other nodeset, copy any references
        // we currently hold from the clonesource into ourselves and
        // break the clonesource relationship.
        // This must be done before serializing a nodeset to disk.

        var self = this;


        function CopyNode(nid, pnid) {
            if (self._node[nid] === undefined) {
                self._node[nid] = self._cloneSource.Node(nid);
            }
            return 0;
        }

        function Done(status) {
            if (!status) {
                self._cloneSource = null;
                forEach(self._node, 
                    function(v, k) { if (!v) delete self._node[k]; } ); 
            }
            callback(status);
        }

        if (!this._cloneSource) {
            callback(0);
        } else {
            this.OnTree(CopyNode, Done);
        }
        return;
    },

    // Node returns the node with the given nid.
    // If you intend to modify the returned node,
    // set "write" true; this will do a "copy on write"
    // from the clone source if one has been set.
    // If node specified is not found, throws an exception
    // unless "nullOkay" is true, in which case it returns null.

    Node: function(nid, write, nullOkay) {
        if (nid in this._node) {
            return this._node[nid];
        } else if (this._cloneSource) {
            var node = this._cloneSource.Node(nid, false, nullOkay);
            if (!node || !write) {
                return node;
            } else {
                var newNode = node.clone(true);
                if(newNode['private'])
                    delete newNode['private'];
                this.AddNode(newNode);
                return newNode;
            }
        } else {
            if (nullOkay)
                return null;
            else
                throw Error("Node not found: " + nid);
        }
    },

    HasAncestor: function(nid, pnid) {
        while (nid) {
            var node = this.Node(nid, false, true);
            if (!node) {
                Xmarks.LogWrite("Whoops! HasAncestor tried to reference " + nid +
                        " which doesn't exist");
                throw Error("HasAncestor bad nid " + nid);
            }
            nid = node.pnid;
            if (nid == pnid)
                return true;
        }
        return false;
    },

    // Find next sibling in this folder that also exists in other's folder
    NextSibling: function(nid, other) {
        var pnid = this.Node(nid).pnid;
        var oursibs = this.Node(pnid).children;
        var othersibs = other.Node(pnid).children;

        for (var i = oursibs.indexOf(nid) + 1; i < oursibs.length; ++i) {
            var sib = oursibs[i];
            if (othersibs.indexOf(sib) >= 0) {
                return sib;
            }
        }

        return null;
    },

    InsertInParent: function(nid, pnid, bnid) {
        if (nid == NODE_ROOT && (pnid == null || pnid=="")) {
            return; // Fail silently.
        }

        if (!nid)
            throw Error("bad nid");

        if (!pnid){
            throw Error("bad pnid for nid " + nid + " pnid: " + pnid + " typeof:" + typeof(pnid));
        }

        var pnode = this.Node(pnid, true);
        if (typeof pnode["children"] == "undefined") {
            pnode.children = [];
        }
        if (pnode.children.indexOf(nid) >= 0) {
            throw Error("child " + nid + " already exists in parent " + pnid);
        }
        if (bnid) {
            var i = pnode.children.indexOf(bnid);
            if (i >= 0) {
                pnode.children.splice(i, 0, nid);
            } else {
                throw Error("didn't find child " + bnid + " in parent " + pnid);
            }
        } else {
            pnode.children.push(nid);
        }
        this.Node(nid, true).pnid = pnid;
    },            

    RemoveFromParent: function(nid) {
        var node = this.Node(nid, true);
        if (!node.pnid) {
            Xmarks.LogWrite("node.pnid is undefined for " + node.name);
        }
        var pnode = this.Node(node.pnid, true);
        var i = pnode.FindChild(nid);

        if (i >= 0) {
            pnode.children.splice(i, 1);
        } else {
            Xmarks.LogWrite("didn't find child " + nid + " in parent " + node.pnid);
        }
        node.pnid = null;
    },

    Do_insert: function(nid, args /* pnid, bnid, ntype, etc. */) {
//        Xmarks.LogWrite("inserting " + nid + " " + args.toSource());
        if (this.Node(nid, false, true) != null) {
            var nargs = this.Node(nid).GetSafeAttrs();
            var conflict = false;
            forEach(args, function(value, attr) {
                if (nargs[attr] && value != nargs[attr]) {
                    conflict = true;
                }
            } );
            if (conflict) {
                throw Error("Tried to insert a node that already exists");
            } else {
                return; // In the interests of being accomodating, we're going
                        // to let this one slide by. But make sure it doesn't
                        // happen again, mkay?
            }
        }
        var node = new Node(nid);

        for (attr in args) {
            if (args.hasOwnProperty(attr) && 
                    attr != 'pnid' && attr != 'bnid' && attr != 'children') {
                node[attr] = args[attr];
            }
        }

        this.AddNode(node);
        this.InsertInParent(nid, args.pnid, args.bnid);
    },

    Do_delete: function(nid) {
        var self = this;
//        Xmarks.LogWrite("deleting " + this.NodeName(nid));

        // Be careful here: only the top-level node has to be
        // removed from its parent. That node and its descendants
        // need to be nulled out.

        function NukeNode(nid) {
            var node = self.Node(nid);
            if (node.children) {
                for (var n = 0; n < node.children.length; ++n)
                    NukeNode(node.children[n]);
            }
            if (self._cloneSource) {
                self._node[nid] = null; // If cloned, shadow deletion.
            } else {
                delete self._node[nid]; // Otherwise, delete it outright.
            }
            self._length--;
        }

        self.RemoveFromParent(nid);
        NukeNode(nid);
    },

    Do_move: function(nid, args /* pnid, bnid */) {
//        Xmarks.LogWrite("moving " + this.NodeName(nid));

        this.RemoveFromParent(nid);
        this.InsertInParent(nid, args.pnid, args.bnid);
    },

    Do_reorder: function(nid, args /* bnid */) {
//        Xmarks.LogWrite("reordering " + this.NodeName(nid) + " before " + 
//                this.NodeName(args.bnid));
        var pnid = this.Node(nid).pnid;
        if (!pnid) {
            Xmarks.LogWrite("node.pnid is undefined for " + this.Node(nid).name);
        }
        this.RemoveFromParent(nid);
        this.InsertInParent(nid, pnid, args.bnid);
    },

    Do_update: function(nid, args /* attrs */) {
//        Xmarks.LogWrite("updating " + this.NodeName(nid));
        var node = this.Node(nid, true);

        forEach(args, function(value, attr) {
            if (value) {
                node[attr] = value;
            } else {
                delete node[attr];
            }
        } );
    },

    // Pass either a single command or a Commandset.
    Execute: function(command) {
        if (command instanceof Commandset) {
            var self = this;
            forEach(command.set, function(c) {
                self.Execute(c);
            } );
            return;
        }

        var method = this["Do_" + command.action];
        try {
            method.apply(this, [command.nid, command.args]);
        } catch (e) {
            if (typeof e == "number") {
                throw e;
            } else {
                throw Error("Failed executing command " + JSON.stringify(command) + "; error is " + JSON.stringify(e) + " e: " +e);
            }
        }
    },
    OrderIsImportant: function(){
        return this._datasource.orderIsImportant;
    },

    // traverses this's bookmarks hierarchy starting with
    // startnode, calling action(node) for each node in the tree,
    // then calling complete() when traversal is done.
    // enforces rules about maximum run times to prevent hanging the UI
    // when traversing large trees or when running on slow CPU's.
    // action() should return 0 to continue, non-zero status to abort.
    // complete() is called with status, non-zero if aborted.
    // depthfirst determines tree traversal order
    // use postorder to visit leaves before parents

    OnTree: function(action, complete, startnid, depthfirst, postorder) {
        var nids = [[startnid || NODE_ROOT, null]];
        var visited = {};
        var result;

        while (nids.length > 0) {
            var next = nids.shift();
            var nid = next[0];
            var pnid = next[1];

            if (!this.Node(nid, false, true)) {
                Xmarks.LogWrite("Warning: OnTree() was about to reference " + nid + " which doesn't exist");
                break;
            }

            try {
                // for post-order traversal, we skip the first time we
                // see this nid; subsequently we'll push it along with our
                // children.  Once children are processed, we'll see it again
                // and then we process it, and can remove it from the visit
                // list.
                if (!postorder || visited[nid])
                  result = action.apply(this, [nid, pnid]);
            } catch (e) {
                if(typeof e == "number"){
                    result = e;
                } else {
                    Xmarks.LogWrite("OnTree error (function) " + e);
                    result = "3; exception: " + e;
                }
            }

            if (result)
                break;

            // if action above deleted nid...
            if (this.Node(nid, false, true) == null)
                continue;

            if (postorder && visited[nid])
            {
                delete visited[nid];
                continue;
            }
            var ix = 0;
            if (this.Node(nid).ntype == "folder") {
                var children = this.Node(nid).children;
                for (var child in children) {
                    if (!children.hasOwnProperty(child))
                        continue;
                    if (depthfirst) {
                        nids.splice(ix++, 0, [children[child], nid]);
                    } else {
                        nids.push([children[child], nid]);
                    }
                }
            }
            if (postorder)
            {
                // add back this nid so we process it after children
                visited[nid] = true;
                if (depthfirst)
                    nids.splice(ix, 0, [nid, pnid]);
                else
                    nids.push([nid, pnid]);
            }
        }

        complete.apply(this, [result]);
    },

    IGNORABLE: { created: true, visited: true, modified: true },

    //
    // Search for duplicate nodes being added in `other` nodeset
    // that already exist in ours.  (An added node is one whose _nid_
    // doesn't exist in this nodeset, but does in other... note that
    // we are searching based on path, rather than nid.)
    //
    // If found, will attempt to delete and remove from other (so
    // the appropriate command is sent to the server)
    //
    RemoveDuplicates: function(inserted, other, commandset){

      //construct path map of other nodeset
      var self = this;
      self._hashmap = [];       // path -> nid, for *this* nodeset
      self._inserts = [];       // list of all paths for *other* nodeset
      self._addednids = [];     // nid -> 1, for nids added in other

      //
      // for nids inserted into `other`, compute leaf to root path
      // based on titles, e.g.
      //
      // bookmark/parent3/parent2/parent1/root
      //
      for(var i = 0; i < inserted.length; i++){
        var nid = inserted[i];
        var path = HashFullPaths(nid, other.Node(nid).pnid, other, true);
        self._inserts[self._inserts.length] = path;
        self._addednids[nid] = 1;
      }
      self.OnTree(HashFullPaths, CheckDups);

      // given `nid` with a parent nid `pnid` in the nodeset `ns`,
      // construct the leaf-to-root patch and update self._hashmap
      // accordingly.  If `ret` is passed, we just return the path
      // rather than storing in _hashmap.
      function HashFullPaths(nid, pnid, ns, ret){
        if(!ns) ns = self;
        var key = "";
        var foldernid = pnid;
        //Walk up the tree and construct the full path
        while(foldernid!=null && foldernid!=""){
          key = ns.Node(foldernid).name + "/" + key;
          foldernid = ns.Node(foldernid).pnid;
        }
        var n = ns.Node(nid);
        key += n.name + (n.ntype=="folder" ? "" : n.url);
        if(!ret){
          if(typeof(self._addednids[nid])=="undefined")
            self._hashmap[key] = nid;
        }else{
           return key;
        }
      }

      //
      // Iterate over all the paths that we have inserted into other,
      // and check to see if the same path exists here.
      //
      // If the same path exists locally, and is not a special bookmark
      // (like tnid), then we delete the local node from disk.  We also delete
      // the nid from other, so that it will appear as a deletion command
      // when we compare other to us (that is: delete the local bookmark
      // with the same path as one coming from the server).
      //
      function CheckDups(){
        for(var i = 0; i < self._inserts.length; i++){
          var path = self._inserts[i];
          if(typeof(self._hashmap[path])!='undefined'){
            //duplicate found!
            var nid = self._hashmap[path];

            try{
              var donotdelete = [
                other.Node(NODE_ROOT, false, true).tnid,
                self.Node(NODE_ROOT, false, true).tnid,
                other.Node(NODE_ROOT, false, true).unid,
                self.Node(NODE_ROOT, false, true).unid];
              if(nid==donotdelete[0] || nid==donotdelete[1] || nid==donotdelete[2] || nid==donotdelete[3])
                continue;

              console.error("FOUND DUPLICATE! " + nid);
              var nativ = other._datasource.MapNid(nid);
              chrome.bookmarks.remove(nativ);
              other._datasource.RemoveFromMap(nativ);
            }catch(e){
            }
          }
        }
      }
    },



    // Compare this nodeset with another, returning a canonical list
    // of commands that transforms this nodeset into the specified one.
    // Note that at the successful conclusion of this routine, this
    // nodeset will be transformed to match the specified nodeset.
    Compare: function(other, callback) {
        var self = this;
        var commandset = new Commandset();
        
        function FindReordersInsertsMoves(nid, pid) {
            if (self.Node(nid).ntype != "folder")
                return 0;

            var snode = self.Node(nid);
            var onode = other.Node(nid, false, true);
            if (!onode) // Deleted; don't worry about children.
                return 0;

            var us = snode.children ? snode.children.slice() : [];
            var them = onode.children ? onode.children.slice() : [];

            // Reduce us and them to intersections
            us = us.filter(function(x) { return them.indexOf(x) >= 0; } );
            them = them.filter(function(x) { return us.indexOf(x) >= 0; } );

            if (us.length != them.length) {
                Xmarks.LogWrite("Error: intersections of unequal length for " +
                        self.NodeName(nid));
                Xmarks.LogWrite("us   = " + us);
                Xmarks.LogWrite("them = " + them);
                throw Error("Intersections of unequal length");
            }

            // Reorder us according to them
            if(self._datasource.orderIsImportant){
                for (var i = 0; i < us.length; ++i) {
                    if (us[i] != them[i]) {
                        var command = new Command("reorder", them[i], 
                            { bnid: us[i] });
                        commandset.append(command);
                        self.Execute(command);
                        // Simulate reorder in our intersected list
                        us.splice(us.indexOf(them[i]), 1);
                        us.splice(i, 0, them[i]);
                    }
                }
            }


            // Walk through them to find inserts and moves
            var sc = self.Node(nid).children || [];     // (May have changed)
            var oc = onode.children || [];
            var inserted = [];
            for (var index = 0; index < oc.length; index++) {
                function FindBnid(index) {
                    var oc = onode.children;
                    var len = oc.length;
                    while (index < len && us.indexOf(oc[index]) < 0) {
                        ++index;
                    }
                    return index < len ? oc[index] : null;
                }

                var child = oc[index];

                if (sc.indexOf(child) < 0) {    // ... missing from us
                    if (self.Node(child, false, true)) {    // ... but exists in set
                        var command = new Command("move", child, 
                            { pnid: nid, bnid: FindBnid(index + 1) } );
                        commandset.append(command);
                        self.Execute(command);
                    } else {                                // ... missing entirely
                        var attrs = other.Node(child).GetSafeAttrs();
                        attrs.bnid = FindBnid(index + 1);
                        var command = new Command("insert", child, attrs);
                        commandset.append(command);
                        self.Execute(command);
                        inserted[inserted.length] = other.Node(child).nid;
                    }
                }

            }

            if(inserted.length > 0){
              self.RemoveDuplicates(inserted, other, commandset);
            }

            return 0;
        }

        function FindDeletes(nid, pnid) {
            if (!other.Node(nid, false, true)) {
                var command = new Command("delete", nid);
                commandset.append(command);
                self.Execute(command);
            }
            return 0;
        }

        function FindUpdates(nid, pnid) {
            var result = 0;
            try {
                var snode = self.Node(nid);
                var onode = other.Node(nid);
                var attrs = {};
                if (self._datasource.compareNodes(snode, onode, attrs)) {
                    var command = new Command("update", nid, attrs);
                    commandset.append(command);
                    self.Execute(command);
                }
            } catch (e){
                if(typeof e != "number"){
                    result = 4;
                } else {
                    result = e;
                }
            }
            return result;
        }

        // There IS no step 3.

        function Step5(status) {
            if (status) {
                callback(status);
            } else {
                callback(0, commandset);
            }
        }


        function Step4(status) {
            if (status) {
                callback(status);
            } else {
                self.OnTree(FindUpdates, Step5);
            }
        }

        function Step2(status) {
            if (status) {
                callback(status);
            } else {
                self.OnTree(FindDeletes, Step4);
            }
        } 

        function Step1() {
            self.OnTree(FindReordersInsertsMoves, Step2);
        }


        Step1();
        return;


        var status = this.OnTree(FindReordersInsertsMoves);
        if (status != 0) {
            return status;
        }

        status = this.OnTree(FindDeletes);
        if (status != 0) {
            return status;
        }
        
        status = this.OnTree(FindUpdates);
        if (status != 0) {
            return status;
        }

        // Explicitly check ROOT for updates (tnid and unid attrs, for example)
        var sroot = self.Node(NODE_ROOT);
        var oroot = other.Node(NODE_ROOT);
        var attrs = {};
        if (this._datasource.compareNodes(sroot, oroot, attrs)) {
            var command = new Command("update", nid, attrs);
            commandset.append(command);
            self.Execute(command);
        }

        return commandset;


    },

    // Hash every node in the current tree for full sync.
    HashTree: function(hash_attrs, callback) {
        function HashNode(nid, pnid) {
            this.Node(nid).ComputeHash(this, hash_attrs);
        }

        function Done(status) {
            callback(status || 0);
        }

        this.OnTree(HashNode, Done, NODE_ROOT, true, true);
    },

    // We are given a set of nodes that need updates in the local
    // store; take these and generate commands to execute.  The
    // commands are in leaf-first order
    ProcessHashUpdates: function(updates) {
        var self = this;

        // attributes we will update
        var mutable_attrs = {
            'name': true,
//            'description': true,
            'url': true
//            'icon': true
        };

        function IsAttrChange(node, orig_node, attr) {
            if (!mutable_attrs[attr])
                return false;

            if (!node.hasOwnProperty(attr) && !orig_node.hasOwnProperty(attr))
                return false;

            return node[attr] != orig_node[attr];
        }

        // given a parent nid and a list of child nids, check that
        // the pnid/bnid position matches that in the nodeset; if not,
        // add a reorder or move command to the commandset.  We do these
        // back-to-front so the 'bnid' is in the proper place before the
        // node that relies on it
        function LinkChildren(pnid, orig_children, children, cs) {

            for (var i = children.length-1; i >= 0; i--) {
                var cnid = children[i];
                var bnid = (i == children.length - 1) ? null : children[i + 1];
                var node = self.Node(cnid);

                if (node.pnid != pnid) {
                    Xmarks.LogWrite("moving " + cnid + " to " + pnid + "," + i);
                    cs.append(new Command("move", cnid,
                        { "pnid": pnid, "bnid": bnid }));
                }
                else if (cnid != orig_children[i]) {
                    cs.append(new Command("reorder", cnid, { "bnid": bnid }));
                    Xmarks.LogWrite("Repair reorder " + cnid + " to " + i);
                }
            }
        }
        function ReinsertNode(nid, reinsert_cs, delete_set) {
            var insertNode = self.Node(nid)
            var attrs = self._datasource.GetSafeInsertAttrs ?
                self._datasource.GetSafeInsertAttrs(insertNode) :
                insertNode.GetSafeAttrs();
            var command = new Command("insert", nid, attrs);
            reinsert_cs.append(command);

            var children = insertNode.children || [];
            for (var i = 0; i < children.length; i++) {
                if (delete_set[nid] != false)
                    ReinsertNode(children[i], reinsert_cs, delete_set);
            }
        }

        var cs = new Commandset();
        var reinsert_cs = new Commandset();

        // delete set holds true if we think a nid should be deleted,
        // false if we know it should be kept
        var delete_set = {};

        for (var i = 0; i < updates.length; i++) {
            var node = updates[i];
            var nid = node.nid;
            var orig_node = self.Node(nid, false, true);

            Xmarks.LogWrite("Repair examining update: " + JSON.stringify(node));

            // this node must be in use
            delete_set[nid] = false;

            if (!orig_node) {
                // this is a new node; we just insert it as an orphan
                // then link it up with the correct parent node later.
                var insertNode = new Node(nid, node);
                var attrs = self._datasource.GetSafeInsertAttrs ?
                    self._datasource.GetSafeInsertAttrs(insertNode) :
                    insertNode.GetSafeAttrs();

                // dump it in root for now
                attrs.pnid = 'ROOT';

                var command = new Command("insert", nid, attrs);
                cs.append(command);
                self.Execute(command);
                Xmarks.LogWrite("Repair inserted nid: " + nid);

                // if we had any children, we need to make sure they are
                // now linked up with this parent
                var children = node.children || [];
                LinkChildren(nid, [], children, cs);

                // and none of them should be purged (e.g. may have moved
                // from another parent)
                for (var j=0; j < children.length; j++)
                    delete_set[children[j]] = false;

                continue;
            }

            // this is a node that already exists, check if there are
            // any children from the old list missing in the new child
            // list; if so add them to the delete set.  First just assume
            // we delete them all.
            orig_children = orig_node.children || [];
            new_children = node.children || [];
            for (var j=0; j < orig_children.length; j++) {
                cnid = orig_children[j];
                if (delete_set[cnid] == undefined) {
                    delete_set[cnid] = true;
                }
            }
            // keep any that are still in use
            for (var j=0; j < new_children.length; j++)
                delete_set[new_children[j]] = false;

            // link up and/or reorder children
            LinkChildren(nid, orig_children, new_children, cs);

            // now make sure that all attribute values match
            new_attrs = {}
            var doupdate = false;

            for (var attr in mutable_attrs) {
                if (IsAttrChange(node, orig_node, attr)) {
                    Xmarks.LogWrite("Repair attr changed (" + nid + "): " +
                        attr + " " + orig_node[attr] + " -> " + node[attr]);

                    doupdate = true;
                    new_attrs[attr] = node[attr] || null;
                }
            }
            if (doupdate)
                cs.append(new Command("update", nid, new_attrs));
        }

        // any nids still in delete don't exist on server side.
        // delete them for now, then we will add them back in a separate
        // transaction
        forEach(delete_set, function(v, nid) {
            if (v) {
                cs.append(new Command("delete", nid, {}));
                Xmarks.LogWrite("Repair delete: " + nid);

                // Construct commands to reinsert this node.
                //
                // The nodes deleted here must have an existing parent
                // since only the topmost removed node is added to the delete
                // set.  Thus we can get away with just recursively adding
                // back this and all child nodes that aren't moved elsewhere
                // (i.e. if delete_set[nid] is true or undefined).
                ReinsertNode(nid, reinsert_cs, delete_set);
            }
        });

        return [cs, reinsert_cs];
    },


    Merge: function(source, callback) {
        this._datasource.Merge(this, source, callback);
    }
};

function new_node_from_source(source)
{
  try {
    var matches = source.match(/^new Node\(("[^"]*"),(.*)\)$/);
    if (matches) {
      var nid = JSON.parse(matches[1]);
      var attrs = JSON.parse(matches[2]);
      return new Node(nid, attrs);
    }
  } catch (e) {
  }
  return eval(source); // this fallback won't work once we upgrade to chrome manifest version 2
}
