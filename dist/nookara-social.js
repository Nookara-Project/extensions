// Name: Nookara Social
// ID: ikelenenookarasocial
// Description: Presence, direct messages, groups, friends, blocking and alerts for Nookara. Needs Nookara Login.
// By: Ikelene
// License: MIT

// made by extensions/split/build.js from velora_extension.js, edit that one and rebuild
(function (Scratch) {
  'use strict';

  if (!Scratch.extensions.unsandboxed) throw new Error('Nookara Social must run unsandboxed: it shares its sign-in with the other Nookara extensions.');

  const API_VERSION = 1;
  const CORE_URL = 'https://ikelene.net/gallery/extensions/nookara-login.js';
  const EXT_ID = 'ikelenenookarasocial';

  class NookaraExtension {
    constructor(runtime) {
      this.runtime = runtime;
      this._friends = [];
      this._friendRequests = [];
      this._mail = [];
      this._lastIM = null;
      this._lastIMDelivered = false;
      this._imUnread = 0;
      this._imPending = new Map();
      this._evtIMReceived = false;
      this._evtIMFromMap = {};
      this._evtMailReceived = false;
      this._evtFriendRequest = false;
      this._evtFriendAccepted = false;
      this._evtUserJoined = false;
      this._evtUserLeft = false;
      this._lastUserJoined = '';
      this._lastUserLeft = '';
      this._onlinePlayers  = [];
      this._status = 'online';
      this._presence = {};
      this._presenceEvt = {};
      this._lastPresenceUser = '';
      this._rich = null;
      this._notifications = [];
      this._evtNotification = false;
      this._lastNotifTitle = '';
      this._lastNotifBody = '';
      this._notifInterval = null;
      runtime.ext_ikelenenookarasocial = this;
      this._linked = null;
      runtime.on('EXTENSION_ADDED', () => this._linkCore());
      this._linkCore();
    }

    getInfo() {
      const blocks = [
          { blockType: Scratch.BlockType.LABEL, text: 'Storage space' },
          { opcode: 'rpIsMobile', blockType: Scratch.BlockType.BOOLEAN, text: 'is [USER] on mobile?', arguments: { USER: { type: Scratch.ArgumentType.STRING, defaultValue: 'username' } } },
          { opcode: 'rpIsConsole', blockType: Scratch.BlockType.BOOLEAN, text: 'is [USER] on console?', arguments: { USER: { type: Scratch.ArgumentType.STRING, defaultValue: 'username' } } },
          { opcode: 'rpIsAutoIdle', blockType: Scratch.BlockType.BOOLEAN, text: 'is [USER] auto idle?', arguments: { USER: { type: Scratch.ArgumentType.STRING, defaultValue: 'username' } } },
          { blockType: Scratch.BlockType.LABEL, text: 'Status' },
          { opcode: 'rpSet', blockType: Scratch.BlockType.COMMAND, text: 'set activity [TYPE] [NAME] details [DETAILS] state [STATE]', arguments: { TYPE: { type: Scratch.ArgumentType.STRING, menu: 'activityTypes', defaultValue: 'playing' }, NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'my game' }, DETAILS: { type: Scratch.ArgumentType.STRING, defaultValue: 'Level 1' }, STATE: { type: Scratch.ArgumentType.STRING, defaultValue: 'In a match' } } },
          { opcode: 'rpImage', blockType: Scratch.BlockType.COMMAND, text: 'set activity image to [URL]', arguments: { URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://' } } },
          { opcode: 'rpClear', blockType: Scratch.BlockType.COMMAND, text: 'clear activity' },
          { opcode: 'rpCustom', blockType: Scratch.BlockType.COMMAND, text: 'set custom status to [TEXT]', arguments: { TEXT: { type: Scratch.ArgumentType.STRING, defaultValue: 'making games' } } },
          { opcode: 'rpPresence', blockType: Scratch.BlockType.REPORTER, text: 'status of [USER] as JSON', arguments: { USER: { type: Scratch.ArgumentType.STRING, defaultValue: 'username' } } },
          { opcode: 'rpStatusOf', blockType: Scratch.BlockType.REPORTER, text: 'status of [USER]', arguments: { USER: { type: Scratch.ArgumentType.STRING, defaultValue: 'username' } } },
          { opcode: 'rpActivityOf', blockType: Scratch.BlockType.REPORTER, text: 'activity of [USER]', arguments: { USER: { type: Scratch.ArgumentType.STRING, defaultValue: 'username' } } },
          { opcode: 'whenPresenceChanges', blockType: Scratch.BlockType.HAT, text: 'when [USER] changes status or activity', arguments: { USER: { type: Scratch.ArgumentType.STRING, defaultValue: 'anyone' } } },
          { opcode: 'rpLastUser', blockType: Scratch.BlockType.REPORTER, text: 'who last changed status' },
          { blockType: Scratch.BlockType.LABEL, text: 'Events and permissions' },
          { opcode: 'bfEditDM', blockType: Scratch.BlockType.COMMAND, text: 'edit DM [ID] to [MSG]', arguments: { ID: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, MSG: { type: Scratch.ArgumentType.STRING, defaultValue: 'Hello!' } } },
          { blockType: Scratch.BlockType.LABEL, text: 'Users' },
          { opcode: 'bfGetChatUsersUsername', blockType: Scratch.BlockType.REPORTER, text: 'user [USERNAME] as JSON', arguments: { USERNAME: { type: Scratch.ArgumentType.STRING, defaultValue: '' } } },
          { blockType: Scratch.BlockType.LABEL, text: 'Status' },
          { opcode: 'bfGetChatPresenceUsername', blockType: Scratch.BlockType.REPORTER, text: 'presence of [USERNAME] as JSON', arguments: { USERNAME: { type: Scratch.ArgumentType.STRING, defaultValue: '' } } },
          { opcode: 'bfPostChatPresenceStatus', blockType: Scratch.BlockType.COMMAND, text: 'set status with options [OPTIONS]', arguments: { OPTIONS: { type: Scratch.ArgumentType.STRING, defaultValue: '{}' } } },
          { opcode: 'bfPostChatPresenceCustom', blockType: Scratch.BlockType.COMMAND, text: 'set custom status with options [OPTIONS]', arguments: { OPTIONS: { type: Scratch.ArgumentType.STRING, defaultValue: '{}' } } },
          { opcode: 'bfPostChatPresenceActivity', blockType: Scratch.BlockType.COMMAND, text: 'set activity with options [OPTIONS]', arguments: { OPTIONS: { type: Scratch.ArgumentType.STRING, defaultValue: '{}' } } },
          { opcode: 'bfDeleteChatPresenceActivityKey', blockType: Scratch.BlockType.COMMAND, text: 'remove activity [KEY]', arguments: { KEY: { type: Scratch.ArgumentType.STRING, defaultValue: '' } } },
          { blockType: Scratch.BlockType.LABEL, text: 'DMs' },
          { opcode: 'bfPutChatDmIdReactionsEmoji', blockType: Scratch.BlockType.COMMAND, text: 'react [EMOJI] to DM [ID] options [OPTIONS]', arguments: { ID: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, EMOJI: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, OPTIONS: { type: Scratch.ArgumentType.STRING, defaultValue: '{}' } } },
          { opcode: 'bfDeleteChatDmIdReactionsEmoji', blockType: Scratch.BlockType.COMMAND, text: 'remove reaction [EMOJI] from DM [ID]', arguments: { ID: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, EMOJI: { type: Scratch.ArgumentType.STRING, defaultValue: '' } } },
          { blockType: Scratch.BlockType.LABEL, text: 'Groups' },
          { opcode: 'bfGetGroups', blockType: Scratch.BlockType.REPORTER, text: 'my groups' },
          { opcode: 'bfPostGroups', blockType: Scratch.BlockType.COMMAND, text: 'create group with options [OPTIONS]', arguments: { OPTIONS: { type: Scratch.ArgumentType.STRING, defaultValue: '{}' } } },
          { opcode: 'bfGetGroupsRoom', blockType: Scratch.BlockType.REPORTER, text: 'group [ROOM]', arguments: { ROOM: { type: Scratch.ArgumentType.STRING, defaultValue: '' } } },
          { opcode: 'bfGetGroupsRoomMessages', blockType: Scratch.BlockType.REPORTER, text: 'messages in group [ROOM] filters [QUERY]', arguments: { ROOM: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, QUERY: { type: Scratch.ArgumentType.STRING, defaultValue: '{"limit": 100}' } } },
          { opcode: 'bfPostGroupsRoomMessages', blockType: Scratch.BlockType.COMMAND, text: 'send to group [ROOM] with options [OPTIONS]', arguments: { ROOM: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, OPTIONS: { type: Scratch.ArgumentType.STRING, defaultValue: '{}' } } },
          { opcode: 'bfPostGroupsRoomMembers', blockType: Scratch.BlockType.COMMAND, text: 'add to group [ROOM] with options [OPTIONS]', arguments: { ROOM: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, OPTIONS: { type: Scratch.ArgumentType.STRING, defaultValue: '{}' } } },
          { opcode: 'bfDeleteGroupsRoomMembersUsername', blockType: Scratch.BlockType.COMMAND, text: 'remove [USERNAME] from group [ROOM]', arguments: { ROOM: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, USERNAME: { type: Scratch.ArgumentType.STRING, defaultValue: '' } } },
          { opcode: 'bfPatchGroupsRoom', blockType: Scratch.BlockType.COMMAND, text: 'edit group [ROOM] with options [OPTIONS]', arguments: { ROOM: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, OPTIONS: { type: Scratch.ArgumentType.STRING, defaultValue: '{}' } } },
          { opcode: 'bfDeleteGroupsRoom', blockType: Scratch.BlockType.COMMAND, text: 'delete group [ROOM]', arguments: { ROOM: { type: Scratch.ArgumentType.STRING, defaultValue: '' } } },
          { opcode: 'bfPatchGroupsRoomMessagesId', blockType: Scratch.BlockType.COMMAND, text: 'edit message [ID] in group [ROOM] options [OPTIONS]', arguments: { ID: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, ROOM: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, OPTIONS: { type: Scratch.ArgumentType.STRING, defaultValue: '{"message":"Hello!"}' } } },
          { opcode: 'bfDeleteGroupsRoomMessagesId', blockType: Scratch.BlockType.COMMAND, text: 'delete message [ID] in group [ROOM]', arguments: { ID: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, ROOM: { type: Scratch.ArgumentType.STRING, defaultValue: '' } } },
          { opcode: 'bfPutGroupsRoomMessagesIdReactionsEmoji', blockType: Scratch.BlockType.COMMAND, text: 'react [EMOJI] to message [ID] in group [ROOM]', arguments: { EMOJI: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, ID: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, ROOM: { type: Scratch.ArgumentType.STRING, defaultValue: '' } } },
          { opcode: 'bfDeleteGroupsRoomMessagesIdReactionsEmoji', blockType: Scratch.BlockType.COMMAND, text: 'remove reaction [EMOJI] from message [ID] in group [ROOM]', arguments: { EMOJI: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, ID: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, ROOM: { type: Scratch.ArgumentType.STRING, defaultValue: '' } } },
          { opcode: 'bfPutGroupsRoomMessagesIdPin', blockType: Scratch.BlockType.COMMAND, text: 'pin message [ID] in group [ROOM]', arguments: { ID: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, ROOM: { type: Scratch.ArgumentType.STRING, defaultValue: '' } } },
          { opcode: 'bfDeleteGroupsRoomMessagesIdPin', blockType: Scratch.BlockType.COMMAND, text: 'unpin message [ID] in group [ROOM]', arguments: { ID: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, ROOM: { type: Scratch.ArgumentType.STRING, defaultValue: '' } } },
          { opcode: 'bfGetGroupsRoomPins', blockType: Scratch.BlockType.REPORTER, text: 'pinned messages in group [ROOM]', arguments: { ROOM: { type: Scratch.ArgumentType.STRING, defaultValue: '' } } },
          { blockType: Scratch.BlockType.LABEL, text: 'Me' },
          { opcode: 'bfPutImIdPin', blockType: Scratch.BlockType.COMMAND, text: 'pin DM [ID]', arguments: { ID: { type: Scratch.ArgumentType.STRING, defaultValue: '' } } },
          { opcode: 'bfDeleteImIdPin', blockType: Scratch.BlockType.COMMAND, text: 'unpin DM [ID]', arguments: { ID: { type: Scratch.ArgumentType.STRING, defaultValue: '' } } },
          { opcode: 'bfGetImWithUsernamePins', blockType: Scratch.BlockType.REPORTER, text: 'pinned DMs with [USERNAME]', arguments: { USERNAME: { type: Scratch.ArgumentType.STRING, defaultValue: '' } } },
          { blockType: Scratch.BlockType.LABEL, text: 'Online' },
          { opcode: 'connectedUsers', blockType: Scratch.BlockType.REPORTER, text: 'online users' },
          { opcode: 'setStatus', blockType: Scratch.BlockType.COMMAND, text: 'set my status to [STATUS]', arguments: { STATUS: { type: Scratch.ArgumentType.STRING, menu: 'statusMenu', defaultValue: 'online' } } },
          { opcode: 'isUserConnected', blockType: Scratch.BlockType.BOOLEAN, text: 'is [USER] online?', arguments: { USER: { type: Scratch.ArgumentType.STRING, defaultValue: 'username' } } },
          { opcode: 'whenUserJoins', blockType: Scratch.BlockType.HAT, text: 'when someone comes online' },
          { opcode: 'whenUserLeaves', blockType: Scratch.BlockType.HAT, text: 'when someone goes offline' },
          { opcode: 'lastUserJoined', blockType: Scratch.BlockType.REPORTER, text: 'last user online' },
          { opcode: 'lastUserLeft', blockType: Scratch.BlockType.REPORTER, text: 'last user offline' },
          { blockType: Scratch.BlockType.LABEL, text: 'DMs' },
          { opcode: 'sendIM', blockType: Scratch.BlockType.COMMAND, text: 'DM [TO] [MSG]', arguments: { TO: { type: Scratch.ArgumentType.STRING, defaultValue: 'username' }, MSG: { type: Scratch.ArgumentType.STRING, defaultValue: 'hii!' } } },
          { opcode: 'replyToStatus', blockType: Scratch.BlockType.COMMAND, text: 'reply to [TO]\'s status with [MSG]', arguments: { TO: { type: Scratch.ArgumentType.STRING, defaultValue: 'username' }, MSG: { type: Scratch.ArgumentType.STRING, defaultValue: 'same!' } } },
          { opcode: 'canReplyToStatus', blockType: Scratch.BlockType.BOOLEAN, text: 'can I reply to [USER]\'s status?', arguments: { USER: { type: Scratch.ArgumentType.STRING, defaultValue: 'username' } } },
          { opcode: 'whenIMReceived', blockType: Scratch.BlockType.HAT, text: 'when I get a DM' },
          { opcode: 'whenIMReceivedFrom', blockType: Scratch.BlockType.HAT, text: 'when I get a DM from [USER]', arguments: { USER: { type: Scratch.ArgumentType.STRING, defaultValue: 'username' } } },
          { opcode: 'lastIMSender', blockType: Scratch.BlockType.REPORTER, text: 'last DM sender' },
          { opcode: 'lastIMContent', blockType: Scratch.BlockType.REPORTER, text: 'last DM text' },
          { opcode: 'lastIMJson', blockType: Scratch.BlockType.REPORTER, text: 'last DM as JSON' },
          { opcode: 'lastIMStatusReply', blockType: Scratch.BlockType.REPORTER, text: 'status the last DM replied to' },
          { opcode: 'lastIMDelivered', blockType: Scratch.BlockType.BOOLEAN, text: 'last DM delivered?' },
          { opcode: 'getIMThread', blockType: Scratch.BlockType.REPORTER, text: 'DMs with [USER] as JSON', arguments: { USER: { type: Scratch.ArgumentType.STRING, defaultValue: 'username' } } },
          { opcode: 'getIMConversations', blockType: Scratch.BlockType.REPORTER, text: 'my DMs as JSON' },
          { opcode: 'getIMUnread', blockType: Scratch.BlockType.REPORTER, text: 'unread DMs' },
          { opcode: 'markIMRead', blockType: Scratch.BlockType.COMMAND, text: 'mark DMs from [USER] as read', arguments: { USER: { type: Scratch.ArgumentType.STRING, defaultValue: 'username' } } },
          { opcode: 'deleteIM', blockType: Scratch.BlockType.COMMAND, text: 'delete DM [ID]', arguments: { ID: { type: Scratch.ArgumentType.NUMBER, defaultValue: 0 } } },
          { opcode: 'whenMailReceived', blockType: Scratch.BlockType.HAT, text: 'when vMail received', hideFromPalette: true },
          { opcode: 'sendMail', blockType: Scratch.BlockType.COMMAND, text: 'send vMail to [TO] subject [SUBJECT] message [MSG]', hideFromPalette: true, arguments: { TO: { type: Scratch.ArgumentType.STRING, defaultValue: 'username' }, SUBJECT: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, MSG: { type: Scratch.ArgumentType.STRING, defaultValue: 'Message here' } } },
          { opcode: 'getMailList', blockType: Scratch.BlockType.REPORTER, text: 'legacy inbox entries', hideFromPalette: true },
          { opcode: 'getMailBody', blockType: Scratch.BlockType.REPORTER, text: 'legacy inbox entry [N] text', hideFromPalette: true, arguments: { N: { type: Scratch.ArgumentType.NUMBER, defaultValue: 1 } } },
          { opcode: 'deleteMail', blockType: Scratch.BlockType.COMMAND, text: 'delete vMail at index [N]', hideFromPalette: true, arguments: { N: { type: Scratch.ArgumentType.NUMBER, defaultValue: 1 } } },
          { opcode: 'deleteAllMail', blockType: Scratch.BlockType.COMMAND, text: 'delete all vMail', hideFromPalette: true },
          { blockType: Scratch.BlockType.LABEL, text: 'Friends' },
          { opcode: 'getFriendsList', blockType: Scratch.BlockType.REPORTER, text: 'my friends' },
          { opcode: 'sendFriendRequest', blockType: Scratch.BlockType.COMMAND, text: 'send friend request to [USER]', arguments: { USER: { type: Scratch.ArgumentType.STRING, defaultValue: 'username' } } },
          { opcode: 'acceptFriendReq', blockType: Scratch.BlockType.COMMAND, text: 'accept friend request from [USER]', arguments: { USER: { type: Scratch.ArgumentType.STRING, defaultValue: 'username' } } },
          { opcode: 'declineFriendReq', blockType: Scratch.BlockType.COMMAND, text: 'decline friend request from [USER]', arguments: { USER: { type: Scratch.ArgumentType.STRING, defaultValue: 'username' } } },
          { opcode: 'removeFriend', blockType: Scratch.BlockType.COMMAND, text: 'remove friend [USER]', arguments: { USER: { type: Scratch.ArgumentType.STRING, defaultValue: 'username' } } },
          { opcode: 'whenFriendRequest', blockType: Scratch.BlockType.HAT, text: 'when I get a friend request' },
          { opcode: 'whenFriendAccepted', blockType: Scratch.BlockType.HAT, text: 'when my friend request is accepted' },
          { opcode: 'getFriendRequests', blockType: Scratch.BlockType.REPORTER, text: 'friend requests' },
          { opcode: 'getFriendStatus', blockType: Scratch.BlockType.REPORTER, text: 'friend status with [USER]', arguments: { USER: { type: Scratch.ArgumentType.STRING, defaultValue: 'username' } } },
          { opcode: 'getFriendCount', blockType: Scratch.BlockType.REPORTER, text: 'friend count' },
          { opcode: 'blockUser', blockType: Scratch.BlockType.COMMAND, text: 'block user [USER]', arguments: { USER: { type: Scratch.ArgumentType.STRING, defaultValue: 'username' } } },
          { opcode: 'unblockUser', blockType: Scratch.BlockType.COMMAND, text: 'unblock user [USER]', arguments: { USER: { type: Scratch.ArgumentType.STRING, defaultValue: 'username' } } },
          { opcode: 'getBlockedUsers', blockType: Scratch.BlockType.REPORTER, text: 'blocked users' },
          { opcode: 'isUserBlocked', blockType: Scratch.BlockType.BOOLEAN, text: 'is [USER] blocked?', arguments: { USER: { type: Scratch.ArgumentType.STRING, defaultValue: 'username' } } },
          { opcode: 'setDmPrivacy', blockType: Scratch.BlockType.COMMAND, text: 'set who can DM me to [WHO]', arguments: { WHO: { type: Scratch.ArgumentType.STRING, menu: 'dmPrivacyOptions', defaultValue: 'everyone' } } },
          { opcode: 'getDmPrivacy', blockType: Scratch.BlockType.REPORTER, text: 'who can DM me' },
          { blockType: Scratch.BlockType.LABEL, text: 'Notifications' },
          { opcode: 'whenNotificationReceived', blockType: Scratch.BlockType.HAT, text: 'when I get a notification' },
          { opcode: 'notificationCount', blockType: Scratch.BlockType.REPORTER, text: 'notification count' },
          { opcode: 'unreadNotificationCount', blockType: Scratch.BlockType.REPORTER, text: 'unread notifications' },
          { opcode: 'getNotifications', blockType: Scratch.BlockType.REPORTER, text: 'notifications as JSON' },
          { opcode: 'clearNotifications', blockType: Scratch.BlockType.COMMAND, text: 'clear notifications' },
          { opcode: 'lastNotificationTitle', blockType: Scratch.BlockType.REPORTER, text: 'last notification title' },
          { opcode: 'lastNotificationBody', blockType: Scratch.BlockType.REPORTER, text: 'last notification text' },
      ];
      if (!this._coreApi()) blocks.unshift({ func: '_addCore', blockType: Scratch.BlockType.BUTTON, text: 'Add Nookara Login' });
      return {
        id: EXT_ID,
        name: 'Nookara Social',
        color1: '#7c3aed',
        color2: '#5b21b6',
        color3: '#4c1d95',
        docsURI: 'https://nookara.cc/guides/nookara-extensions',
        blocks,
        menus: {
          activityTypes: { acceptReporters: false, items: ['playing', 'listening', 'watching', 'competing', 'streaming', 'custom'] },
          statusMenu: { acceptReporters: false, items: ['online', 'idle', 'dnd', 'invisible'] },
          dmPrivacyOptions: { acceptReporters: true, items: ['everyone', { text: 'friends', value: 'friends only' }, { text: 'server members', value: 'members in my servers' }] },
        },
      };
    }

    // ── the link to Nookara Login. the core may load after this, projects load their extensions all at once ──
    _coreApi() {
      const api = this.runtime.ext_ikelenenookaralogin?.api;
      return api && api.version === API_VERSION ? api : null;
    }

    _core() {
      const api = this._coreApi();
      if (api) return api;
      if (this.runtime.ext_ikelenenookaralogin) throw new Error('Update the Nookara Login extension, this one needs a newer version.');
      throw new Error("This block needs the Nookara Login extension. Use the 'Add Nookara Login' button in this extension's blocks.");
    }

    _linkCore() {
      const api = this._coreApi();
      if (!api || this._linked === api) return;
      this._linked = api;
      api.on('message', msg => this._handleWS(msg));
      api.on('connect', () => this._onConnect());
      api.on('login', () => this._onLogin());
      api.on('logout', () => this._onLogout());
      api.on('disconnect', () => this._onDisconnect());
      if (api.isSocketReady()) this._onConnect();
      if (api.isAuthenticated()) this._onLogin();
      // the button goes away. not on first load though, nothing is registered yet
      const manager = Scratch.vm.extensionManager;
      if (manager.isExtensionLoaded(EXT_ID)) manager.refreshBlocks?.(EXT_ID);
    }

    _addCore() {
      return Scratch.vm.extensionManager.loadExtensionURL(CORE_URL);
    }

    get _token() { const api = this._coreApi(); return api ? api.getToken() : null; }
    get _user() { const api = this._coreApi(); return api ? api.getUser() : null; }
    get _username() { const api = this._coreApi(); return api ? api.getUsername() : ''; }
    get _authenticated() { const api = this._coreApi(); return api ? api.isAuthenticated() : false; }
    get _connected() { const api = this._coreApi(); return api ? api.isConnected() : false; }
    get _wsReady() { const api = this._coreApi(); return api ? api.isSocketReady() : false; }
    get _wsAuthed() { const api = this._coreApi(); return api ? api.isSocketAuthed() : false; }
    get _grantedScopes() { const api = this._coreApi(); return api ? api.getScopes() : 0; }
    get _disabledScopes() { const api = this._coreApi(); return api ? api.getDisabledScopes() : 0; }
    get _accountObj() { const api = this._coreApi(); return api ? api.getAccount() : {}; }
    get _ws() { const api = this._coreApi(); return api ? api.getSocket() : null; }
    get _lastActionOutput() { return this._coreApi()?.getLastAction().output ?? ''; }
    set _lastActionOutput(value) { const api = this._coreApi(); if (api) api.setLastAction(value, api.getLastAction().success); }
    get _lastActionSuccess() { return this._coreApi()?.getLastAction().success ?? false; }
    set _lastActionSuccess(value) { const api = this._coreApi(); if (api) api.setLastAction(api.getLastAction().output, value); }
    _http(...args) { return this._core().http(...args); }
    _cmd(...args) { return this._core().cmd(...args); }
    _bfRequest(...args) { return this._core().request(...args); }
    _requireScope(...args) { return this._core().requireScope(...args); }
    _scopeErrorFromData(...args) { return this._core().scopeError(...args); }
    _missingScopeText(...args) { return this._core().missingScopeText(...args); }
    _wsSend(...args) { return this._core().send(...args); }
    _connectWS(...args) { return this._core().connect(...args); }
    _bfEnsureSocket(...args) { return this._core().ensureSocket(...args); }
    _waitForWS(...args) { return this._core().ensureSocket(...args); }


    _onConnect() {
        this._getOnlinePlayers();
        if (!this._onlineTimer) this._onlineTimer = setInterval(() => { if (this._ws?.readyState === 1) this._getOnlinePlayers(); }, 30000);
    }
    _onLogin() {
        if (this._rich) this._wsSend({ type: 'set_rich_presence', activity: this._rich });
        this._fetchFriends();
        this._fetchMail();
        this._fetchNotifications();
        if (!this._notifInterval) this._notifInterval = setInterval(() => { if (this._token) this._fetchNotifications(); }, 30000);
    }
    _onLogout() {
        if (this._notifInterval) { clearInterval(this._notifInterval); this._notifInterval = null; }
        this._rich = null;
    }
    _onDisconnect() {
        this._imPending.forEach(p => p.reject(new Error('disconnected')));
        this._imPending.clear();
    }

    _handleWS(msg) {
      switch (msg.type) {
        case 'presence_update': {
          const k = Scratch.Cast.toString(msg.username || '').toLowerCase();
          this._presence[k] = msg.presence;
          if (!msg.request) { this._presenceEvt[k] = true; this._presenceEvt['*'] = true; this._lastPresenceUser = msg.username; }
          break;
        }
        case 'user_joined':
          this._lastUserJoined = msg.username;
          this._evtUserJoined = true;
          this._onlinePlayers = this._onlinePlayers.filter(p => p.username !== msg.username);
          this._onlinePlayers.push({ username: msg.username, rank: msg.rank, status: 'online' });
          break;
        case 'user_left':
          this._lastUserLeft = msg.username;
          this._evtUserLeft = true;
          this._onlinePlayers = this._onlinePlayers.filter(p => p.username !== msg.username);
          break;
        case 'status_changed': {
          const p = this._onlinePlayers.find(p => p.username === msg.username);
          if (p) p.status = msg.status || 'online';
          break;
        }
        case 'onlinePlayers':
          this._onlinePlayers = msg.players;
          break;
        case 'im_received': {
          const m = msg.message || {};
          this._lastIM = m;
          this._imUnread++;
          this._evtMailReceived = true;
          this._evtIMReceived = true;
          this._evtIMFromMap[Scratch.Cast.toString(m.from || '').toLowerCase()] = true;
          if (Array.isArray(this._mail)) this._mail.unshift({ ...m, from_username: m.from, subject: '' });
          break;
        }
        case 'im_unread':
          this._imUnread = Number(msg.count) || 0;
          if (this._imUnread > 0) this._fetchMail();
          break;
        case 'im_ack':
        case 'im_error': {
          const p = this._imPending.get(msg.nonce);
          if (!p) break;
          this._imPending.delete(msg.nonce);
          if (msg.type === 'im_ack') p.resolve(msg); else p.reject(new Error(msg.error === 'user_blocked' ? (msg.message || "You can't message this user") : msg.error === 'dm_privacy' ? (msg.message || 'Failed to send this message due to the users privacy settings') : (msg.error || 'send_failed')));
          break;
        }
        case 'mail_received':
          break;
        case 'friend_request':
          this._evtFriendRequest = true;
          this._fetchFriends();
          break;
        case 'friend_request_accepted':
          this._evtFriendAccepted = true;
          this._fetchFriends();
          break;
        case 'friend_online':
        case 'friend_offline':
          this._fetchFriends();
          break;
      }
    }
    _getOnlinePlayers() {
      this._wsSend({ type: 'getOnlinePlayers' });
    }
    async _fetchFriends() {
      if (!this._token) return;
      try {
        const data = await this._http('/friends');
        if (data.friends) this._friends = data.friends;
      } catch (e) {
        if (e.message === 'insufficient_scope') this._friends = 'Permission Denied';
      }
      try {
        const reqData = await this._http('/friends/requests');
        if (reqData.incoming) this._friendRequests = reqData.incoming;
      } catch (e) {
        if (e.message === 'insufficient_scope') this._friendRequests = 'Permission Denied';
      }
    }
    whenMailReceived()        { const v = this._evtMailReceived;   this._evtMailReceived = false;   return v; }
    whenIMReceived()          { const v = this._evtIMReceived;     this._evtIMReceived = false;     return v; }
    whenIMReceivedFrom({ USER }) {
      const k = Scratch.Cast.toString(USER).trim().toLowerCase();
      const v = !!this._evtIMFromMap[k];
      this._evtIMFromMap[k] = false;
      return v;
    }
    whenFriendRequest()       { const v = this._evtFriendRequest;  this._evtFriendRequest = false;  return v; }
    whenFriendAccepted()      { const v = this._evtFriendAccepted; this._evtFriendAccepted = false; return v; }
    whenUserJoins()           { const v = this._evtUserJoined;     this._evtUserJoined = false;     return v; }
    whenUserLeaves()          { const v = this._evtUserLeft;       this._evtUserLeft = false;       return v; }
    whenNotificationReceived(){ const v = this._evtNotification;   this._evtNotification = false;   return v; }
    isUserConnected({ USER }) {
      return this._onlinePlayers.some(p => p.username === USER);
    }
    lastUserJoined()    { return this._lastUserJoined; }
    lastUserLeft()      { return this._lastUserLeft; }
    getFriendCount()    { if (!this._authenticated) throw new Error('Not logged in'); this._requireScope(SCOPES.FRIENDS_READ); return this._friends.length; }
    getFriendsList()    { if (!this._authenticated) throw new Error('Not logged in'); this._requireScope(SCOPES.FRIENDS_READ); return JSON.stringify(this._friends); }
    getFriendRequests() { if (!this._authenticated) throw new Error('Not logged in'); this._requireScope(SCOPES.FRIENDS_READ); return JSON.stringify(this._friendRequests); }
    getMailList()       { if (!this._authenticated) throw new Error('Not logged in'); this._requireScope(SCOPES.VMAIL_READ); return JSON.stringify(this._mail); }
    connectedUsers() {
      if (!this._connected) return 'Not connected';
      const obj = {};
      for (const p of this._onlinePlayers) obj[p.username] = { status: p.status || 'online', rank: p.rank || '' };
      return JSON.stringify(obj);
    }
    notificationCount()     { return this._notifications.length; }
    async unreadNotificationCount() {
      if (!this._token) return 0;
      const data = await this._http('/account/notifications/unread-count').catch(() => ({}));
      return data.unread ?? 0;
    }
    getNotifications()      { return JSON.stringify(this._notifications); }
    lastNotificationTitle() { return this._lastNotifTitle; }
    lastNotificationBody()  { return this._lastNotifBody; }
    async rpIsMobile({ USER }) {
      if (!this._authenticated) return false;
      const p = await this._presenceOf(USER);
      return !!(p && p.mobile && p.status !== 'offline');
    }
    async rpIsConsole({ USER }) {
      if (!this._authenticated) return false;
      const p = await this._presenceOf(USER);
      return !!(p && p.console && p.status !== 'offline');
    }
    async rpIsAutoIdle({ USER }) {
      if (!this._authenticated) return false;
      const p = await this._presenceOf(USER);
      return !!(p && p.auto_idle && p.status !== 'offline');
    }
    setStatus({ STATUS }) {
      this._status = STATUS;
      this._wsSend({ type: 'set_status', status: STATUS });
    }
    async sendIM() {
      this._requireScope(SCOPES.VMAIL_SEND);
      return this._dmsEncrypted();
    }
    lastIMSender()    { return this._lastIM?.from || ''; }
    lastIMContent()   { return this._lastIM?.body || ''; }
    lastIMStatusReply() { return this._lastIM?.status_reply?.text || ''; }
    _dmsEncrypted() {
      this._lastActionSuccess = false;
      throw new Error('Direct messages are end-to-end encrypted now, and a project cannot keep keys safe. People can message each other in Ember.');
    }
    async replyToStatus() {
      this._requireScope(SCOPES.VMAIL_SEND);
      return this._dmsEncrypted();
    }
    async canReplyToStatus({ USER }) {
      if (!this._authenticated) return false;
      const data = await this._http(`/im/status-reply/${encodeURIComponent(Scratch.Cast.toString(USER).trim())}`).catch(() => ({}));
      return !!data.can;
    }
    lastIMJson()      { return this._lastIM ? JSON.stringify(this._lastIM) : ''; }
    lastIMDelivered() { return this._lastIMDelivered; }
    async getIMThread({ USER }) {
      if (!this._authenticated) throw new Error('Not logged in');
      this._requireScope(SCOPES.VMAIL_READ);
      const data = await this._http(`/im/with/${encodeURIComponent(Scratch.Cast.toString(USER).trim())}?limit=100`).catch(() => ({}));
      if (data.error) throw (this._scopeErrorFromData(data) || new Error(data.error));
      return JSON.stringify(data.messages || []);
    }
    async getIMConversations() {
      if (!this._authenticated) throw new Error('Not logged in');
      this._requireScope(SCOPES.VMAIL_READ);
      const data = await this._http('/im/conversations').catch(() => ({}));
      if (data.error) throw (this._scopeErrorFromData(data) || new Error(data.error));
      return JSON.stringify(data.conversations || []);
    }
    async getIMUnread() {
      if (!this._authenticated) throw new Error('Not logged in');
      this._requireScope(SCOPES.VMAIL_READ);
      await this._refreshIMUnread();
      return this._imUnread;
    }
    async _refreshIMUnread() {
      const data = await this._http('/im/unread-count').catch(() => ({}));
      if (typeof data.unread === 'number') this._imUnread = data.unread;
    }
    async markIMRead({ USER }) {
      this._requireScope(SCOPES.VMAIL_READ);
      await this._cmd(`/im/with/${encodeURIComponent(Scratch.Cast.toString(USER).trim())}/read`, 'POST');
      await this._refreshIMUnread();
    }
    async deleteIM({ ID }) {
      this._requireScope(SCOPES.VMAIL_SEND);
      const id = parseInt(ID);
      if (!id) return;
      await this._cmd(`/im/${id}`, 'DELETE');
      if (Array.isArray(this._mail)) this._mail = this._mail.filter(m => m.id !== id);
    }
    async sendMail({ TO, MSG }) {
      return this.sendIM({ TO, MSG });
    }
    getMailBody({ N }) {
      if (!this._authenticated) throw new Error('Not logged in');
      this._requireScope(SCOPES.VMAIL_READ);
      const idx = parseInt(N) - 1;
      return this._mail[idx]?.body ?? '';
    }
    async deleteMail({ N }) {
      this._requireScope(SCOPES.VMAIL_SEND);
      const idx = parseInt(N) - 1;
      const mail = this._mail[idx];
      if (!mail) return;
      await this._cmd(`/mail/${mail.id}`, 'DELETE');
      this._mail.splice(idx, 1);
    }
    async deleteAllMail() {
      this._requireScope(SCOPES.VMAIL_SEND);
      await this._cmd('/mail', 'DELETE');
      this._mail = [];
    }
    async sendFriendRequest({ USER }) {
      this._requireScope(SCOPES.FRIENDS_MANAGE);
      await this._cmd('/friends/request', 'POST', { username: USER });
    }
    async acceptFriendReq({ USER }) {
      this._requireScope(SCOPES.FRIENDS_MANAGE);
      const req = this._friendRequests.find(r => r.from_username === USER);
      if (!req) return;
      await this._cmd(`/friends/request/${req.id}/accept`, 'PATCH');
      await this._fetchFriends();
    }
    async declineFriendReq({ USER }) {
      this._requireScope(SCOPES.FRIENDS_MANAGE);
      const req = this._friendRequests.find(r => r.from_username === USER);
      if (!req) return;
      await this._cmd(`/friends/request/${req.id}/decline`, 'PATCH');
      await this._fetchFriends();
    }
    async removeFriend({ USER }) {
      this._requireScope(SCOPES.FRIENDS_MANAGE);
      await this._cmd(`/friends/${encodeURIComponent(USER)}`, 'DELETE');
      await this._fetchFriends();
    }
    async blockUser({ USER }) {
      this._requireScope(SCOPES.FRIENDS_MANAGE);
      await this._cmd('/account/blocks', 'POST', { username: String(USER) });
      await this._fetchFriends();
    }
    async unblockUser({ USER }) {
      this._requireScope(SCOPES.FRIENDS_MANAGE);
      await this._cmd(`/account/blocks/${encodeURIComponent(USER)}`, 'DELETE');
    }
    async getBlockedUsers() {
      if (!this._authenticated) throw new Error('Not logged in');
      this._requireScope(SCOPES.FRIENDS_READ);
      const data = await this._http('/account/blocks').catch(() => ({}));
      return JSON.stringify(data.blocks || []);
    }
    async isUserBlocked({ USER }) {
      if (!this._authenticated) throw new Error('Not logged in');
      this._requireScope(SCOPES.FRIENDS_READ);
      const name = String(USER).trim().toLowerCase();
      const data = await this._http('/account/blocks').catch(() => ({}));
      return (data.blocks || []).some(b => String(b.username).toLowerCase() === name);
    }
    async setDmPrivacy({ WHO }) {
      this._requireScope(SCOPES.CHAT);
      const w = String(WHO).trim().toLowerCase();
      const value = w === 'friends' || w === 'friends only' ? 'friends' : w === 'servers' || w.startsWith('members') ? 'servers' : w === 'everyone' ? 'everyone' : null;
      if (!value) throw new Error('Unknown DM privacy option');
      await this._cmd('/account/dm-privacy', 'PATCH', { dm_privacy: value });
    }
    async getDmPrivacy() {
      if (!this._authenticated) throw new Error('Not logged in');
      this._requireScope(SCOPES.CHAT);
      const data = await this._http('/account/dm-privacy').catch(() => ({}));
      return ({ friends: 'friends only', servers: 'members in my servers' })[data.dm_privacy] || data.dm_privacy || 'everyone';
    }
    async getFriendStatus({ USER }) {
      if (!this._authenticated) throw new Error('Not logged in');
      this._requireScope(SCOPES.FRIENDS_READ);
      const data = await this._http(`/friends/status/${encodeURIComponent(USER)}`).catch(() => ({}));
      return data.status ?? 'none';
    }
    async clearNotifications() {
      await this._cmd('/notifications/read-all', 'PATCH');
      this._notifications = [];
      this._lastNotifTitle = '';
      this._lastNotifBody = '';
    }
    async _fetchNotifications() {
      if (!this._token) return;
      const data = await this._http('/notifications').catch(() => ({}));
      const notifs = data.notifications || [];
      if (notifs.length > this._notifications.length && this._notifications.length >= 0) {
        const newest = notifs[0];
        if (newest) { this._lastNotifTitle = newest.title || ''; this._lastNotifBody = newest.body || ''; }
        this._evtNotification = true;
      }
      this._notifications = notifs;
    }
  }

  const SCOPES = {
    PROFILE_READ: 1,
    PROFILE_SENSITIVE: 2,
    PROJECT_AUTH: 4,
    ACCOUNT_WRITE: 8,
    STORAGE_READ: 16,
    STORAGE_WRITE: 32,
    VMAIL_READ: 64,
    VMAIL_SEND: 128,
    FRIENDS_READ: 256,
    FRIENDS_MANAGE: 512,
    CURRENCY_PAY: 1024,
    CHAT: 2048,
    MEDIA_UPLOAD: 4096,
    CURRENCY_READ: 8192,
    VOICE: 16384,
    SIGN_MESSAGES: 32768,
  };
  const VELORA_ROUTES = [
  {
    "opcode": "bfGetChatUsersUsername",
    "blockType": "reporter",
    "text": "chat account details for [USERNAME]",
    "arguments": {
      "USERNAME": {
        "type": "string",
        "defaultValue": ""
      }
    },
    "method": "GET",
    "path": "/chat/users/:username",
    "params": [
      "username"
    ],
    "query": [],
    "body": false,
    "upload": false,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfGetChatPresenceUsername",
    "blockType": "reporter",
    "text": "availability data for [USERNAME]",
    "arguments": {
      "USERNAME": {
        "type": "string",
        "defaultValue": ""
      }
    },
    "method": "GET",
    "path": "/chat/presence/:username",
    "params": [
      "username"
    ],
    "query": [],
    "body": false,
    "upload": false,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfPostChatPresenceStatus",
    "blockType": "command",
    "text": "create / send Nookara presence status options JSON [OPTIONS]",
    "arguments": {
      "OPTIONS": {
        "type": "string",
        "defaultValue": "{}"
      }
    },
    "method": "POST",
    "path": "/chat/presence/status",
    "params": [],
    "query": [],
    "body": true,
    "upload": false,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfPostChatPresenceCustom",
    "blockType": "command",
    "text": "create / send Nookara presence custom options JSON [OPTIONS]",
    "arguments": {
      "OPTIONS": {
        "type": "string",
        "defaultValue": "{}"
      }
    },
    "method": "POST",
    "path": "/chat/presence/custom",
    "params": [],
    "query": [],
    "body": true,
    "upload": false,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfPostChatPresenceActivity",
    "blockType": "command",
    "text": "create / send Nookara presence activity options JSON [OPTIONS]",
    "arguments": {
      "OPTIONS": {
        "type": "string",
        "defaultValue": "{}"
      }
    },
    "method": "POST",
    "path": "/chat/presence/activity",
    "params": [],
    "query": [],
    "body": true,
    "upload": false,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfDeleteChatPresenceActivityKey",
    "blockType": "command",
    "text": "remove Nookara presence activity [KEY]",
    "arguments": {
      "KEY": {
        "type": "string",
        "defaultValue": ""
      }
    },
    "method": "DELETE",
    "path": "/chat/presence/activity/:key?",
    "params": [
      "key"
    ],
    "query": [],
    "body": false,
    "upload": false,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfPutChatDmIdReactionsEmoji",
    "blockType": "command",
    "text": "set Nookara dm [ID] reactions [EMOJI] options JSON [OPTIONS]",
    "arguments": {
      "ID": {
        "type": "string",
        "defaultValue": ""
      },
      "EMOJI": {
        "type": "string",
        "defaultValue": ""
      },
      "OPTIONS": {
        "type": "string",
        "defaultValue": "{}"
      }
    },
    "method": "PUT",
    "path": "/chat/dm/:id/reactions/:emoji",
    "params": [
      "id",
      "emoji"
    ],
    "query": [],
    "body": true,
    "upload": false,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfDeleteChatDmIdReactionsEmoji",
    "blockType": "command",
    "text": "remove Nookara dm [ID] reactions [EMOJI]",
    "arguments": {
      "ID": {
        "type": "string",
        "defaultValue": ""
      },
      "EMOJI": {
        "type": "string",
        "defaultValue": ""
      }
    },
    "method": "DELETE",
    "path": "/chat/dm/:id/reactions/:emoji",
    "params": [
      "id",
      "emoji"
    ],
    "query": [],
    "body": false,
    "upload": false,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfGetGroups",
    "blockType": "reporter",
    "text": "group directory data",
    "arguments": {},
    "method": "GET",
    "path": "/groups",
    "params": [],
    "query": [],
    "body": false,
    "upload": false,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfPostGroups",
    "blockType": "command",
    "text": "create / send Nookara groups options JSON [OPTIONS]",
    "arguments": {
      "OPTIONS": {
        "type": "string",
        "defaultValue": "{}"
      }
    },
    "method": "POST",
    "path": "/groups",
    "params": [],
    "query": [],
    "body": true,
    "upload": false,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfGetGroupsRoom",
    "blockType": "reporter",
    "text": "group details for [ROOM]",
    "arguments": {
      "ROOM": {
        "type": "string",
        "defaultValue": ""
      }
    },
    "method": "GET",
    "path": "/groups/:room",
    "params": [
      "room"
    ],
    "query": [],
    "body": false,
    "upload": false,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfGetGroupsRoomMessages",
    "blockType": "reporter",
    "text": "group history for [ROOM] with filters [QUERY]",
    "arguments": {
      "ROOM": {
        "type": "string",
        "defaultValue": ""
      },
      "QUERY": {
        "type": "string",
        "defaultValue": "{\"limit\": 100}"
      }
    },
    "method": "GET",
    "path": "/groups/:room/messages",
    "params": [
      "room"
    ],
    "query": [
      "limit"
    ],
    "body": false,
    "upload": false,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfPostGroupsRoomMessages",
    "blockType": "command",
    "text": "create / send Nookara [ROOM] messages options JSON [OPTIONS]",
    "arguments": {
      "ROOM": {
        "type": "string",
        "defaultValue": ""
      },
      "OPTIONS": {
        "type": "string",
        "defaultValue": "{}"
      }
    },
    "method": "POST",
    "path": "/groups/:room/messages",
    "params": [
      "room"
    ],
    "query": [],
    "body": true,
    "upload": false,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfPostGroupsRoomMembers",
    "blockType": "command",
    "text": "create / send Nookara [ROOM] members options JSON [OPTIONS]",
    "arguments": {
      "ROOM": {
        "type": "string",
        "defaultValue": ""
      },
      "OPTIONS": {
        "type": "string",
        "defaultValue": "{}"
      }
    },
    "method": "POST",
    "path": "/groups/:room/members",
    "params": [
      "room"
    ],
    "query": [],
    "body": true,
    "upload": false,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfDeleteGroupsRoomMembersUsername",
    "blockType": "command",
    "text": "remove Nookara [ROOM] members [USERNAME]",
    "arguments": {
      "ROOM": {
        "type": "string",
        "defaultValue": ""
      },
      "USERNAME": {
        "type": "string",
        "defaultValue": ""
      }
    },
    "method": "DELETE",
    "path": "/groups/:room/members/:username",
    "params": [
      "room",
      "username"
    ],
    "query": [],
    "body": false,
    "upload": false,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfPatchGroupsRoom",
    "blockType": "command",
    "text": "update Nookara [ROOM] options JSON [OPTIONS]",
    "arguments": {
      "ROOM": {
        "type": "string",
        "defaultValue": ""
      },
      "OPTIONS": {
        "type": "string",
        "defaultValue": "{}"
      }
    },
    "method": "PATCH",
    "path": "/groups/:room",
    "params": [
      "room"
    ],
    "query": [],
    "body": true,
    "upload": false,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfDeleteGroupsRoom",
    "blockType": "command",
    "text": "remove Nookara [ROOM]",
    "arguments": {
      "ROOM": {
        "type": "string",
        "defaultValue": ""
      }
    },
    "method": "DELETE",
    "path": "/groups/:room",
    "params": [
      "room"
    ],
    "query": [],
    "body": false,
    "upload": false,
    "scopes": [
      2048
    ]
  },
    {
      "opcode": "bfPatchGroupsRoomMessagesId",
      "blockType": "command",
      "text": "edit my message [ID] in group [ROOM] options JSON [OPTIONS]",
      "arguments": {
        "ID": {
          "type": "string",
          "defaultValue": ""
        },
        "ROOM": {
          "type": "string",
          "defaultValue": ""
        },
        "OPTIONS": {
          "type": "string",
          "defaultValue": "{\"message\":\"Hello!\"}"
        }
      },
      "method": "PATCH",
      "path": "/groups/:room/messages/:id",
      "params": [
        "room",
        "id"
      ],
      "query": [],
      "body": true,
      "upload": false,
      "scopes": [
        2048
      ]
    },
    {
      "opcode": "bfDeleteGroupsRoomMessagesId",
      "blockType": "command",
      "text": "delete my message [ID] in group [ROOM]",
      "arguments": {
        "ID": {
          "type": "string",
          "defaultValue": ""
        },
        "ROOM": {
          "type": "string",
          "defaultValue": ""
        }
      },
      "method": "DELETE",
      "path": "/groups/:room/messages/:id",
      "params": [
        "room",
        "id"
      ],
      "query": [],
      "body": false,
      "upload": false,
      "scopes": [
        2048
      ]
    },
    {
      "opcode": "bfPutGroupsRoomMessagesIdReactionsEmoji",
      "blockType": "command",
      "text": "react [EMOJI] to message [ID] in group [ROOM]",
      "arguments": {
        "EMOJI": {
          "type": "string",
          "defaultValue": ""
        },
        "ID": {
          "type": "string",
          "defaultValue": ""
        },
        "ROOM": {
          "type": "string",
          "defaultValue": ""
        }
      },
      "method": "PUT",
      "path": "/groups/:room/messages/:id/reactions/:emoji",
      "params": [
        "room",
        "id",
        "emoji"
      ],
      "query": [],
      "body": false,
      "upload": false,
      "scopes": [
        2048
      ]
    },
    {
      "opcode": "bfDeleteGroupsRoomMessagesIdReactionsEmoji",
      "blockType": "command",
      "text": "remove my reaction [EMOJI] from message [ID] in group [ROOM]",
      "arguments": {
        "EMOJI": {
          "type": "string",
          "defaultValue": ""
        },
        "ID": {
          "type": "string",
          "defaultValue": ""
        },
        "ROOM": {
          "type": "string",
          "defaultValue": ""
        }
      },
      "method": "DELETE",
      "path": "/groups/:room/messages/:id/reactions/:emoji",
      "params": [
        "room",
        "id",
        "emoji"
      ],
      "query": [],
      "body": false,
      "upload": false,
      "scopes": [
        2048
      ]
    },
    {
      "opcode": "bfPutGroupsRoomMessagesIdPin",
      "blockType": "command",
      "text": "pin message [ID] in group [ROOM]",
      "arguments": {
        "ID": {
          "type": "string",
          "defaultValue": ""
        },
        "ROOM": {
          "type": "string",
          "defaultValue": ""
        }
      },
      "method": "PUT",
      "path": "/groups/:room/messages/:id/pin",
      "params": [
        "room",
        "id"
      ],
      "query": [],
      "body": false,
      "upload": false,
      "scopes": [
        2048
      ]
    },
    {
      "opcode": "bfDeleteGroupsRoomMessagesIdPin",
      "blockType": "command",
      "text": "unpin message [ID] in group [ROOM]",
      "arguments": {
        "ID": {
          "type": "string",
          "defaultValue": ""
        },
        "ROOM": {
          "type": "string",
          "defaultValue": ""
        }
      },
      "method": "DELETE",
      "path": "/groups/:room/messages/:id/pin",
      "params": [
        "room",
        "id"
      ],
      "query": [],
      "body": false,
      "upload": false,
      "scopes": [
        2048
      ]
    },
    {
      "opcode": "bfGetGroupsRoomPins",
      "blockType": "reporter",
      "text": "pinned messages in group [ROOM]",
      "arguments": {
        "ROOM": {
          "type": "string",
          "defaultValue": ""
        }
      },
      "method": "GET",
      "path": "/groups/:room/pins",
      "params": [
        "room"
      ],
      "query": [],
      "body": false,
      "upload": false,
      "scopes": [
        2048
      ]
    },
    {
      "opcode": "bfPutImIdPin",
      "blockType": "command",
      "text": "pin direct message [ID]",
      "arguments": {
        "ID": {
          "type": "string",
          "defaultValue": ""
        }
      },
      "method": "PUT",
      "path": "/im/:id/pin",
      "params": [
        "id"
      ],
      "query": [],
      "body": false,
      "upload": false,
      "scopes": [
        128
      ]
    },
    {
      "opcode": "bfDeleteImIdPin",
      "blockType": "command",
      "text": "unpin direct message [ID]",
      "arguments": {
        "ID": {
          "type": "string",
          "defaultValue": ""
        }
      },
      "method": "DELETE",
      "path": "/im/:id/pin",
      "params": [
        "id"
      ],
      "query": [],
      "body": false,
      "upload": false,
      "scopes": [
        128
      ]
    },
    {
      "opcode": "bfGetImWithUsernamePins",
      "blockType": "reporter",
      "text": "pinned direct messages with [USERNAME]",
      "arguments": {
        "USERNAME": {
          "type": "string",
          "defaultValue": ""
        }
      },
      "method": "GET",
      "path": "/im/with/:username/pins",
      "params": [
        "username"
      ],
      "query": [],
      "body": false,
      "upload": false,
      "scopes": [
        64
      ]
    }
];
  const bfString = value => Scratch.Cast.toString(value);
  Object.assign(NookaraExtension.prototype, {
    async rpCustom({ TEXT }) {
      this._requireScope(SCOPES.CHAT);
      await this._bfRequest('/chat/presence/custom', 'POST', { text: Scratch.Cast.toString(TEXT) });
    },
    async rpPresence({ USER }) {
      if (!this._authenticated) throw new Error('Not logged in');
      const p = await this._presenceOf(USER);
      return p ? JSON.stringify(p) : '';
    },
    async rpStatusOf({ USER }) {
      if (!this._authenticated) throw new Error('Not logged in');
      const p = await this._presenceOf(USER);
      return p ? p.status : 'offline';
    },
    async rpActivityOf({ USER }) {
      if (!this._authenticated) throw new Error('Not logged in');
      const p = await this._presenceOf(USER);
      const a = p?.activities?.[0];
      const verb = { playing: 'Playing', listening: 'Listening to', watching: 'Watching', competing: 'Competing in', streaming: 'Streaming' };
      if (a && a.platform === '3ds') return 'Playing on 3DS';
      if (a) return a.type === 'custom' ? a.name : `${verb[a.type] || 'Playing'} ${a.name}`;
      return p?.custom || '';
    },
    whenPresenceChanges({ USER }) {
      const u = Scratch.Cast.toString(USER).trim().toLowerCase();
      const k = !u || u === 'anyone' ? '*' : u;
      const v = !!this._presenceEvt[k];
      this._presenceEvt[k] = false;
      return v;
    },
    rpLastUser() { return this._lastPresenceUser || ''; },
    _bfJson(value, array = false) {
      let parsed;
      try { parsed = JSON.parse(bfString(value)); } catch { throw new Error('Enter valid JSON.'); }
      if (array ? !Array.isArray(parsed) : !parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error(array ? 'Expected a JSON array.' : 'Expected a JSON object.');
      return parsed;
    },
    async _bfRoute(spec, args) {
      this._lastActionSuccess = false;
      for (const bit of spec.scopes) this._requireScope(bit);
      let path = spec.path.replace(/:(\w+)\??/g, (_, key) => encodeURIComponent(bfString(args[key.toUpperCase()]).trim()));
      if (spec.query.length) {
        const query = this._bfJson(args.QUERY);
        const search = new URLSearchParams();
        for (const key of spec.query) if (query[key] !== undefined && query[key] !== null && query[key] !== '') search.set(key, bfString(query[key]));
        if (search.size) path += '?' + search;
      }
      const body = spec.body ? this._bfJson(args.OPTIONS) : null;
      let form = null;
      if (spec.upload) {
        const uri = bfString(args.FILE);
        if (!/^(data:|blob:)/.test(uri)) throw new Error('Choose a file or provide its data URI.');
        const response = await fetch(uri);
        if (!response.ok) throw new Error('Could not read the file.');
        form = new FormData();
        form.append('file', await response.blob(), bfString(args.FILENAME) || 'file');
        for (const [key, value] of Object.entries(body || {})) form.append(key, typeof value === 'object' ? JSON.stringify(value) : bfString(value));
      }
      return JSON.stringify(await this._bfRequest(path, spec.method, body, form));
    },
    async bfEditDM() { this._requireScope(SCOPES.VMAIL_SEND); return this._dmsEncrypted(); },
  });
  for (const spec of VELORA_ROUTES) NookaraExtension.prototype[spec.opcode] = function (args) { return this._bfRoute(spec, args); };
  NookaraExtension.prototype.rpSet = async function ({ TYPE, NAME, DETAILS, STATE }) {
    this._requireScope(SCOPES.CHAT);
    const name = bfString(NAME).trim();
    if (!name) throw new Error('Enter an activity name.');
    await this._bfEnsureSocket();
    const old = this._rich || {};
    this._rich = { type: bfString(TYPE).trim().toLowerCase(), name, details: bfString(DETAILS), state: bfString(STATE), image: old.image, since: old.name === name ? old.since : Date.now() };
    this._wsSend({ type: 'set_rich_presence', activity: this._rich });
  };
  NookaraExtension.prototype.rpImage = async function ({ URL }) {
    this._requireScope(SCOPES.CHAT);
    const url = bfString(URL).trim();
    if (url && !/^https:\/\//i.test(url)) throw new Error('Activity images need an HTTPS URL.');
    await this._bfEnsureSocket();
    this._rich ||= { type: 'playing', name: this._projectName || 'a Nookara project', since: Date.now() };
    this._rich.image = url || undefined;
    this._wsSend({ type: 'set_rich_presence', activity: this._rich });
  };
  NookaraExtension.prototype.rpClear = async function () {
    this._requireScope(SCOPES.CHAT);
    await this._bfEnsureSocket();
    this._rich = null;
    this._wsSend({ type: 'clear_rich_presence' });
  };
  NookaraExtension.prototype._presenceOf = async function (user) {
    const key = bfString(user).trim();
    if (!key) throw new Error('Enter a username.');
    const presence = await this._bfRequest(`/chat/presence/${encodeURIComponent(key)}`);
    this._presence[key.toLowerCase()] = presence;
    return presence;
  };
  NookaraExtension.prototype._fetchMail = async function () {
    if (!this._token) return;
    const data = await this._bfRequest('/im');
    this._mail = data.messages || data.mail || [];
    this._imUnread = this._mail.filter(m => !m.read).length;
  };
  const p19 = NookaraExtension.prototype;
  const identityEvents19 = p19._handleWS;
  p19._handleWS = function (frame) {
    if (['globalMessage', 'roomMessage', 'globalMessages', 'roomMessages'].includes(frame.type)) return;
    if (frame.type?.startsWith('chat_') && !/^chat_(rtc_|call_|error$)/.test(frame.type)) return;
    return identityEvents19.call(this, frame);
  };

  const veloraExt = new NookaraExtension(Scratch.vm.runtime);

  // the menus show plain words but keep their old values, a dropped reporter can say either
  const MENU_WORDS = { dmPrivacyOptions: { friends: 'friends only', 'server members': 'members in my servers' } };
  for (const block of veloraExt.getInfo().blocks) {
    const inputs = Object.entries(block?.arguments || {}).filter(([, arg]) => MENU_WORDS[arg.menu]);
    if (!inputs.length) continue;
    const fn = veloraExt[block.opcode];
    veloraExt[block.opcode] = function (args, ...rest) {
      const values = { ...args };
      for (const [name, arg] of inputs) values[name] = MENU_WORDS[arg.menu][Scratch.Cast.toString(values[name])] ?? values[name];
      return fn.call(this, values, ...rest);
    };
  }

  // no core yet: every block says so, instead of a confusing 'not logged in'
  for (const block of veloraExt.getInfo().blocks) {
    if (!block?.opcode || block.blockType === Scratch.BlockType.HAT || block.blockType === Scratch.BlockType.EVENT) continue;
    const fn = veloraExt[block.opcode];
    veloraExt[block.opcode] = function (...args) { this._core(); return fn.apply(this, args); };
  }


  for (const block of veloraExt.getInfo().blocks) {
    if (!block || typeof block !== 'object' || !block.opcode || block.blockType === Scratch.BlockType.HAT || block.blockType === Scratch.BlockType.EVENT) continue;
    const fn = veloraExt[block.opcode];
    if (typeof fn !== 'function' || fn.constructor?.name === 'AsyncFunction') continue;
    veloraExt[block.opcode] = function (...args) {
      try { return fn.apply(this, args); }
      catch (error) { return Promise.reject(error); }
    };
  }

  Scratch.extensions.register(veloraExt);
})(Scratch);
