var RDF_ROOT = 0;

function xmarks_random_str() {
    var chars = "0123456789abcdefghijklmnopqrstuvwxyz";
    var strchars = [];
    for (var i=0; i < 30; i++)
        strchars.push(chars[Math.floor(Math.random() * chars.length)]);
    return strchars.join("");
}

function BookmarkDatasource() {
    if (!BookmarkDatasource._mapNidToNative) {
        this._LoadNidNativeMaps();
    }

    this.orderIsImportant = true;
    this.COMPARABLE = {name: true, url: true, tnid: true, unid: true}; // Only compare attrs in this list
    this.IGNORABLE = {created: true, visited: true, modified: true, 'private': true};
    this.NONULLFIELDS = {name: true, description: true, shortcuturl: true};

    this.quotaMgr = new XmarksQuotaManager();
}

BookmarkDatasource.prototype = {
    _InitNidNativeMaps: function() {
        BookmarkDatasource._mapNidToNative = {};
        BookmarkDatasource._mapNativeToNid = {};
        BookmarkDatasource._mapIsDirty = false;
    },
    
    _LoadNidNativeMaps: function(callback) {
        this._InitNidNativeMaps();

        Xmarks.LogWrite("Looking for saved nid map information");
        var nidmap = localStorage.getItem("nidmap");
        if (nidmap) {
          try{ 
            var aMap = JSON.parse(nidmap);
            for (var key in aMap) {
                if (!aMap.hasOwnProperty(key)) {
                    continue;
                }
                this.AddToMap(key, aMap[key]);
            }
          }catch(e){

            alert("An error occurred while parsing your local bookmark data.\n\nIt is recommended that you do a download (under Advanced tab in Xmarks Settings) to fix this.\n\nIf the error continues, please contact Xmarks support.");
            Xmarks.LogWrite("ERROR WHILE PARSING NIDMAP: " + e);
            Xmarks.Settings.Set("sync-error", "ERROR WHILE PARSING NIDMAP: " + e);

            if(callback)
              callback(-31);
            return;
          }
        }

        if (callback) {
            callback();
        }
    },

    _SaveNidNativeMaps: function(callback) {
        if (BookmarkDatasource._mapIsDirty) {
            var data = JSON.stringify(BookmarkDatasource._mapNativeToNid);
            localStorage.setItem("nidmap", data);
            var nidmap = localStorage.getItem("nidmap");
            if(nidmap!=data){
              alert("Error saving data in chrome's local storage. Please uninstall and reinstall the Xmarks plugin. Contact Xmarks support if this error continues after reinstall.");
              callback(-31);
            }
            try{
              JSON.parse(data);
            }catch(e){
              alert("JSON Error. Please uninstall and reinstall the Xmarks plugin. Contact Xmarks support if this error continues after reinstall.");
              callback(-32);
            }

            BookmarkDatasource._mapIsDirty = false;
        }

        if (callback) {
            callback(0);
        }
    },

    MapNid: function(nid) {
        return BookmarkDatasource._mapNidToNative[nid];
    },

    MapNative: function(resourceId) {
        return BookmarkDatasource._mapNativeToNid[resourceId] || this.AddToMap(resourceId, Xmarks.GenerateNid());
    },

    AddToMap: function(resourceId, nid) {
        BookmarkDatasource._mapNidToNative[nid] = resourceId;
        BookmarkDatasource._mapNativeToNid[resourceId] = nid;
        BookmarkDatasource._mapIsDirty = true;
        return nid;
    },

    RemoveFromMap: function(resourceId) {
        var nid = BookmarkDatasource._mapNativeToNid[resourceId];
        delete BookmarkDatasource._mapNidToNative[nid];
        delete BookmarkDatasource._mapNativeToNid[resourceId];
        BookmarkDatasource._mapIsDirty = true;
        return nid;
    },

    // TODO: prompt user for changes!
    handleNidConflict: function(lnode, snode, conflicts) {
        return "local";
    },
    
    ValidateGetTree: function(treeRoots) {
        if (!treeRoots || treeRoots.length != 1) {
            Xmarks.LogWrite("Invalid treeRoots result");
            return false;
        }

        if (treeRoots[0].id != 0) {
            Xmarks.LogWrite("Invalid treeRoots structure");
            return false;
        }
        
        return true;
    },

    ClearLocalStore: function(callback) {
        var self = this;
        var nodesToDelete = [];

        chrome.bookmarks.getTree(function(roots) {
            if (self.ValidateGetTree(roots)) {
                Xmarks.LogWrite("Deleting local bookmarks");

                for (var i = 0; i < roots[0].children.length; i++) {
                    var aNode = roots[0].children[i];
                    for (var j = 0; j < aNode.children.length; j++) {
                        nodesToDelete.push(aNode.children[j]);
                    }
                }
                ProcessDelete();
            } else {
                Xmarks.LogWrite("Unable to verify tree during delete");
                callback(-9);
            }
        });

        function ProcessDelete() {
            if (nodesToDelete.length == 0) {
                // Clean up old nid maps too
                self._InitNidNativeMaps();
                BookmarkDatasource._mapIsDirty = true;
                self._SaveNidNativeMaps(callback);
                return;
            }

            var localBookmark = nodesToDelete.shift();
            self._DeleteBookmarks(localBookmark,
                chrome.bookmarks.removeTree,
                function() {
                    if (chrome.extension.lastError) {
                        Xmarks.LogWrite("Error deleting local bookmark: " + chrome.extension.lastError.message);
                        Xmarks.Settings.Set("sync-error", "Error deleting local bookmark: " + chrome.extension.lastError.message);
                        callback(-22);
                        return;
                    }
                    ProcessDelete();
                });
        }
    },

    ProvideNodes: function(Caller, AddNode, Complete) {
        this.pn = {}
        this.pn.Caller = Caller;
        this.pn.AddNode = AddNode;
        this.pn.Complete = Complete;
        this.pn.count = 0;
        var self = this;
        chrome.bookmarks.getTree(HandleTrees);

        function HandleTrees(treeRoots) {
            if (!self.ValidateGetTree(treeRoots)) {
                self.pn.Complete.call(self.pn.Caller);
            }

            // Ensure "Other bookmarks" mapping is set
            var chromeRoot = treeRoots[0];
            if (!self.MapNid(NODE_ROOT)) {
                self.AddToMap(chromeRoot.children[1].id, NODE_ROOT);
            }

            // To ensure that the toolbar root is sewn back into our single root world,
            // manually make the pnid a child of ROOT
            chromeRoot.children[0].parentId = chromeRoot.children[1].id;
            chromeRoot.children[1].children.push(chromeRoot.children[0]);

            // Map "Other bookmarks" folder to a NodeSet
            ParseBookmarkTreeNode(chromeRoot.children[1]);

            self._SaveNidNativeMaps(function() {
                Xmarks.LogWrite("XXX fetch from native count: " + self.pn.count);
                self.pn.Complete.call(self.pn.Caller, 0);
            });
        }

        function ParseBookmarkTreeNode(aNode) {
            self.pn.count++;
            if (aNode == null || aNode.id == null) {
                return;
            }

            var xmNode = new Node(self.MapNative(aNode.id));
            if (aNode.url) {
                xmNode.url = aNode.url;
                xmNode.ntype = "bookmark";
            } else {
                xmNode.ntype = "folder";
            }

            if (aNode.parentId != "0") {
                xmNode.pnid = self.MapNative(aNode.parentId);
            }
            
            if (aNode.title) {
                xmNode.name = aNode.title;
            }

            if (aNode.dateAdded) {
                xmNode.created = parseInt(aNode.dateAdded/1000);
            }

            if (aNode.children) {
                xmNode.children = new Array();
                for (var i = 0; i < aNode.children.length; i++) {
                    xmNode.children.push(self.MapNative(aNode.children[i].id));
                }
            }

            if (xmNode.nid == NODE_ROOT) {
                xmNode.tnid = self.MapNative(1);
            }

            self.pn.AddNode.call(self.pn.Caller, xmNode);

            if (aNode.children) {
                for (var i = 0; i < aNode.children.length; i++) {
                    ParseBookmarkTreeNode(aNode.children[i]);
                }
            }
        }
    },

    /*
     * AcceptNodes: Add all nodes in ns to local storage.  Then remove any local bookmarks that aren't
     * in ns from local storage.  Call callback when done.
     */
    AcceptNodes: function(ns, callback) {
        var self = this;
        var root = ns.Node(NODE_ROOT);
        var nodesToProcess = [];
        var localNodeMap = {};

        chrome.bookmarks.getTree(function(roots) {
            if (self.ValidateGetTree(roots)) {
                // First map of all local nodes.  We use then when adding nodes later
                BuildLocalNodeMap(roots[0]);
                
                // Map NODE_ROOT to "Other bookmarks" folder and add NODE_ROOT to nodesToProcess.
                // If root has a valid tnid, map it to the "Bookmarks bar" folder and add it to be processed too.
                self.AddToMap(roots[0].children[1].id, NODE_ROOT);
                AddChildrenToProcess(NODE_ROOT);

                if (root.tnid && ns.Node(root.tnid, false, true)) {
                    self.AddToMap(roots[0].children[0].id, root.tnid);
                    AddChildrenToProcess(root.tnid);
                }
                
                // nodesToProcess has at least the root on it, start processing nodes
                ProcessNode();
            } else {
                Xmarks.Settings.Set("sync-error", "Unable to validate local tree in AcceptNodes");
                Xmarks.LogWrite("Unable to validate local tree in AcceptNodes"); 
                callback(-4);
            }
        });
        
        /*
         * Populate localNodeMap with a map of "local bookmark id" -> "local bookmark".  This is
         * used when adding nodes from ns.  We (a) need to ensure a local node still exists and
         * (b) need to check the local node for any changes.
         */
        function BuildLocalNodeMap(localBookmark) {
            localNodeMap[localBookmark.id] = localBookmark;
            if (localBookmark.children) {
                for (var i = 0; i < localBookmark.children.length; i++) {
                    BuildLocalNodeMap(localBookmark.children[i]);
                }
            }
        }

        /*
         * 
         */
        function AddChildrenToProcess(nid) {
            var nidChildren = ns.Node(nid).children || [];
            var validIndex = 0;
            for (var i = 0; i < nidChildren.length; i++) {
                if (!ShouldSkipNode(nidChildren[i])) {
                    nodesToProcess.push({'id': nidChildren[i], 'index': validIndex});
                    validIndex++;
                }
            }

            /*
             * Can we write this node as a Chrome bookmark?  Return true if we should skip the node.
             */
            function ShouldSkipNode(aNid) {
                if (root.tnid && root.tnid == aNid) {
                    Xmarks.LogWrite("Skipping tnid");
                    return true;
                }

                var aNode = ns.Node(aNid);
                if (aNode.ntype != "folder" && aNode.ntype != "bookmark") {
                    Xmarks.LogWrite("Skipping unknown node type [" + aNode.ntype + "] for nid: " + aNode.nid);
                    return true;
                }

                if (aNode.ntype == "bookmark" && !Xmarks.IsValidChromeBookmark(aNode.url, aNode.shortcuturl)) {
                    Xmarks.LogWrite("Skipping invalid url [" + aNode.url + "] for bookmark: " + aNode.nid);
                    return true;
                }
            }
        }

        /*
         *  Note, anything that calls back into ProcessNode from within
         *  ProcessNode should do so asynchronously (i.e. via
         *  setTimeout(..., 0)).  Otherwise, we can chew up lots of stack
         *  because the stack frames related to the original calls to
         *  ProcessNode() never get released.
         */
        function ProcessNode() {
            if (nodesToProcess.length == 0) {
                Xmarks.LogWrite("Finished adding ns, deleting unused local bookmarks");
                self._RemoveUnusedLocalBookmarks(ns, callback);
                return;
            }

            var nidInfo = nodesToProcess.shift();
            var aNode = ns.Node(nidInfo.id);
            var localChildId = self.MapNid(aNode.nid);
            var localParentId = self.MapNid(aNode.pnid);

            // trim quotes surrounding bookmark URLs, which seem to be getting added
            // from outside sources,and cause Invalid URL errors in Chrome
            if (aNode && aNode.url) {
                aNode.url = aNode.url.replace(/^\"+/,"");
                aNode.url = aNode.url.replace(/\"+$/,"");
            }

            // If "!localChildId" then this is a new node for this computer.
            // If "!localNodeMap[localChildId]" then the node existed at one point but has since been removed.
            if (!localChildId || !localNodeMap[localChildId]) {
                // aNode doesn't exist in Chrome at all, create a new bookmark
                Xmarks.LogWrite("No local match found for [" + aNode.nid + "], creating new bookmark [parent: " + aNode.pnid + " -> " + localParentId + "]");

                var newNode = {"parentId": localParentId, "title": aNode.name, "index": nidInfo.index};
                if (aNode.ntype == "bookmark") {
                    newNode.url = aNode.url;
                    if (!Xmarks.HasProtocol(newNode.url)) {
                        newNode.url = "http://" + newNode.url;
                    }
                }
                self._CreateBookmark(newNode, BuildCreateBookmarkCallbackRetry(nidInfo));

            } else {
                // aNode already exists, make sure it's in the right place and accurate
                Xmarks.LogWrite("Local match found for [" + aNode.nid + "], Ensuring attributes and position are correct");
                var localChild = localNodeMap[localChildId];

                // Ensure attributes are valid
                var updateAttrs = {};
                var doUpdate = false;
                if (localChild.title != aNode.name) {
                    updateAttrs["title"] = aNode.name;
                    doUpdate = true;
                }

                if (localChild.url && localChild.url != aNode.url) {
                    updateAttrs["url"] = aNode.url;
                    doUpdate = true;
                }

                if (doUpdate) {
                    Xmarks.LogWrite("Updating attrs to: " + JSON.stringify(updateAttrs));
                    self.quotaMgr.quota_check(
                        self._QuotaKeyUpdate(localChildId),
                        chrome.bookmarks.update,
                        [localChildId, updateAttrs, CheckForMove]);
                } else {
                    CheckForMove();
                }

                /*
                 *
                 */
                function CheckForMove() {
                    if (!chrome.extension.lastError &&
                        localChild.parentId != localParentId || localChild.index != nidInfo.index) {
                        // Needs to be moved or reordered
                        var moveAttrs = {'parentId': localParentId, 'index': nidInfo.index};
                        Xmarks.LogWrite("Moving/reordering local bookmark to: " + JSON.stringify(moveAttrs));
                        self.quotaMgr.quota_check(
                            self._QuotaKeyUpdate(localChildId),
                            chrome.bookmarks.move,
                            [localChildId, moveAttrs, BuildCreateBookmarkCallbackRetry(nidInfo)]);
                    } else {
                        var localCb = BuildCreateBookmarkCallbackRetry(nidInfo);
                        // Give it a closure to chew on
                        setTimeout(function() { localCb(localChild) }, 0);
                    }
                }
            }

            /*
             *
             */
            function BuildCreateBookmarkCallbackRetry(nidInfo) {
                var nid = nidInfo.id;
                return function(newBookmark) {
                    if (chrome.extension.lastError) {
                        var aNode = ns.Node(nid);
                        var localChildId = self.MapNid(aNode.nid);
                        var localParentId = self.MapNid(aNode.pnid);

                        if ("Invalid URL." == chrome.extension.lastError.message ||
                           aNode.url=="http:///" || aNode.url=="https:///" || aNode.url=="http://" || aNode.url=="https://") {
                            Xmarks.LogWrite("Error adding or updating bookmark: " + chrome.extension.lastError.message  + " nid: " + nid + " url: " + aNode.url);
                            Xmarks.LogWrite("Converting to blank.");
                            var newNode = {"parentId": localParentId, "title": aNode.name, "index": nidInfo.index, "url" : "about:blank"};
                            self._CreateBookmark(newNode, BuildCreateBookmarkCallback(nidInfo));
                        } else if ("Index out of bounds." == chrome.extension.lastError.message) {
                            // we may have elided separators or some such.
                            // retry without index parameter.
                            Xmarks.LogWrite("Invalid index for nid: " + nid + " (" + nidInfo.index + ")");
                            var newNode = { "parentId": localParentId, "title": aNode.name };
                            if (aNode.ntype == "bookmark") {
                                newNode.url = aNode.url;
                                if (!Xmarks.HasProtocol(newNode.url)) {
                                    newNode.url = "http://" + newNode.url;
                                }
                            }
                            self._CreateBookmark(newNode, BuildCreateBookmarkCallback(nidInfo));

                        } else {
                            Xmarks.LogWrite("Error adding or updating bookmark: " + chrome.extension.lastError.message  + " nid: " + nid + " url: " + aNode.url);
                            Xmarks.Settings.Set("sync-error", "Error adding or updating bookmark: " + chrome.extension.lastError.message);
                            callback(-11);
                        }
                    } else {
                        self.AddToMap(newBookmark.id, nid);
                        AddChildrenToProcess(nid);
                        ProcessNode();
                    }
                }
            }

            /*
             *
             */
            function BuildCreateBookmarkCallback(nidInfo) {
                var nid = nidInfo.id;
                return function(newBookmark) {
                    if (chrome.extension.lastError) {
                        Xmarks.LogWrite("Error adding or updating bookmark: " + chrome.extension.lastError.message);
                        Xmarks.Settings.Set("sync-error", "Error adding new bookmark: " + chrome.extension.lastError.message);
                        callback(-11);
                    } else {
                        self.AddToMap(newBookmark.id, nid);
                        AddChildrenToProcess(nid);
                        ProcessNode();
                    }
                }
            }
        }
    },

    _RemoveUnusedLocalBookmarks: function(ns, callback) {
        var self = this;
        var localBookmarksToCheck = [];

        chrome.bookmarks.getTree(function(roots) {
            if (self.ValidateGetTree(roots)) {
                AddLocalChildrenToProcess(roots[0].children[1]);
                AddLocalChildrenToProcess(roots[0].children[0]);
                CheckLocalBookmark();
            } else {
                Xmarks.Settings.Set("sync-error", "Unable to validate local tree in _RemoveUnusedLocalBookmarks");
                Xmarks.LogWrite("Unable to validate local tree in _RemoveUnusedLocalBookmarks"); 
                callback(-14);
            }
        });
        
        function AddLocalChildrenToProcess(localBookmark) {
            var localChildren = localBookmark.children || [];
            for (var i = 0; i < localChildren.length; i++) {
                localBookmarksToCheck.push(localChildren[i]);
            }
        }
        
        function CheckLocalBookmark() {
            var max_per_iteration = 5000;
            for (var i = 0; localBookmarksToCheck.length &&
                 i < max_per_iteration; i++) {

                var localBookmark = localBookmarksToCheck.shift();
                var matchingNid = BookmarkDatasource._mapNativeToNid[localBookmark.id];
                if (!matchingNid || ns.Node(matchingNid, false, true) == null) {
                    Xmarks.LogWrite("Removing local node: " + localBookmark.id);
                    var removefn;
                    if ("url" in localBookmark) {
                        removefn = chrome.bookmarks.remove;
                    } else {
                        removefn = chrome.bookmarks.removeTree;
                    }
                    self._DeleteBookmarks(localBookmark,
                        removefn,
                        CompleteDelete);
                    // exit out here; we get called back when CompleteDelete
                    // returns.
                    return;
                } else {
                    AddLocalChildrenToProcess(localBookmark);
                }
            }
            if (localBookmarksToCheck == 0) {
                Xmarks.LogWrite("Deleted local bookmarks, saving node map");
                self._SaveNidNativeMaps(callback);
            } else {
                setTimeout(CheckLocalBookmark, 100);
            }


            function CompleteDelete() {
                if (chrome.extension.lastError) {
                    Xmarks.LogWrite("Error removing local bookmark: " + chrome.extension.lastError.message);
                    Xmarks.Settings.Set("sync-error", "Error removing local bookmark: " + chrome.extension.lastError.message);
                    callback(-21);
                } else {
                    CheckLocalBookmark();
                }
            }
        }
    },

    compareNodes: function(snode, onode, attrs) {
        var important = [];

        // Iterate over other's attrs, add mistmach/missings.
        for (var attr in onode) {
            if (attr == "children" || attr == "pnid" || !this.COMPARABLE[attr] || !onode.hasOwnProperty(attr))
                continue;
            if (!equals(snode[attr], onode[attr])) {
                attrs[attr] = onode[attr];

                if (this.NONULLFIELDS[attr] && !attrs[attr]) {
                    attrs[attr] = "";
                    Xmarks.LogWrite("Updating Null field: " + attr);
                }

                if (!this.IGNORABLE[attr]) {
                    important.push(attr);
                }
            }
        }

        // Iterate over self's attrs, add deletions.
        for (var attr in snode) {
            if (attr == "children" || !this.COMPARABLE[attr] || !snode.hasOwnProperty(attr))
                continue;
            if (!(attr in onode)) {
                attrs[attr] = null;
                if (this.NONULLFIELDS[attr]) {
                    attrs[attr] = "";
                    Xmarks.LogWrite("Updating Null field: " + attr);
                }
                if (!this.IGNORABLE[attr]) {
                    important.push(attr);
                }
            }
        }

        // Special case: don't generate update on microsummary name
        // change.
        if (snode.ntype == "microsummary" && important.length == 1 && important[0] == 'name') {
            return false;
        }

        return important.length > 0;
    },

    Merge: function(dest, source, callback) {
        // Merge the given nodeset into us.
        // Walk through our node hiearchy and, in parallel,
        // source's hierarchy. Discard from further consideration any item
        // inside us that loosely matches* anything in the source. For any
        // item that exists in the source but not us, recusrively copy that
        // item into ourselves (being careful to generate new nid's for each
        // copied item).
        //
        // *Loosely matches, in this context, means that the node's ntype,
        // name, and url (if present) match for any two items in the same
        // place in the hiearchy.
        var self = this;
        var folders = [[NODE_ROOT, NODE_ROOT]];
        var toolbars = [
            ValidNid(dest, dest.Node(NODE_ROOT, false, true).tnid),
            ValidNid(source, source.Node(NODE_ROOT, false, true).tnid)];
        var unfiledRoots = [
            ValidNid(dest, dest.Node(NODE_ROOT, false, true).unid),
            ValidNid(source, source.Node(NODE_ROOT, false, true).unid)];
        var mergeToolbars = false;
        var mergeUnfiledRoots = false;
        var replicatedTnid = null;
        var replicatedUnid = null;

        if (toolbars[0] && toolbars[1]) {
            folders.push(toolbars);
            mergeToolbars = true;
        }

        if (unfiledRoots[0] && unfiledRoots[1]) {
            folders.push(unfiledRoots);
            mergeUnfiledRoots = true;
        }

        while (folders.length) {
            var f = folders.pop();
            var us = dest.Node(f[0]);
            var them = source.Node(f[1]);
            Xmarks.LogWrite(">> Merge processing folder " + us.name + " (" + 
                    us.nid + ")");
            // makin' copies!
            var ourchildren = us.children ? us.children.slice() : [];
            var theirchildren = them.children ? them.children.slice() : [];

            for (var i = 0; i < theirchildren.length; ++i) {
                var theiritem = theirchildren[i];
                if (mergeToolbars && theiritem == toolbars[1])
                    continue;   // skip it, we've already processed it
                if (mergeUnfiledRoots && theiritem == unfiledRoots[1])
                    continue;   // Ditto.
                var matched = FindMatch(theiritem);
                if (matched >= 0) {
                    if (dest.Node(ourchildren[matched]).ntype == "folder") {
                        folders.push([ourchildren[matched], theirchildren[i]]);
                    }
                    // Merge the contents of the source node into the
                    // matching dest node, then remove the matched node
                    // from our temporary list so we don't match it again.
                    dest.Node(ourchildren[matched], true).
                        Merge(source.Node(theirchildren[i]));
                    ourchildren.splice(matched, 1);
                } else {
                    ReplicateNode(source, theirchildren[i], us.nid);
                }
            }
        }

        if (!toolbars[0] && replicatedTnid) {
            dest.Node(NODE_ROOT, true).tnid = replicatedTnid;
        }

        if (!unfiledRoots[0] && replicatedUnid) {
            dest.Node(NODE_ROOT, true).unid = replicatedUnid;
        }

        if (callback) {
            callback(0);
        }

        function FindMatch(nid) {
            // nid is an item in source.
            // Try to find the best match in ourchildren.
            // Return the index into ourchildren of the best
            // match or -1 if no match found.
            if (nid == toolbars[1] || nid == unfiledRoots[1])
                return -1;  // These special roots are never matched here.
            var them = source.Node(nid);
            var themurl = self.NormalizeUrl(them.ntype == "feed" ? 
                    them.feedurl : them.url);
            var themname = NormalizedName(them);
            var matches = []
            for (var i = 0; i < ourchildren.length; ++i) {
                var child = ourchildren[i];
                if (child == toolbars[0] || child == unfiledRoots[0])
                    continue;
                var us = dest.Node(child);
                var usurl =self.NormalizeUrl(us.ntype == "feed" ? 
                        us.feedurl : us.url);
                var usname = NormalizedName(us);

                // Don't match if ntypes or urls are different.
                if (us.ntype != them.ntype || usurl != themurl) {
                    continue;
                }

                // Only match folders if their name matches.
                if (us.ntype == 'folder' && usname != themname) {
                    continue;
                }

                var score = 0;
                if (usname == themname) score += 2;
                if (nid == child) ++score;
                matches.push([i, score]);
            }
            if (!matches.length) {
                return -1;
            } else if (matches.length > 1) {
                matches.sort(function(x, y) { return y[1] - x[1] });
            }
            return matches[0][0];
        }

        function NormalizedName(node) {
            if (node.ntype == "separator") {
                return "";
            } else if (node.ntype == "microsummary") {
                return node.generateduri || rtrim(node.name);
            } else {
                return rtrim(node.name);
            }
        }
        
        function ReplicateNode(source, nid, pnid) {
            // Copy the given node (including children if it's a folder)
            // into us, generating new nids along the way.

            Xmarks.LogWrite("Entered ReplicateNode(" + nid + ")");

            function ReplicateNodeInternal(nid, pnid) {
                if (mergeToolbars && nid == toolbars[1])
                    return;
                var attrs = source.Node(nid).GetSafeAttrs();
                attrs.pnid = pnid;
                var newNid = Xmarks.GenerateNid();
                dest.Do_insert(newNid, attrs);
                if (nid == toolbars[1]) {
                    replicatedTnid = newNid;
                } else if (nid == unfiledRoots[1]) {
                    replicatedUnid = newNid;
                }

                if (attrs.ntype == 'folder') {
                    var children = source.Node(nid).children;
                    if (children) {
                        for (var i = 0; i < children.length; ++i) {
                            ReplicateNodeInternal(children[i], newNid);
                        }
                    }
                }
            }

            // Fun with closures: note that we create ds just once
            // and keep it in a closure as we recursively process
            // nid and its children. Creating a native datasource
            // *could* be expensive, depending on platform, so this
            // is likely justified.
            ReplicateNodeInternal(nid, pnid);
        }

        function rtrim(s) {
            return s ? s.replace(/\s+$/, "") : s;
        }

        function ValidNid(ns, nid) {
            return ns.Node(nid, false, true) ? nid : null;
        }
    },

    Repair: function() {
      //TODO? -- ff makes sure 3 reqd nodes are there...not sure if there
      //is a chrome analog
    },

    NormalizeUrl: function(url) {
        return url;
    },

    _QuotaKeyCreate: function(node) {
        // technically, chrome matches on sha1(p.title | title | index),
        // but we will assume parent title is the same at the risk of
        // extra collisions to avoid the lookup.
        //
        // Otherwise, we need to keep a map of local id to title
        return node.title + "_" + node.url;
    },
    _QuotaKeyUpdate: function(id) {
        return id;
    },
    _QuotaKeyRemove: function(node) {
        return this._QuotaKeyCreate(node);
    },

    _Randomize: function(bookmark, completion) {
        var self = this;
        // randomize bookmarks for scalability
        var updateAttrs = {
            'title': xmarks_random_str() + " - " + bookmark.name
        };
        self.quotaMgr.quota_check(
           self._QuotaKeyUpdate(bookmark.id),
           chrome.bookmarks.update,
           [bookmark.id, updateAttrs, function() {
               bookmark.title = updateAttrs["title"];
               completion(bookmark);
           }]);
    },

    _CreateBookmark: function(bookmark, completion) {
        var self = this;

        var on_complete = completion;

        if (self.quotaMgr.would_hit_quota(self._QuotaKeyCreate(bookmark))) {
            // in case we'd hit the quota, let's adjust our title,
            // and fix after creation.
            var orig_title = bookmark.title;
            bookmark.title = xmarks_random_str() + " - " + orig_title;

            on_complete = function(bookmark) {
                if (!chrome.extension.lastError) {
                    // rename it into place...
                    var updateAttrs = {
                        'title': orig_title
                    };
                    Xmarks.LogWrite("Backing off on create...");
                    bookmark.title = orig_title;
                    self.quotaMgr.quota_check(
                        self._QuotaKeyUpdate(bookmark.id),
                        chrome.bookmarks.update,
                        [bookmark.id, updateAttrs, completion]);
                } else {
                    completion(bookmark);
                }
            };
        }
        self.quotaMgr.quota_check(
            self._QuotaKeyCreate(bookmark),
            chrome.bookmarks.create,
            [bookmark, on_complete]);
    },

    _DeleteBookmarks: function(bookmark, removefn, completion) {
        var self = this;

        // this fn actually deletes it, but we may
        // want to call Randomize first.
        var delete_fn = function(bm) {
            self.quotaMgr.quota_check(
                self._QuotaKeyRemove(bm),
                    removefn,
                    [bm.id, completion])
        };

        if (self.quotaMgr.would_hit_quota(self._QuotaKeyRemove(bookmark))) {
            Xmarks.LogWrite("Backing off on delete...");
            self._Randomize(bookmark, delete_fn);
        } else {
            delete_fn(bookmark);
        }
    }

};
