function StartUpload(a){for(var c={toProcess:[],processed:[],action:"upload"},b=[{type:"bookmarks",defaultEnabled:"true",ds:BookmarkDatasource,suffix:"",fn:ProcessSingleUpload},{type:"tabs",defaultEnabled:"false",force:!0,fn:WriteTabs}],d=0;d<b.length;d++)(!a.dataType||a.dataType==b[d].type)&&c.toProcess.push(b[d]);Xmarks.Settings.SetSyncInfo(c);UpdateSyncUI();(new Request("POST",{host:Xmarks.Settings.Get("syncserver"),path:"/sync/bookmarks/status"},Xmarks.GetRequestArgs())).Start(function(a){ResponseOK(a)?
ProcessSyncType():(Xmarks.LogWrite("User canceled status call, not uploading"),ResetSyncAction())})}function StartMerge(a){for(var c={toProcess:[],processed:[],action:"merge"},b=[{type:"bookmarks",defaultEnabled:"true",ds:BookmarkDatasource,suffix:"",mergeType:a.type,fn:ProcessSingleMerge},{type:"tabs",defaultEnabled:"false"}],d=0;d<b.length;d++)(!a.dataType||a.dataType==b[d].type)&&c.toProcess.push(b[d]);Xmarks.Settings.SetSyncInfo(c);ProcessSyncType()}
function StartSync(a){for(var c={toProcess:[],processed:[],action:"synchronization"},b=[{type:"bookmarks",defaultEnabled:"true",ds:BookmarkDatasource,suffix:"",fn:ProcessSingleSync},{type:"tabs",defaultEnabled:"true",force:!1,fn:WriteTabs}],d=0;d<b.length;d++)(!a.dataType||a.dataType==b[d].type)&&c.toProcess.push(b[d]);Xmarks.Settings.SetSyncInfo(c);ProcessSyncType()}
function StartRepair(a){for(var c={toProcess:[],processed:[],action:"repair"},b=[{type:"bookmarks",defaultEnabled:"true",ds:BookmarkDatasource,suffix:"",fn:ProcessSingleRepair}],d=0;d<b.length;d++)(!a.dataType||a.dataType==b[d].type)&&c.toProcess.push(b[d]);Xmarks.Settings.SetSyncInfo(c);ProcessSyncType()}
function StartDownload(a){for(var c={toProcess:[],processed:[],action:"download"},b=[{type:"bookmarks",defaultEnabled:"true",ds:BookmarkDatasource,suffix:"",fn:ProcessSingleDownload},{type:"tabs",defaultEnabled:"false"}],d=0;d<b.length;d++)(!a.dataType||a.dataType==b[d].type)&&c.toProcess.push(b[d]);Xmarks.Settings.SetSyncInfo(c);ProcessSyncType()}
function StartPurge(a){for(var c={toProcess:[],processed:[],action:"purge"},b=[{type:"passwords",defaultEnabled:"true",suffix:"-passwords",fn:ProcessSinglePurge}],d=0;d<b.length;d++)(!a.dataType||a.dataType==b[d].type)&&c.toProcess.push(b[d]);Xmarks.Settings.SetSyncInfo(c);UpdateSyncUI();(new Request("POST",{host:Xmarks.Settings.Get("syncserver"),path:"/sync/bookmarks/status"},Xmarks.GetRequestArgs())).Start(function(a){ResponseOK(a)?ProcessSyncType():(Xmarks.LogWrite("User canceled status call, not purging"),
ResetSyncAction())})}function HandleAction(a,c){SetNewAction(a)&&(c||(c={}),DestroyLocalChangeHandlers(),c.callback&&Xmarks.Settings.SetPostSyncCallback(c.callback),"download"==a?StartDownload(c):"sync"==a?StartSync(c):"upload"==a?StartUpload(c):"merge"==a?StartMerge(c):"purge"==a?StartPurge(c):"repair"==a&&StartRepair(c))}function ToggleUserAuthentication(a){Xmarks.Settings.GetUserSettings().username?UnauthenticateUser(a):AuthenticateUser(a)}
function UnauthenticateUser(a){SetNewAction("authentication")&&(Xmarks.Settings.SetUserSettings({remember:!0}),UpdateTabListener(),ResetSyncAction(),a())}
function AuthenticateUser(a,c){function b(b){function c(e){ResponseOK(e)?(b.authtoken=e.auth,Xmarks.Settings.SetUserSettings(b),Xmarks.LogWrite("Authenticated as: "+Xmarks.Settings.Get("current-username"))):(Xmarks.LogWrite("Authentication error: "+e.message),Xmarks.ShowDialog(chrome.i18n.getMessage("bg_invalid_auth")));UpdateTabListener();ResetSyncAction();a()}if(b.username){var f=Base64.decode(b.password);(new Request("POST",{host:Xmarks.Settings.Get("authserver"),path:"/login/signtoken"},Xmarks.GetRequestArgs({username:b.username,
passwordhash:hex_md5(f)}),!0)).Start(c)}else Xmarks.LogWrite("User canceled auth dialog; canceling authentication"),UpdateTabListener(),ResetSyncAction(),a()}SetNewAction("authentication")&&Xmarks.GetUserCredentials(b,c)}
function StartSetupWizard(){var a=Math.floor((window.screen.height-530)/2),c=Math.floor((window.screen.width-650)/2);chrome.i18n.getAcceptLanguages(function(b){b="_lang="+b.join(",")+"&_app=sheba&_mid="+Xmarks.Settings.GetMachineId()+"&_version="+Xmarks.Settings.Get("version");window.open("https://"+Xmarks.Settings.Get("authserver")+"/wizard?"+b,"xmarksSetupWizard","height=400,width=600,left="+c+",top="+a+"toolbar=no,directories=no,status=no,menubar=no,scrollbars=no,resizable=no,location=no")})}
function ExtensionListener(a,c){!a||!a.requestType?Xmarks.LogWrite("Got poorly formed message from content script, ignoring: "+JSON.stringify(a)):"log"==a.requestType?Xmarks.LogWrite("Content script log: "+a.message):(Xmarks.LogWrite("Got message from content script: "+a.requestType),"setupWizard"==a.requestType&&(chrome.windows.remove(c.tab.windowId),a.username?(Xmarks.Settings.SetWindowParams({callback:function(b,c){b.close();var e=a.remember;Xmarks.Settings.Set("current-username",a.username,e);
var f=Xmarks.Settings.GetUserHash();Xmarks.Settings.Set(f+"username",a.username,e);Xmarks.Settings.Set(f+"password",a.password,e);Xmarks.LogWrite("Logged in as: "+Xmarks.Settings.Get("current-username"));"upload"==c.synctype||"download"==c.synctype?HandleAction(c.synctype,{dataType:"bookmarks"}):"merge-local"==c.synctype?HandleAction("merge",{type:"local",dataType:"bookmarks"}):"merge-server"==c.synctype&&HandleAction("merge",{type:"server",dataType:"bookmarks"})},have_account:a.have_account}),Xmarks.ShowWindow("firsttimesync.html",
"xmarksFirstTimeSync",200,590)):Xmarks.ShowDialog(chrome.i18n.getMessage("bg_wizard_canceled"))))}function OpenExtensionUrl(a,c){function b(a){for(var b=!1,c=0;c<a.length;c++){var g=a[c];if(0==g.url.indexOf(d)){chrome.tabs.update(g.id,{url:e,selected:!0});b=!0;break}}b||chrome.tabs.create({url:e,selected:!0})}var d=chrome.extension.getURL(a),e=d;c&&(e+="?"+c);chrome.windows.getCurrent(function(a){chrome.tabs.getAllInWindow(a.id,b)})}
function ShowSuccessPage(a,c){var b="http://"+Xmarks.Settings.Get("webserver")+"/chrome/"+a+"/"+Xmarks.Settings.Get("version");chrome.tabs.create({url:b,selected:c?!0:!1})}function OpenUrlsFromTabList(a){function c(b){for(;0<a.length;){var c=a.shift();c&&chrome.tabs.create({url:c.url,windowId:b.id,selected:!1})}}var b=a.shift();b&&chrome.windows.create({url:b.url},c)}
function ShowChangeSyncProfilesWindow(){if(Xmarks.Settings.GetUserSettings().username){var a=Xmarks.Settings.GetUserHash();Xmarks.Settings.Remove(a+"authtoken")}AuthenticateUser(function(){function a(b){Xmarks.LogWrite("Handling get profile names callback");if(!ResponseOK(b)||!b.profiles)ResetSyncAction(),Xmarks.ShowDialog(chrome.i18n.getMessage("bg_no_profiles_list"));b.profiles.callback=ChangeSyncProfile;Xmarks.Settings.SetWindowParams(b.profiles);Xmarks.ShowWindow("syncprofile.html","xmarksSyncProfile",
100,400)}Xmarks.Settings.GetUserSettings().authtoken&&(new Request("POST",{protocol:"https",host:Xmarks.Settings.Get("authserver"),path:"/user/profiles/getnames"},Xmarks.GetRequestArgs())).Start(a)},!0)}
function ChangeSyncProfile(a,c){Xmarks.ShowDialog(chrome.i18n.getMessage("bg_profile_changed"),null,function(){var b=Xmarks.Settings.GetUserHash(),d=Xmarks.Settings.Get(b+"lastsync");Xmarks.Settings.SetPostSyncCallback(function(){function e(){Xmarks.Settings.SetPostSyncCallback(null);Xmarks.Settings.Get(b+"lastsync")<=f?(Xmarks.Settings.Set(b+"profilename",Xmarks.Settings.Get(b+"profilenameORIG",0),!0),Xmarks.Settings.Set(b+"profileid",Xmarks.Settings.Get(b+"profileidORIG",0),!0),Xmarks.ShowDialog(chrome.i18n.getMessage("bg_profile_download_error"))):
""==c||"<none>"==c?Xmarks.ShowDialog(chrome.i18n.getMessage("bg_no_profile")):Xmarks.ShowDialog(chrome.i18n.getMessage("bg_change_profile",[c]))}Xmarks.Settings.SetPostSyncCallback(null);var f=Xmarks.Settings.Get(b+"lastsync");f<=d?Xmarks.ShowDialog(chrome.i18n.getMessage("bg_profile_sync_error")):(Xmarks.Settings.Set(b+"profilenameORIG",Xmarks.Settings.Get(b+"profilename",0),!1),Xmarks.Settings.Set(b+"profileidORIG",Xmarks.Settings.Get(b+"profileid",0),!1),Xmarks.Settings.Set(b+"profilename",c,!0),
Xmarks.Settings.Set(b+"profileid",a,!0),Xmarks.Settings.SetPostSyncCallback(e),Xmarks.Settings.Set("auto-sync",!0),HandleAction("download"))});Xmarks.Settings.Set("auto-sync",!0);HandleAction("sync")})}
function CreateLocalChangeHandlers(){chrome.bookmarks.onCreated.addListener(LocalBookmarkChangeHandler);chrome.bookmarks.onRemoved.addListener(LocalBookmarkChangeHandler);chrome.bookmarks.onChanged.addListener(LocalBookmarkChangeHandler);chrome.bookmarks.onMoved.addListener(LocalBookmarkChangeHandler);chrome.bookmarks.onChildrenReordered.addListener(LocalBookmarkChangeHandler)}
function DestroyLocalChangeHandlers(){chrome.bookmarks.onCreated.removeListener(LocalBookmarkChangeHandler);chrome.bookmarks.onRemoved.removeListener(LocalBookmarkChangeHandler);chrome.bookmarks.onChanged.removeListener(LocalBookmarkChangeHandler);chrome.bookmarks.onMoved.removeListener(LocalBookmarkChangeHandler);chrome.bookmarks.onChildrenReordered.removeListener(LocalBookmarkChangeHandler)}
function LocalBookmarkChangeHandler(){var a=(new Date).getTime(),c=Xmarks.Settings.GetInt(Xmarks.Settings.GetUserHash()+"lastsync",0);if(Xmarks.Settings.GetBool("sync-type-bookmarks","true")&&(!c||a>c+3E3))Xmarks.Settings.Set("last-change",a),UpdateSyncUI()}function UpdateTabListener(){}"undefined"!=typeof chrome.runtime?chrome.runtime.onMessage.addListener(ExtensionListener):chrome.extension.onRequest.addListener(ExtensionListener);UpdateTabListener();
window.onerror=function(a){Xmarks.LogWrite(a);Xmarks.Settings.Remove("current-action")};chrome.bookmarks.get("0",CreateLocalChangeHandlers);setTimeout(HandleHeartbeat,12E4);
