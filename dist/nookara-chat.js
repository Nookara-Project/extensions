// Name: Nookara Chat
// ID: ikelenenookarachat
// Description: Ember servers, channels, messages, bots and game servers for Nookara. Needs Nookara Login.
// By: Ikelene
// License: MIT

// made by extensions/split/build.js from velora_extension.js, edit that one and rebuild
(function (Scratch) {
  'use strict';

  if (!Scratch.extensions.unsandboxed) throw new Error('Nookara Chat must run unsandboxed: it shares its sign-in with the other Nookara extensions.');

  const API_VERSION = 1;
  const CORE_URL = 'https://ikelene.net/gallery/extensions/nookara-login.js';
  const SERVER_HTTP = 'https://nookara.cc';
  const SERVER_WS   = 'wss://nookara.cc';
  const EXT_ID = 'ikelenenookarachat';

  class NookaraExtension {
    constructor(runtime) {
      this.runtime = runtime;
      this._instances = new Map();
      this._instanceURLs = new Set();
      this._instanceEvent = null;
      this._instanceSigningKey = null;
      this._instanceSigningToken = null;
      runtime.on?.('PROJECT_LOADED', () => { this._restoreInstances(); });
      runtime.on?.('RUNTIME_DISPOSED', () => { this._disposeInstances(); });
      this._globalMessages = [];
      this._roomMessages   = {};
      this._typingUsers    = [];
      this._evtGlobalMsg = false;
      this._evtRoomMsgMap = {};
      this._chatServers = null;
      this._chatDetail = {};
      this._chatMsgs = {};
      this._chatEvt = {};
      this._lastChatMsg = null;
      this._chatTyping = {};
      this._presence = {};
      this._presenceEvt = {};
      this._lastPresenceUser = '';
      this._lastMsg = null;
      runtime.ext_ikelenenookarachat = this;
      this._linked = null;
      runtime.on('EXTENSION_ADDED', () => this._linkCore());
      this._linkCore();
      this._bfInit();
    }

    getInfo() {
      const blocks = [
          { blockType: Scratch.BlockType.LABEL, text: 'Quick chat' },
          { opcode: 'sendGlobalMessage', blockType: Scratch.BlockType.COMMAND, text: 'send message [MSG]', arguments: { MSG: { type: Scratch.ArgumentType.STRING, defaultValue: 'Hello!' } }, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'getGlobalMessages', blockType: Scratch.BlockType.REPORTER, text: 'messages', tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'sendRoomMessage', blockType: Scratch.BlockType.COMMAND, text: 'send [MSG] in channel [ROOM]', arguments: { MSG: { type: Scratch.ArgumentType.STRING, defaultValue: 'Hello!' }, ROOM: { type: Scratch.ArgumentType.STRING, defaultValue: 'c1' } }, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'getRoomMessages', blockType: Scratch.BlockType.REPORTER, text: 'messages in channel [ROOM]', arguments: { ROOM: { type: Scratch.ArgumentType.STRING, defaultValue: 'c1' } }, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'joinRoom', blockType: Scratch.BlockType.COMMAND, text: 'use channel [ROOM]', arguments: { ROOM: { type: Scratch.ArgumentType.STRING, defaultValue: 'c1' } }, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'setTyping', blockType: Scratch.BlockType.COMMAND, text: 'typing [STATE]', arguments: { STATE: { type: Scratch.ArgumentType.STRING, menu: 'onOff', defaultValue: 'on' } }, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'typingUsers', blockType: Scratch.BlockType.REPORTER, text: 'who is typing', tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'whenGlobalMessageReceived', blockType: Scratch.BlockType.HAT, text: 'when I get a message', tooltip: 'Connect to the server first, then use server and channel IDs.', isEdgeActivated: false },
          { opcode: 'whenRoomMessageReceived', blockType: Scratch.BlockType.HAT, text: 'when I get a message in channel [ROOM]', arguments: { ROOM: { type: Scratch.ArgumentType.STRING, defaultValue: 'c1' } }, tooltip: 'Connect to the server first, then use server and channel IDs.', isEdgeActivated: false },
          { opcode: 'lastMessageUser', blockType: Scratch.BlockType.REPORTER, text: 'last message sender', tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'lastMessageContent', blockType: Scratch.BlockType.REPORTER, text: 'last message text', tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'lastMessageUserJson', blockType: Scratch.BlockType.REPORTER, text: 'last message sender as JSON', tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { blockType: Scratch.BlockType.LABEL, text: 'Servers and channels' },
          { opcode: 'chatMyServers', blockType: Scratch.BlockType.REPORTER, text: 'my servers as JSON', tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'chatJoinServer', blockType: Scratch.BlockType.COMMAND, text: 'join server [SERVER]', arguments: { SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' } }, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'chatLeaveServer', blockType: Scratch.BlockType.COMMAND, text: 'leave server [SERVER]', arguments: { SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' } }, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'chatChannels', blockType: Scratch.BlockType.REPORTER, text: 'channels in server [SERVER] as JSON', arguments: { SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' } }, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'chatMembers', blockType: Scratch.BlockType.REPORTER, text: 'members in server [SERVER] as JSON', arguments: { SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' } }, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'chatOnlineMembers', blockType: Scratch.BlockType.REPORTER, text: 'online members in server [SERVER] as JSON', arguments: { SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' } }, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'chatIsMember', blockType: Scratch.BlockType.BOOLEAN, text: 'in server [SERVER]?', arguments: { SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' } }, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          '---',
          { opcode: 'chatSend', blockType: Scratch.BlockType.COMMAND, text: 'send [MSG] in channel [CHANNEL] of server [SERVER]', arguments: { MSG: { type: Scratch.ArgumentType.STRING, defaultValue: 'Hello!' }, CHANNEL: { type: Scratch.ArgumentType.STRING, defaultValue: 'c1' }, SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' } }, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'chatMessages', blockType: Scratch.BlockType.REPORTER, text: 'messages in channel [CHANNEL] of server [SERVER] as JSON', arguments: { CHANNEL: { type: Scratch.ArgumentType.STRING, defaultValue: 'c1' }, SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' } }, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'chatChannelLocked', blockType: Scratch.BlockType.BOOLEAN, text: 'is channel [CHANNEL] of server [SERVER] locked?', arguments: { CHANNEL: { type: Scratch.ArgumentType.STRING, defaultValue: 'c1' }, SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' } }, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'chatCanPost', blockType: Scratch.BlockType.BOOLEAN, text: 'can I post in channel [CHANNEL] of server [SERVER]?', arguments: { CHANNEL: { type: Scratch.ArgumentType.STRING, defaultValue: 'c1' }, SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' } }, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'whenChatMessage', blockType: Scratch.BlockType.HAT, text: 'when I get a message in channel [CHANNEL] of server [SERVER]', arguments: { CHANNEL: { type: Scratch.ArgumentType.STRING, defaultValue: 'c1' }, SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' } }, tooltip: 'Connect to the server first, then use server and channel IDs.', isEdgeActivated: false },
          { opcode: 'whenAnyChatMessage', blockType: Scratch.BlockType.HAT, text: 'when I get a message in any channel', tooltip: 'Connect to the server first, then use server and channel IDs.', isEdgeActivated: false },
          { opcode: 'chatLastMessage', blockType: Scratch.BlockType.REPORTER, text: 'last message [PROP]', arguments: { PROP: { type: Scratch.ArgumentType.STRING, menu: 'chatMsgProps', defaultValue: 'text' } }, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'chatTyping', blockType: Scratch.BlockType.COMMAND, text: 'show typing in channel [CHANNEL] of server [SERVER]', arguments: { CHANNEL: { type: Scratch.ArgumentType.STRING, defaultValue: 'c1' }, SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' } }, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'chatTypingUsers', blockType: Scratch.BlockType.REPORTER, text: 'who is typing in channel [CHANNEL] of server [SERVER] as JSON', arguments: { CHANNEL: { type: Scratch.ArgumentType.STRING, defaultValue: 'c1' }, SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' } }, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { blockType: Scratch.BlockType.LABEL, text: 'Connecting' },
          { opcode: 'biConnectInstance', blockType: Scratch.BlockType.COMMAND, text: 'connect to [URL]', arguments: { URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' } } },
          { opcode: 'biDisconnectInstance', blockType: Scratch.BlockType.COMMAND, text: 'disconnect from instance [URL]', arguments: { URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' } }, hideFromPalette: true },
          { opcode: 'biConnectionState', blockType: Scratch.BlockType.REPORTER, text: 'connection status of [URL]', arguments: { URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' } } },
          { opcode: 'biConnectionError', blockType: Scratch.BlockType.REPORTER, text: 'connection error of [URL]', arguments: { URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' } } },
          { opcode: 'biWhenState', blockType: Scratch.BlockType.HAT, text: 'when [URL] is [STATE]', arguments: { URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' }, STATE: { type: Scratch.ArgumentType.STRING, defaultValue: 'connected', menu: 'biConnectionStates' } }, isEdgeActivated: false },
          { opcode: 'biConnect', blockType: Scratch.BlockType.COMMAND, text: 'connect to Bonfire server [URL]', arguments: { URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' } }, hideFromPalette: true },
          { opcode: 'biConnectLocal', blockType: Scratch.BlockType.COMMAND, text: 'connect to [URL] as [USERNAME] password [PASSWORD]', arguments: { URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' }, USERNAME: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, PASSWORD: { type: Scratch.ArgumentType.STRING, defaultValue: '' } } },
          { opcode: 'biRegister', blockType: Scratch.BlockType.COMMAND, text: 'register on [URL] as [USERNAME] password [PASSWORD]', arguments: { URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' }, USERNAME: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, PASSWORD: { type: Scratch.ArgumentType.STRING, defaultValue: '' } } },
          { opcode: 'biDisconnect', blockType: Scratch.BlockType.COMMAND, text: 'disconnect from [URL]', arguments: { URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' } } },
          { opcode: 'biConnected', blockType: Scratch.BlockType.BOOLEAN, text: 'connected to [URL]?', arguments: { URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' } } },
          { opcode: 'biMyInstances', blockType: Scratch.BlockType.REPORTER, text: 'my saved servers as JSON' },
          { opcode: 'biSaveInstance', blockType: Scratch.BlockType.COMMAND, text: 'save server [URL]', arguments: { URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' } } },
          { opcode: 'biForgetInstance', blockType: Scratch.BlockType.COMMAND, text: 'remove saved server [URL]', arguments: { URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' } } },
          { opcode: 'biConnectedList', blockType: Scratch.BlockType.REPORTER, text: 'connected servers as JSON' },
          { opcode: 'biHostedServers', blockType: Scratch.BlockType.REPORTER, text: 'my hosted servers as JSON' },
          { opcode: 'biDirectory', blockType: Scratch.BlockType.REPORTER, text: 'search servers [QUERY] page [PAGE] as JSON', arguments: { QUERY: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, PAGE: { type: Scratch.ArgumentType.STRING, defaultValue: '1' } } },
          { blockType: Scratch.BlockType.LABEL, text: 'Server info' },
          { opcode: 'biAbout', blockType: Scratch.BlockType.REPORTER, text: '[PROP] of [URL]', arguments: { PROP: { type: Scratch.ArgumentType.STRING, defaultValue: 'name', menu: 'biInstanceProps' }, URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' } } },
          { opcode: 'biHasFeature', blockType: Scratch.BlockType.BOOLEAN, text: 'does [URL] have [FEATURE]?', arguments: { URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' }, FEATURE: { type: Scratch.ArgumentType.STRING, defaultValue: 'voice', menu: 'biFeatures' } } },
          { opcode: 'biServerName', blockType: Scratch.BlockType.REPORTER, text: 'name of [URL]', arguments: { URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' } } },
          { opcode: 'biMyId', blockType: Scratch.BlockType.REPORTER, text: 'my id on [URL]', arguments: { URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' } } },
          { opcode: 'biVoiceInfoIds', blockType: Scratch.BlockType.REPORTER, text: 'voice channel info for [CHANNEL] on instance [URL] server ID [SERVER] as JSON', arguments: { CHANNEL: { type: Scratch.ArgumentType.STRING, defaultValue: 'c1' }, URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' }, SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' } }, hideFromPalette: true },
          { opcode: 'biVoiceInfo', blockType: Scratch.BlockType.REPORTER, text: 'voice channel [CHANNEL] on [URL] as JSON', arguments: { CHANNEL: { type: Scratch.ArgumentType.STRING, defaultValue: 'Voice' }, URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' } } },
          { blockType: Scratch.BlockType.LABEL, text: 'Server' },
          { opcode: 'biServers', blockType: Scratch.BlockType.REPORTER, text: 'servers on [URL] as JSON', arguments: { URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' } } },
          { opcode: 'biCommunityIds', blockType: Scratch.BlockType.REPORTER, text: 'community details of instance [URL] server ID [SERVER] as JSON', arguments: { URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' }, SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' } }, hideFromPalette: true },
          { opcode: 'biCommunity', blockType: Scratch.BlockType.REPORTER, text: 'server info of [URL] as JSON', arguments: { URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' } } },
          { opcode: 'biJoinIds', blockType: Scratch.BlockType.COMMAND, text: 'join the community on instance [URL] server ID [SERVER]', arguments: { URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' }, SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' } }, hideFromPalette: true },
          { opcode: 'biJoin', blockType: Scratch.BlockType.COMMAND, text: 'join [URL]', arguments: { URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' } } },
          { opcode: 'biPendingIds', blockType: Scratch.BlockType.BOOLEAN, text: 'join request pending on instance [URL] server ID [SERVER]?', arguments: { URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' }, SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' } }, hideFromPalette: true },
          { opcode: 'biPending', blockType: Scratch.BlockType.BOOLEAN, text: 'join request waiting on [URL]?', arguments: { URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' } } },
          { opcode: 'biLeaveIds', blockType: Scratch.BlockType.COMMAND, text: 'leave the community on instance [URL] server ID [SERVER]', arguments: { URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' }, SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' } }, hideFromPalette: true },
          { opcode: 'biLeave', blockType: Scratch.BlockType.COMMAND, text: 'leave [URL]', arguments: { URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' } } },
          { opcode: 'biMembersIds', blockType: Scratch.BlockType.REPORTER, text: 'members of instance [URL] server ID [SERVER] as JSON', arguments: { URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' }, SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' } }, hideFromPalette: true },
          { opcode: 'biMembers', blockType: Scratch.BlockType.REPORTER, text: 'members of [URL] as JSON', arguments: { URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' } } },
          { opcode: 'biRolesIds', blockType: Scratch.BlockType.REPORTER, text: 'roles of instance [URL] server ID [SERVER] as JSON', arguments: { URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' }, SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' } }, hideFromPalette: true },
          { opcode: 'biRoles', blockType: Scratch.BlockType.REPORTER, text: 'roles of [URL] as JSON', arguments: { URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' } } },
          { opcode: 'biPermissionsIds', blockType: Scratch.BlockType.REPORTER, text: 'my permission mask on instance [URL] server ID [SERVER]', arguments: { URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' }, SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' } }, hideFromPalette: true },
          { opcode: 'biPermissions', blockType: Scratch.BlockType.REPORTER, text: 'my permissions on [URL]', arguments: { URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' } } },
          { opcode: 'biHasPermissionIds', blockType: Scratch.BlockType.BOOLEAN, text: 'I have permission [PERMISSION] in channel ID [CHANNEL] on instance [URL] server ID [SERVER]?', arguments: { PERMISSION: { type: Scratch.ArgumentType.STRING, defaultValue: 'SEND', menu: 'bfPermissions' }, CHANNEL: { type: Scratch.ArgumentType.STRING, defaultValue: 'c1' }, URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' }, SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' } }, hideFromPalette: true },
          { opcode: 'biHasPermission', blockType: Scratch.BlockType.BOOLEAN, text: 'can I [PERMISSION] in channel [CHANNEL] on [URL]?', arguments: { PERMISSION: { type: Scratch.ArgumentType.STRING, defaultValue: 'SEND', menu: 'bfPermissions' }, CHANNEL: { type: Scratch.ArgumentType.STRING, defaultValue: 'general' }, URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' } } },
          { opcode: 'biSetRoleIds', blockType: Scratch.BlockType.COMMAND, text: '[ACTION] role [ROLE] for member [USER] on instance [URL] server ID [SERVER]', arguments: { ACTION: { type: Scratch.ArgumentType.STRING, defaultValue: 'add', menu: 'biRoleActions' }, ROLE: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, USER: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' }, SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' } }, hideFromPalette: true },
          { opcode: 'biSetRole', blockType: Scratch.BlockType.COMMAND, text: '[ACTION] role [ROLE] for [USER] on [URL]', arguments: { ACTION: { type: Scratch.ArgumentType.STRING, defaultValue: 'add', menu: 'biRoleActions' }, ROLE: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, USER: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' } } },
          { opcode: 'biKickIds', blockType: Scratch.BlockType.COMMAND, text: 'kick member [USER] from instance [URL] server ID [SERVER]', arguments: { USER: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' }, SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' } }, hideFromPalette: true },
          { opcode: 'biKick', blockType: Scratch.BlockType.COMMAND, text: 'kick [USER] from [URL]', arguments: { USER: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' } } },
          { opcode: 'biBanIds', blockType: Scratch.BlockType.COMMAND, text: 'ban member [USER] from instance [URL] server ID [SERVER]', arguments: { USER: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' }, SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' } }, hideFromPalette: true },
          { opcode: 'biBan', blockType: Scratch.BlockType.COMMAND, text: 'ban [USER] from [URL]', arguments: { USER: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' } } },
          { opcode: 'biUnbanIds', blockType: Scratch.BlockType.COMMAND, text: 'unban [USER] on instance [URL] server ID [SERVER]', arguments: { USER: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' }, SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' } }, hideFromPalette: true },
          { opcode: 'biUnban', blockType: Scratch.BlockType.COMMAND, text: 'unban [USER] on [URL]', arguments: { USER: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' } } },
          { opcode: 'biJoinRequestsIds', blockType: Scratch.BlockType.REPORTER, text: 'pending join requests on instance [URL] server ID [SERVER] as JSON', arguments: { URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' }, SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' } }, hideFromPalette: true },
          { opcode: 'biJoinRequests', blockType: Scratch.BlockType.REPORTER, text: 'join requests on [URL] as JSON', arguments: { URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' } } },
          { opcode: 'biAcceptRequestIds', blockType: Scratch.BlockType.COMMAND, text: 'accept join request from [USER] on instance [URL] server ID [SERVER]', arguments: { USER: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' }, SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' } }, hideFromPalette: true },
          { opcode: 'biAcceptRequest', blockType: Scratch.BlockType.COMMAND, text: 'accept join request from [USER] on [URL]', arguments: { USER: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' } } },
          { opcode: 'biDenyRequestIds', blockType: Scratch.BlockType.COMMAND, text: 'deny join request from [USER] on instance [URL] server ID [SERVER]', arguments: { USER: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' }, SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' } }, hideFromPalette: true },
          { opcode: 'biDenyRequest', blockType: Scratch.BlockType.COMMAND, text: 'deny join request from [USER] on [URL]', arguments: { USER: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' } } },
          { opcode: 'biCreateInviteIds', blockType: Scratch.BlockType.REPORTER, text: 'create invite on instance [URL] server ID [SERVER] expires in [SECONDS] seconds (0 = never) max uses [USES] (0 = unlimited)', arguments: { URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' }, SECONDS: { type: Scratch.ArgumentType.STRING, defaultValue: '0' }, USES: { type: Scratch.ArgumentType.STRING, defaultValue: '0' }, SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' } }, hideFromPalette: true },
          { blockType: Scratch.BlockType.LABEL, text: 'Invites' },
          { opcode: 'biCreateInvite', blockType: Scratch.BlockType.REPORTER, text: 'create invite on [URL] lasting [SECONDS] seconds with [USES] uses (0 = no limit)', arguments: { URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' }, SECONDS: { type: Scratch.ArgumentType.STRING, defaultValue: '0' }, USES: { type: Scratch.ArgumentType.STRING, defaultValue: '0' } } },
          { opcode: 'biInviteLink', blockType: Scratch.BlockType.REPORTER, text: 'link for invite [CODE] on [URL]', arguments: { CODE: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' } } },
          { opcode: 'biInviteInfo', blockType: Scratch.BlockType.REPORTER, text: 'invite [CODE] on [URL] as JSON', arguments: { CODE: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' } } },
          { opcode: 'biJoinInvite', blockType: Scratch.BlockType.COMMAND, text: 'join with invite [CODE] on [URL]', arguments: { CODE: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' } } },
          { opcode: 'biInvitesIds', blockType: Scratch.BlockType.REPORTER, text: 'invites of instance [URL] server ID [SERVER] as JSON', arguments: { URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' }, SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' } }, hideFromPalette: true },
          { opcode: 'biInvites', blockType: Scratch.BlockType.REPORTER, text: 'invites on [URL] as JSON', arguments: { URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' } } },
          { opcode: 'biDeleteInviteIds', blockType: Scratch.BlockType.COMMAND, text: 'delete invite [CODE] on instance [URL] server ID [SERVER]', arguments: { CODE: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' }, SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' } }, hideFromPalette: true },
          { opcode: 'biDeleteInvite', blockType: Scratch.BlockType.COMMAND, text: 'delete invite [CODE] on [URL]', arguments: { CODE: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' } } },
          { opcode: 'biChannelsIds', blockType: Scratch.BlockType.REPORTER, text: 'channels of instance [URL] server ID [SERVER] as JSON', arguments: { URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' }, SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' } }, hideFromPalette: true },
          { blockType: Scratch.BlockType.LABEL, text: 'Channels' },
          { opcode: 'biChannels', blockType: Scratch.BlockType.REPORTER, text: 'channels on [URL] as JSON', arguments: { URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' } } },
          { opcode: 'biServerChannels', blockType: Scratch.BlockType.REPORTER, text: 'channels in server [SERVER] on [URL] as JSON', arguments: { SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' }, URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' } } },
          { opcode: 'biFindChannelId', blockType: Scratch.BlockType.REPORTER, text: 'channel ID named [NAME] in server ID [SERVER] on instance [URL]', arguments: { NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'general' }, SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' }, URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' } }, hideFromPalette: true },
          { opcode: 'biChannelId', blockType: Scratch.BlockType.REPORTER, text: 'id of channel [NAME] on [URL]', arguments: { NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'general' }, URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' } } },
          { opcode: 'biChannelPropIds', blockType: Scratch.BlockType.REPORTER, text: '[PROP] of channel ID [CHANNEL] on instance [URL] server ID [SERVER]', arguments: { PROP: { type: Scratch.ArgumentType.STRING, defaultValue: 'topic', menu: 'biChannelProps' }, CHANNEL: { type: Scratch.ArgumentType.STRING, defaultValue: 'c1' }, URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' }, SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' } }, hideFromPalette: true },
          { opcode: 'biChannelProp', blockType: Scratch.BlockType.REPORTER, text: '[PROP] of channel [CHANNEL] on [URL]', arguments: { PROP: { type: Scratch.ArgumentType.STRING, defaultValue: 'topic', menu: 'biChannelProps' }, CHANNEL: { type: Scratch.ArgumentType.STRING, defaultValue: 'general' }, URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' } } },
          { opcode: 'biCreateChannelIds', blockType: Scratch.BlockType.COMMAND, text: 'create [TYPE] channel [NAME] on instance [URL] server ID [SERVER]', arguments: { TYPE: { type: Scratch.ArgumentType.STRING, defaultValue: 'text', menu: 'biChannelTypes' }, NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'new-channel' }, URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' }, SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' } }, hideFromPalette: true },
          { opcode: 'biCreateChannel', blockType: Scratch.BlockType.COMMAND, text: 'create [TYPE] channel [NAME] on [URL]', arguments: { TYPE: { type: Scratch.ArgumentType.STRING, defaultValue: 'text', menu: 'biChannelTypes' }, NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'new-channel' }, URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' } } },
          { opcode: 'biRenameChannelIds', blockType: Scratch.BlockType.COMMAND, text: 'rename channel ID [CHANNEL] to [NAME] on instance [URL] server ID [SERVER]', arguments: { CHANNEL: { type: Scratch.ArgumentType.STRING, defaultValue: 'c1' }, NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'chat' }, URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' }, SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' } }, hideFromPalette: true },
          { opcode: 'biRenameChannel', blockType: Scratch.BlockType.COMMAND, text: 'rename channel [CHANNEL] to [NAME] on [URL]', arguments: { CHANNEL: { type: Scratch.ArgumentType.STRING, defaultValue: 'general' }, NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'chat' }, URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' } } },
          { opcode: 'biDeleteChannelIds', blockType: Scratch.BlockType.COMMAND, text: 'delete channel ID [CHANNEL] on instance [URL] server ID [SERVER]', arguments: { CHANNEL: { type: Scratch.ArgumentType.STRING, defaultValue: 'c1' }, URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' }, SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' } }, hideFromPalette: true },
          { opcode: 'biDeleteChannel', blockType: Scratch.BlockType.COMMAND, text: 'delete channel [CHANNEL] on [URL]', arguments: { CHANNEL: { type: Scratch.ArgumentType.STRING, defaultValue: 'old-channel' }, URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' } } },
          { opcode: 'biSendIds', blockType: Scratch.BlockType.COMMAND, text: 'send [TEXT] to channel ID [CHANNEL] on instance [URL] server ID [SERVER]', arguments: { TEXT: { type: Scratch.ArgumentType.STRING, defaultValue: 'Hello!' }, CHANNEL: { type: Scratch.ArgumentType.STRING, defaultValue: 'c1' }, URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' }, SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' } }, hideFromPalette: true },
          { blockType: Scratch.BlockType.LABEL, text: 'Messages' },
          { opcode: 'biSend', blockType: Scratch.BlockType.COMMAND, text: 'send [TEXT] in channel [CHANNEL] on [URL]', arguments: { TEXT: { type: Scratch.ArgumentType.STRING, defaultValue: 'Hello!' }, CHANNEL: { type: Scratch.ArgumentType.STRING, defaultValue: 'general' }, URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' } } },
          { opcode: 'biReplyIds', blockType: Scratch.BlockType.COMMAND, text: 'reply [TEXT] to message [ID] in channel ID [CHANNEL] on instance [URL] server ID [SERVER]', arguments: { TEXT: { type: Scratch.ArgumentType.STRING, defaultValue: 'Hello!' }, ID: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, CHANNEL: { type: Scratch.ArgumentType.STRING, defaultValue: 'c1' }, URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' }, SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' } }, hideFromPalette: true },
          { opcode: 'biReply', blockType: Scratch.BlockType.COMMAND, text: 'reply [TEXT] to message [ID] in channel [CHANNEL] on [URL]', arguments: { TEXT: { type: Scratch.ArgumentType.STRING, defaultValue: 'Hello!' }, ID: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, CHANNEL: { type: Scratch.ArgumentType.STRING, defaultValue: 'general' }, URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' } } },
          { opcode: 'biEditIds', blockType: Scratch.BlockType.COMMAND, text: 'edit message [ID] to [TEXT] in channel ID [CHANNEL] on instance [URL] server ID [SERVER]', arguments: { ID: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, TEXT: { type: Scratch.ArgumentType.STRING, defaultValue: 'Edited' }, CHANNEL: { type: Scratch.ArgumentType.STRING, defaultValue: 'c1' }, URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' }, SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' } }, hideFromPalette: true },
          { opcode: 'biEdit', blockType: Scratch.BlockType.COMMAND, text: 'edit message [ID] to [TEXT] in channel [CHANNEL] on [URL]', arguments: { ID: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, TEXT: { type: Scratch.ArgumentType.STRING, defaultValue: 'Edited' }, CHANNEL: { type: Scratch.ArgumentType.STRING, defaultValue: 'general' }, URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' } } },
          { opcode: 'biSendAliasIds', blockType: Scratch.BlockType.COMMAND, text: 'send [TEXT] as bot [TOKEN] to channel id [CHANNEL] on instance [URL] server ID [SERVER] with alias [NAME] and avatar [AVATAR]', arguments: { TEXT: { type: Scratch.ArgumentType.STRING, defaultValue: 'Hello!' }, TOKEN: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, CHANNEL: { type: Scratch.ArgumentType.STRING, defaultValue: 'c1' }, URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' }, NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'Narrator' }, AVATAR: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' } }, hideFromPalette: true },
          { opcode: 'biSendAlias', blockType: Scratch.BlockType.COMMAND, text: 'send [TEXT] as bot [TOKEN] in channel [CHANNEL] on [URL] named [NAME] with avatar [AVATAR]', arguments: { TEXT: { type: Scratch.ArgumentType.STRING, defaultValue: 'Hello!' }, TOKEN: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, CHANNEL: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' }, NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'Narrator' }, AVATAR: { type: Scratch.ArgumentType.STRING, defaultValue: '' } } },
          { opcode: 'biEditAliasIds', blockType: Scratch.BlockType.COMMAND, text: 'set alias of message [ID] in channel id [CHANNEL] as bot [TOKEN] on instance [URL] server ID [SERVER] to [NAME] and avatar [AVATAR] (blank name clears it)', arguments: { ID: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, CHANNEL: { type: Scratch.ArgumentType.STRING, defaultValue: 'c1' }, TOKEN: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' }, NAME: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, AVATAR: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' } }, hideFromPalette: true },
          { opcode: 'biEditAlias', blockType: Scratch.BlockType.COMMAND, text: 'rename message [ID] in channel [CHANNEL] as bot [TOKEN] on [URL] to [NAME] with avatar [AVATAR]', arguments: { ID: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, CHANNEL: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, TOKEN: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' }, NAME: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, AVATAR: { type: Scratch.ArgumentType.STRING, defaultValue: '' } } },
          { opcode: 'biDeleteIds', blockType: Scratch.BlockType.COMMAND, text: 'delete message [ID] on instance [URL] server ID [SERVER] in channel ID [CHANNEL]', arguments: { ID: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' }, SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' }, CHANNEL: { type: Scratch.ArgumentType.STRING, defaultValue: 'c1' } }, hideFromPalette: true },
          { opcode: 'biDelete', blockType: Scratch.BlockType.COMMAND, text: 'delete message [ID] on [URL]', arguments: { ID: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' } } },
          { opcode: 'biReactIds', blockType: Scratch.BlockType.COMMAND, text: 'react [EMOJI] to message [ID] on instance [URL] server ID [SERVER] in channel ID [CHANNEL]', arguments: { EMOJI: { type: Scratch.ArgumentType.STRING, defaultValue: 'like' }, ID: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' }, SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' }, CHANNEL: { type: Scratch.ArgumentType.STRING, defaultValue: 'c1' } }, hideFromPalette: true },
          { opcode: 'biReact', blockType: Scratch.BlockType.COMMAND, text: 'react [EMOJI] to message [ID] on [URL]', arguments: { EMOJI: { type: Scratch.ArgumentType.STRING, defaultValue: 'like' }, ID: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' } } },
          { opcode: 'biUnreactIds', blockType: Scratch.BlockType.COMMAND, text: 'remove my reaction [EMOJI] from message [ID] on instance [URL] server ID [SERVER] in channel ID [CHANNEL]', arguments: { EMOJI: { type: Scratch.ArgumentType.STRING, defaultValue: 'like' }, ID: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' }, SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' }, CHANNEL: { type: Scratch.ArgumentType.STRING, defaultValue: 'c1' } }, hideFromPalette: true },
          { opcode: 'biUnreact', blockType: Scratch.BlockType.COMMAND, text: 'remove my reaction [EMOJI] from message [ID] on [URL]', arguments: { EMOJI: { type: Scratch.ArgumentType.STRING, defaultValue: 'like' }, ID: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' } } },
          { opcode: 'biPinIds', blockType: Scratch.BlockType.COMMAND, text: 'pin message [ID] on instance [URL] server ID [SERVER] in channel ID [CHANNEL]', arguments: { ID: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' }, SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' }, CHANNEL: { type: Scratch.ArgumentType.STRING, defaultValue: 'c1' } }, hideFromPalette: true },
          { opcode: 'biPin', blockType: Scratch.BlockType.COMMAND, text: 'pin message [ID] on [URL]', arguments: { ID: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' } } },
          { opcode: 'biUnpinIds', blockType: Scratch.BlockType.COMMAND, text: 'unpin message [ID] on instance [URL] server ID [SERVER] in channel ID [CHANNEL]', arguments: { ID: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' }, SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' }, CHANNEL: { type: Scratch.ArgumentType.STRING, defaultValue: 'c1' } }, hideFromPalette: true },
          { opcode: 'biUnpin', blockType: Scratch.BlockType.COMMAND, text: 'unpin message [ID] on [URL]', arguments: { ID: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' } } },
          { opcode: 'biPinsIds', blockType: Scratch.BlockType.REPORTER, text: 'pinned messages in channel ID [CHANNEL] on instance [URL] server ID [SERVER] as JSON', arguments: { CHANNEL: { type: Scratch.ArgumentType.STRING, defaultValue: 'c1' }, URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' }, SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' } }, hideFromPalette: true },
          { opcode: 'biPins', blockType: Scratch.BlockType.REPORTER, text: 'pinned messages in channel [CHANNEL] on [URL] as JSON', arguments: { CHANNEL: { type: Scratch.ArgumentType.STRING, defaultValue: 'general' }, URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' } } },
          { opcode: 'biMessagesIds', blockType: Scratch.BlockType.REPORTER, text: 'messages in channel ID [CHANNEL] on instance [URL] server ID [SERVER] as JSON', arguments: { CHANNEL: { type: Scratch.ArgumentType.STRING, defaultValue: 'c1' }, URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' }, SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' } }, hideFromPalette: true },
          { opcode: 'biMessages', blockType: Scratch.BlockType.REPORTER, text: 'messages in channel [CHANNEL] on [URL] as JSON', arguments: { CHANNEL: { type: Scratch.ArgumentType.STRING, defaultValue: 'general' }, URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' } } },
          { opcode: 'biHistoryIds', blockType: Scratch.BlockType.REPORTER, text: 'messages in channel ID [CHANNEL] on instance [URL] server ID [SERVER] filters JSON [QUERY]', arguments: { CHANNEL: { type: Scratch.ArgumentType.STRING, defaultValue: 'c1' }, URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' }, QUERY: { type: Scratch.ArgumentType.STRING, defaultValue: '{"limit":50}' }, SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' } }, hideFromPalette: true },
          { opcode: 'biHistory', blockType: Scratch.BlockType.REPORTER, text: 'messages in channel [CHANNEL] on [URL] filters [QUERY]', arguments: { CHANNEL: { type: Scratch.ArgumentType.STRING, defaultValue: 'general' }, URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' }, QUERY: { type: Scratch.ArgumentType.STRING, defaultValue: '{"limit":50}' } } },
          { opcode: 'biMessageIds', blockType: Scratch.BlockType.REPORTER, text: 'message [ID] in channel ID [CHANNEL] on instance [URL] server ID [SERVER] as JSON', arguments: { ID: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, CHANNEL: { type: Scratch.ArgumentType.STRING, defaultValue: 'c1' }, URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' }, SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' } }, hideFromPalette: true },
          { opcode: 'biMessage', blockType: Scratch.BlockType.REPORTER, text: 'message [ID] in channel [CHANNEL] on [URL] as JSON', arguments: { ID: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, CHANNEL: { type: Scratch.ArgumentType.STRING, defaultValue: 'general' }, URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' } } },
          { opcode: 'biSearchIds', blockType: Scratch.BlockType.REPORTER, text: 'search [QUERY] in channel ID [CHANNEL] on instance [URL] server ID [SERVER] as JSON', arguments: { QUERY: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, CHANNEL: { type: Scratch.ArgumentType.STRING, defaultValue: 'c1' }, URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' }, SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' } }, hideFromPalette: true },
          { opcode: 'biSearch', blockType: Scratch.BlockType.REPORTER, text: 'search [QUERY] in channel [CHANNEL] on [URL] as JSON', arguments: { QUERY: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, CHANNEL: { type: Scratch.ArgumentType.STRING, defaultValue: 'general' }, URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' } } },
          { opcode: 'biSearchAllIds', blockType: Scratch.BlockType.REPORTER, text: 'search [QUERY] in the whole community on instance [URL] server ID [SERVER] as JSON', arguments: { QUERY: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' }, SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' } }, hideFromPalette: true },
          { opcode: 'biSearchAll', blockType: Scratch.BlockType.REPORTER, text: 'search [QUERY] on [URL] as JSON', arguments: { QUERY: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' } } },
          { opcode: 'biMarkReadIds', blockType: Scratch.BlockType.COMMAND, text: 'mark channel ID [CHANNEL] as read on instance [URL] server ID [SERVER] (up to message [ID], blank = latest)', arguments: { CHANNEL: { type: Scratch.ArgumentType.STRING, defaultValue: 'c1' }, ID: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' }, SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' } }, hideFromPalette: true },
          { opcode: 'biMarkRead', blockType: Scratch.BlockType.COMMAND, text: 'mark channel [CHANNEL] on [URL] read up to message [ID]', arguments: { CHANNEL: { type: Scratch.ArgumentType.STRING, defaultValue: 'general' }, ID: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' } } },
          { opcode: 'biTypingIds', blockType: Scratch.BlockType.COMMAND, text: 'show me typing in channel ID [CHANNEL] on instance [URL] server ID [SERVER]', arguments: { CHANNEL: { type: Scratch.ArgumentType.STRING, defaultValue: 'c1' }, URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' }, SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' } }, hideFromPalette: true },
          { opcode: 'biTyping', blockType: Scratch.BlockType.COMMAND, text: 'show typing in channel [CHANNEL] on [URL]', arguments: { CHANNEL: { type: Scratch.ArgumentType.STRING, defaultValue: 'general' }, URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' } } },
          { opcode: 'biTypingUsersIds', blockType: Scratch.BlockType.REPORTER, text: 'who is typing in channel ID [CHANNEL] on instance [URL] server ID [SERVER] as JSON', arguments: { CHANNEL: { type: Scratch.ArgumentType.STRING, defaultValue: 'c1' }, URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' }, SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' } }, hideFromPalette: true },
          { opcode: 'biTypingUsers', blockType: Scratch.BlockType.REPORTER, text: 'who is typing in channel [CHANNEL] on [URL] as JSON', arguments: { CHANNEL: { type: Scratch.ArgumentType.STRING, defaultValue: 'general' }, URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' } } },
          { opcode: 'biWhenMessageIds', blockType: Scratch.BlockType.HAT, text: 'when a message is sent in [CHANNEL] on instance [URL] server ID [SERVER]', arguments: { CHANNEL: { type: Scratch.ArgumentType.STRING, defaultValue: 'c1' }, URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' }, SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' } }, isEdgeActivated: false, hideFromPalette: true },
          { opcode: 'biWhenMessage', blockType: Scratch.BlockType.HAT, text: 'when I get a message in channel [CHANNEL] on [URL]', arguments: { CHANNEL: { type: Scratch.ArgumentType.STRING, defaultValue: 'general' }, URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' } }, isEdgeActivated: false },
          { opcode: 'biWhenEvent', blockType: Scratch.BlockType.HAT, text: 'when [EVENT] on [URL]', arguments: { EVENT: { type: Scratch.ArgumentType.STRING, defaultValue: 'chat_reactions', menu: 'biEvents' }, URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' } } },
          { opcode: 'biEventJson', blockType: Scratch.BlockType.REPORTER, text: 'last event on [URL] as JSON', arguments: { URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' } } },
          { opcode: 'biLastText', blockType: Scratch.BlockType.REPORTER, text: 'last message text on [URL]', arguments: { URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' } } },
          { opcode: 'biLastAuthor', blockType: Scratch.BlockType.REPORTER, text: 'last message sender on [URL]', arguments: { URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' } } },
          { opcode: 'biLastAliasIds', blockType: Scratch.BlockType.REPORTER, text: 'alias name of last message on instance [URL] server ID [SERVER] (blank when none)', arguments: { URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' }, SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' } }, hideFromPalette: true },
          { opcode: 'biLastAlias', blockType: Scratch.BlockType.REPORTER, text: 'last message bot name on [URL]', arguments: { URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' } } },
          { opcode: 'biLastId', blockType: Scratch.BlockType.REPORTER, text: 'last message id on [URL]', arguments: { URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' } } },
          { opcode: 'biLastChannel', blockType: Scratch.BlockType.REPORTER, text: 'last message channel on [URL]', arguments: { URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' } } },
          { opcode: 'biLastProp', blockType: Scratch.BlockType.REPORTER, text: 'last message [PROP] on [URL]', arguments: { PROP: { type: Scratch.ArgumentType.STRING, defaultValue: 'author name', menu: 'biLastProps' }, URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' } } },
          { opcode: 'biUploadIds', blockType: Scratch.BlockType.REPORTER, text: 'upload file [FILE] named [FILENAME] for channel ID [CHANNEL] on instance [URL] server ID [SERVER] as attachment JSON', arguments: { FILE: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, FILENAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'file.png' }, CHANNEL: { type: Scratch.ArgumentType.STRING, defaultValue: 'c1' }, URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' }, SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' } }, hideFromPalette: true },
          { blockType: Scratch.BlockType.LABEL, text: 'Files' },
          { opcode: 'biUpload', blockType: Scratch.BlockType.REPORTER, text: 'upload file [FILE] named [FILENAME] for channel [CHANNEL] on [URL]', arguments: { FILE: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, FILENAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'file.png' }, CHANNEL: { type: Scratch.ArgumentType.STRING, defaultValue: 'general' }, URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' } } },
          { opcode: 'biImportMediaIds', blockType: Scratch.BlockType.REPORTER, text: 'import media from [MEDIA_URL] for channel ID [CHANNEL] on instance [URL] server ID [SERVER] as attachment JSON', arguments: { MEDIA_URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://' }, CHANNEL: { type: Scratch.ArgumentType.STRING, defaultValue: 'c1' }, URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' }, SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' } }, hideFromPalette: true },
          { opcode: 'biImportMedia', blockType: Scratch.BlockType.REPORTER, text: 'upload from link [MEDIA_URL] for channel [CHANNEL] on [URL]', arguments: { MEDIA_URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://' }, CHANNEL: { type: Scratch.ArgumentType.STRING, defaultValue: 'general' }, URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' } } },
          { opcode: 'biSendAttachmentsIds', blockType: Scratch.BlockType.COMMAND, text: 'send [TEXT] with attachments JSON [ATTACHMENTS] to channel ID [CHANNEL] on instance [URL] server ID [SERVER]', arguments: { TEXT: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, ATTACHMENTS: { type: Scratch.ArgumentType.STRING, defaultValue: '[]' }, CHANNEL: { type: Scratch.ArgumentType.STRING, defaultValue: 'c1' }, URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' }, SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' } }, hideFromPalette: true },
          { opcode: 'biSendAttachments', blockType: Scratch.BlockType.COMMAND, text: 'send [TEXT] with attachments [ATTACHMENTS] in channel [CHANNEL] on [URL]', arguments: { TEXT: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, ATTACHMENTS: { type: Scratch.ArgumentType.STRING, defaultValue: '[]' }, CHANNEL: { type: Scratch.ArgumentType.STRING, defaultValue: 'general' }, URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' } } },
          { opcode: 'biSendFileIds', blockType: Scratch.BlockType.COMMAND, text: 'send [TEXT] with file [FILE] named [FILENAME] to channel ID [CHANNEL] on instance [URL] server ID [SERVER]', arguments: { TEXT: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, FILE: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, FILENAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'file.png' }, CHANNEL: { type: Scratch.ArgumentType.STRING, defaultValue: 'c1' }, URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' }, SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' } }, hideFromPalette: true },
          { opcode: 'biSendFile', blockType: Scratch.BlockType.COMMAND, text: 'send [TEXT] with file [FILE] named [FILENAME] in channel [CHANNEL] on [URL]', arguments: { TEXT: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, FILE: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, FILENAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'file.png' }, CHANNEL: { type: Scratch.ArgumentType.STRING, defaultValue: 'general' }, URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' } } },
          { blockType: Scratch.BlockType.LABEL, text: 'Stickers' },
          { opcode: 'biStickers', blockType: Scratch.BlockType.REPORTER, text: 'stickers of [URL] as JSON', arguments: { URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' } } },
          { opcode: 'biSendSticker', blockType: Scratch.BlockType.COMMAND, text: 'send sticker [STICKER] to channel [CHANNEL] on [URL]', arguments: { STICKER: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, CHANNEL: { type: Scratch.ArgumentType.STRING, defaultValue: 'general' }, URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' } } },
          { opcode: 'biAddSticker', blockType: Scratch.BlockType.REPORTER, text: 'add sticker named [NAME] from file [FILE] filename [FILENAME] on [URL] as JSON', arguments: { NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'sticker' }, FILE: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, FILENAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'sticker.png' }, URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' } } },
          { opcode: 'biRenameSticker', blockType: Scratch.BlockType.COMMAND, text: 'rename sticker [STICKER] to [NAME] on [URL]', arguments: { STICKER: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'sticker' }, URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' } } },
          { opcode: 'biDeleteSticker', blockType: Scratch.BlockType.COMMAND, text: 'delete sticker [STICKER] on [URL]', arguments: { STICKER: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' } } },
          { opcode: 'biMessageSticker', blockType: Scratch.BlockType.REPORTER, text: 'sticker of message [ID] in channel [CHANNEL] on [URL] as JSON', arguments: { ID: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, CHANNEL: { type: Scratch.ArgumentType.STRING, defaultValue: 'general' }, URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' } } },
          { opcode: 'biBotsIds', blockType: Scratch.BlockType.REPORTER, text: 'bots on instance [URL] server ID [SERVER] as JSON', arguments: { URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' }, SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' } }, hideFromPalette: true },
          { blockType: Scratch.BlockType.LABEL, text: 'Bots' },
          { opcode: 'biBots', blockType: Scratch.BlockType.REPORTER, text: 'bots on [URL] as JSON', arguments: { URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' } } },
          { opcode: 'biCreateBotIds', blockType: Scratch.BlockType.REPORTER, text: 'create bot [NAME] description [DESCRIPTION] on instance [URL] server ID [SERVER] (shows the token once) as JSON', arguments: { NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'MyBot' }, DESCRIPTION: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' }, SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' } }, hideFromPalette: true },
          { opcode: 'biCreateBot', blockType: Scratch.BlockType.REPORTER, text: 'create bot [NAME] description [DESCRIPTION] on [URL]', arguments: { NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'MyBot' }, DESCRIPTION: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' } } },
          { opcode: 'biRemoveBotIds', blockType: Scratch.BlockType.COMMAND, text: 'remove bot [BOT] from instance [URL] server ID [SERVER]', arguments: { BOT: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' }, SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' } }, hideFromPalette: true },
          { opcode: 'biRemoveBot', blockType: Scratch.BlockType.COMMAND, text: 'remove bot [BOT] from [URL]', arguments: { BOT: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' } } },
          { opcode: 'biAddGalleryBotIds', blockType: Scratch.BlockType.COMMAND, text: 'add gallery bot [BOT] to the community on instance [URL] server ID [SERVER]', arguments: { BOT: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' }, SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' } }, hideFromPalette: true },
          { opcode: 'biAddGalleryBot', blockType: Scratch.BlockType.COMMAND, text: 'add bot [BOT] from the gallery to [URL]', arguments: { BOT: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' } } },
          { blockType: Scratch.BlockType.LABEL, text: 'Bonfire bot DMs (Nookara)' },
          { opcode: 'biOpenBotDm', blockType: Scratch.BlockType.COMMAND, text: 'open DM with user [ID] as bot [TOKEN]', arguments: { ID: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, TOKEN: { type: Scratch.ArgumentType.STRING, defaultValue: '' } } },
          { opcode: 'biSendBotDm', blockType: Scratch.BlockType.COMMAND, text: 'send DM [TEXT] to user [ID] as bot [TOKEN]', arguments: { TEXT: { type: Scratch.ArgumentType.STRING, defaultValue: 'Hello!' }, ID: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, TOKEN: { type: Scratch.ArgumentType.STRING, defaultValue: '' } } },
          { opcode: 'biSendBotDmChannel', blockType: Scratch.BlockType.COMMAND, text: 'send DM [TEXT] in DM channel [CHANNEL] as bot [TOKEN]', arguments: { TEXT: { type: Scratch.ArgumentType.STRING, defaultValue: 'Hello!' }, CHANNEL: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, TOKEN: { type: Scratch.ArgumentType.STRING, defaultValue: '' } } },
          { opcode: 'biBotDmChannelFor', blockType: Scratch.BlockType.REPORTER, text: 'DM channel id of user id [ID]', arguments: { ID: { type: Scratch.ArgumentType.STRING, defaultValue: '' } } },
          { opcode: 'biBotDmConnect', blockType: Scratch.BlockType.COMMAND, text: 'connect bot [TOKEN] to receive DMs', arguments: { TOKEN: { type: Scratch.ArgumentType.STRING, defaultValue: '' } } },
          { opcode: 'biBotDmDisconnect', blockType: Scratch.BlockType.COMMAND, text: 'stop receiving DMs as bot' },
          { opcode: 'biBotDmConnected', blockType: Scratch.BlockType.BOOLEAN, text: 'bot receiving DMs?' },
          { opcode: 'biWhenBotDm', blockType: Scratch.BlockType.HAT, text: 'when bot gets a DM' },
          { opcode: 'biBotDmText', blockType: Scratch.BlockType.REPORTER, text: 'text of last DM to the bot' },
          { opcode: 'biBotDmAuthor', blockType: Scratch.BlockType.REPORTER, text: 'author name of last DM to the bot' },
          { opcode: 'biBotDmAuthorId', blockType: Scratch.BlockType.REPORTER, text: 'author id of last DM to the bot' },
          { opcode: 'biBotDmChannel', blockType: Scratch.BlockType.REPORTER, text: 'DM channel id of last DM to the bot' },
          { opcode: 'biBotDmJson', blockType: Scratch.BlockType.REPORTER, text: 'last DM to the bot as JSON' },
          { opcode: 'biBotDmError', blockType: Scratch.BlockType.REPORTER, text: 'last bot DM error' },
          { blockType: Scratch.BlockType.LABEL, text: 'Advanced: invites' },
          { opcode: 'bfGetChatInviteCode', blockType: Scratch.BlockType.REPORTER, text: 'invite [CODE] as JSON', arguments: { CODE: { type: Scratch.ArgumentType.STRING, defaultValue: '' } }, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { blockType: Scratch.BlockType.LABEL, text: 'Advanced: servers' },
          { opcode: 'bfGetChatServers', blockType: Scratch.BlockType.REPORTER, text: 'my servers data', tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { blockType: Scratch.BlockType.LABEL, text: 'Advanced: public servers' },
          { opcode: 'bfGetChatDiscover', blockType: Scratch.BlockType.REPORTER, text: 'public servers', tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { blockType: Scratch.BlockType.LABEL, text: 'Advanced: servers' },
          { opcode: 'bfPostChatServers', blockType: Scratch.BlockType.COMMAND, text: 'create server with options [OPTIONS]', arguments: { OPTIONS: { type: Scratch.ArgumentType.STRING, defaultValue: '{"name": "My server", "description": "", "discoverable": false}' } }, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfGetChatServersSid', blockType: Scratch.BlockType.REPORTER, text: 'server [SID] as JSON', arguments: { SID: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' } }, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfPatchChatServersSid', blockType: Scratch.BlockType.COMMAND, text: 'edit server [SID] options [OPTIONS]', arguments: { SID: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' }, OPTIONS: { type: Scratch.ArgumentType.STRING, defaultValue: '{}' } }, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfPutChatServersSidLayout', blockType: Scratch.BlockType.COMMAND, text: 'set Nookara servers server ID [SID] layout options JSON [OPTIONS]', arguments: { SID: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' }, OPTIONS: { type: Scratch.ArgumentType.STRING, defaultValue: '{"categories": [], "channels": []}' } }, hideFromPalette: true, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfPostChatServersSidRoles', blockType: Scratch.BlockType.COMMAND, text: 'create role in server [SID] options [OPTIONS]', arguments: { SID: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' }, OPTIONS: { type: Scratch.ArgumentType.STRING, defaultValue: '{"name": "Member", "permissions": 257, "color": "#c084fc"}' } }, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfPutChatServersSidRolesOrder', blockType: Scratch.BlockType.COMMAND, text: 'reorder roles in server [SID] options [OPTIONS]', arguments: { SID: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' }, OPTIONS: { type: Scratch.ArgumentType.STRING, defaultValue: '{"order": []}' } }, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfPatchChatServersSidRolesRid', blockType: Scratch.BlockType.COMMAND, text: 'edit role [RID] in server [SID] options [OPTIONS]', arguments: { SID: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' }, RID: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, OPTIONS: { type: Scratch.ArgumentType.STRING, defaultValue: '{}' } }, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfDeleteChatServersSidRolesRid', blockType: Scratch.BlockType.COMMAND, text: 'delete role [RID] in server [SID]', arguments: { SID: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' }, RID: { type: Scratch.ArgumentType.STRING, defaultValue: '' } }, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfPutChatServersSidMembersUsernameRolesRid', blockType: Scratch.BlockType.COMMAND, text: 'give [USERNAME] role [RID] in server [SID] options [OPTIONS]', arguments: { SID: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' }, USERNAME: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, RID: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, OPTIONS: { type: Scratch.ArgumentType.STRING, defaultValue: '{}' } }, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfDeleteChatServersSidMembersUsernameRolesRid', blockType: Scratch.BlockType.COMMAND, text: 'take role [RID] from [USERNAME] in server [SID]', arguments: { SID: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' }, USERNAME: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, RID: { type: Scratch.ArgumentType.STRING, defaultValue: '' } }, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfPostChatServersSidRolesRidIcon', blockType: Scratch.BlockType.COMMAND, text: 'set icon of role [RID] in server [SID] to file [FILE] named [FILENAME] options [OPTIONS]', arguments: { SID: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' }, RID: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, OPTIONS: { type: Scratch.ArgumentType.STRING, defaultValue: '{}' }, FILE: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, FILENAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'file.png' } }, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfDeleteChatServersSidRolesRidIcon', blockType: Scratch.BlockType.COMMAND, text: 'remove icon of role [RID] in server [SID]', arguments: { SID: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' }, RID: { type: Scratch.ArgumentType.STRING, defaultValue: '' } }, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { blockType: Scratch.BlockType.LABEL, text: 'Advanced: channels' },
          { opcode: 'bfPostChatChannelsCidIcon', blockType: Scratch.BlockType.COMMAND, text: 'set icon of channel [CID] to file [FILE] named [FILENAME] options [OPTIONS]', arguments: { CID: { type: Scratch.ArgumentType.STRING, defaultValue: 'c1' }, OPTIONS: { type: Scratch.ArgumentType.STRING, defaultValue: '{}' }, FILE: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, FILENAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'file.png' } }, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { blockType: Scratch.BlockType.LABEL, text: 'Advanced: servers' },
          { opcode: 'bfDeleteChatServersSid', blockType: Scratch.BlockType.COMMAND, text: 'delete server [SID]', arguments: { SID: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' } }, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfPostChatServersSidJoin', blockType: Scratch.BlockType.COMMAND, text: 'join server [SID] options [OPTIONS]', arguments: { SID: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' }, OPTIONS: { type: Scratch.ArgumentType.STRING, defaultValue: '{}' } }, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { blockType: Scratch.BlockType.LABEL, text: 'Advanced: joining' },
          { opcode: 'bfPostChatJoinCode', blockType: Scratch.BlockType.COMMAND, text: 'join with invite [CODE] options [OPTIONS]', arguments: { CODE: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, OPTIONS: { type: Scratch.ArgumentType.STRING, defaultValue: '{}' } }, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { blockType: Scratch.BlockType.LABEL, text: 'Advanced: servers' },
          { opcode: 'bfPostChatServersSidLeave', blockType: Scratch.BlockType.COMMAND, text: 'leave server [SID] options [OPTIONS]', arguments: { SID: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' }, OPTIONS: { type: Scratch.ArgumentType.STRING, defaultValue: '{}' } }, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfGetChatServersSidMembers', blockType: Scratch.BlockType.REPORTER, text: 'members of server [SID]', arguments: { SID: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' } }, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfDeleteChatServersSidMembersUsername', blockType: Scratch.BlockType.COMMAND, text: 'kick [USERNAME] from server [SID] options [QUERY]', arguments: { SID: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' }, USERNAME: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, QUERY: { type: Scratch.ArgumentType.STRING, defaultValue: '{}' } }, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfDeleteChatServersSidBansUsername', blockType: Scratch.BlockType.COMMAND, text: 'unban [USERNAME] from server [SID]', arguments: { SID: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' }, USERNAME: { type: Scratch.ArgumentType.STRING, defaultValue: '' } }, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfPostChatServersSidIcon', blockType: Scratch.BlockType.COMMAND, text: 'set icon of server [SID] to file [FILE] named [FILENAME] options [OPTIONS]', arguments: { SID: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' }, OPTIONS: { type: Scratch.ArgumentType.STRING, defaultValue: '{}' }, FILE: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, FILENAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'file.png' } }, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfPostChatServersSidBanner', blockType: Scratch.BlockType.COMMAND, text: 'set banner of server [SID] to file [FILE] named [FILENAME] options [OPTIONS]', arguments: { SID: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' }, OPTIONS: { type: Scratch.ArgumentType.STRING, defaultValue: '{}' }, FILE: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, FILENAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'file.png' } }, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfDeleteChatServersSidIcon', blockType: Scratch.BlockType.COMMAND, text: 'remove icon of server [SID]', arguments: { SID: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' } }, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfDeleteChatServersSidBanner', blockType: Scratch.BlockType.COMMAND, text: 'remove banner of server [SID]', arguments: { SID: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' } }, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfPostChatServersSidChannels', blockType: Scratch.BlockType.COMMAND, text: 'create channel in server [SID] options [OPTIONS]', arguments: { SID: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' }, OPTIONS: { type: Scratch.ArgumentType.STRING, defaultValue: '{"name": "general", "type": "text", "topic": "", "category": ""}' } }, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { blockType: Scratch.BlockType.LABEL, text: 'Advanced: channels' },
          { opcode: 'bfPatchChatChannelsCid', blockType: Scratch.BlockType.COMMAND, text: 'edit channel [CID] options [OPTIONS]', arguments: { CID: { type: Scratch.ArgumentType.STRING, defaultValue: 'c1' }, OPTIONS: { type: Scratch.ArgumentType.STRING, defaultValue: '{}' } }, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfDeleteChatChannelsCid', blockType: Scratch.BlockType.COMMAND, text: 'delete channel [CID]', arguments: { CID: { type: Scratch.ArgumentType.STRING, defaultValue: 'c1' } }, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfGetChatChannelsCidMessages', blockType: Scratch.BlockType.REPORTER, text: 'messages in channel [CID] filters [QUERY]', arguments: { CID: { type: Scratch.ArgumentType.STRING, defaultValue: 'c1' }, QUERY: { type: Scratch.ArgumentType.STRING, defaultValue: '{"limit": 100}' } }, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfPostChatChannelsCidMessages', blockType: Scratch.BlockType.COMMAND, text: 'send in channel [CID] options [OPTIONS]', arguments: { CID: { type: Scratch.ArgumentType.STRING, defaultValue: 'c1' }, OPTIONS: { type: Scratch.ArgumentType.STRING, defaultValue: '{"message": "Hello!", "reply_to": null, "attachments": []}' } }, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfPostChatChannelsCidRead', blockType: Scratch.BlockType.COMMAND, text: 'mark channel [CID] read options [OPTIONS]', arguments: { CID: { type: Scratch.ArgumentType.STRING, defaultValue: 'c1' }, OPTIONS: { type: Scratch.ArgumentType.STRING, defaultValue: '{}' } }, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfGetChatChannelsCidSearch', blockType: Scratch.BlockType.REPORTER, text: 'search channel [CID] filters [QUERY]', arguments: { CID: { type: Scratch.ArgumentType.STRING, defaultValue: 'c1' }, QUERY: { type: Scratch.ArgumentType.STRING, defaultValue: '{}' } }, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { blockType: Scratch.BlockType.LABEL, text: 'Advanced: messages' },
          { opcode: 'bfPatchChatMessagesId', blockType: Scratch.BlockType.COMMAND, text: 'edit message [ID] options [OPTIONS]', arguments: { ID: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, OPTIONS: { type: Scratch.ArgumentType.STRING, defaultValue: '{}' } }, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfDeleteChatMessagesId', blockType: Scratch.BlockType.COMMAND, text: 'delete message [ID]', arguments: { ID: { type: Scratch.ArgumentType.STRING, defaultValue: '' } }, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { blockType: Scratch.BlockType.LABEL, text: 'Advanced: uploads' },
          { opcode: 'bfPostChatUpload', blockType: Scratch.BlockType.COMMAND, text: 'upload file [FILE] named [FILENAME] options [OPTIONS]', arguments: { OPTIONS: { type: Scratch.ArgumentType.STRING, defaultValue: '{}' }, FILE: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, FILENAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'file.png' } }, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfGetChatNotify', blockType: Scratch.BlockType.REPORTER, text: 'notification preferences data', hideFromPalette: true, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfPutChatNotifyTarget', blockType: Scratch.BlockType.COMMAND, text: 'set Nookara notify [TARGET] options JSON [OPTIONS]', arguments: { TARGET: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, OPTIONS: { type: Scratch.ArgumentType.STRING, defaultValue: '{"level": "mentions", "mute_minutes": 0, "push": true}' } }, hideFromPalette: true, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfGetChatSettings', blockType: Scratch.BlockType.REPORTER, text: 'chat preference data', hideFromPalette: true, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfPatchChatSettings', blockType: Scratch.BlockType.COMMAND, text: 'update Nookara settings options JSON [OPTIONS]', arguments: { OPTIONS: { type: Scratch.ArgumentType.STRING, defaultValue: '{}' } }, hideFromPalette: true, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfGetChatOpen', blockType: Scratch.BlockType.REPORTER, text: 'open chat destination data', hideFromPalette: true, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { blockType: Scratch.BlockType.LABEL, text: 'Advanced: bots' },
          { opcode: 'bfGetChatBots', blockType: Scratch.BlockType.REPORTER, text: 'my bots', tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfPostChatBots', blockType: Scratch.BlockType.COMMAND, text: 'create bot with options [OPTIONS]', arguments: { OPTIONS: { type: Scratch.ArgumentType.STRING, defaultValue: '{}' } }, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfPatchChatBotsId', blockType: Scratch.BlockType.COMMAND, text: 'edit bot [ID] options [OPTIONS]', arguments: { ID: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, OPTIONS: { type: Scratch.ArgumentType.STRING, defaultValue: '{}' } }, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfPostChatBotsIdAvatar', blockType: Scratch.BlockType.COMMAND, text: 'set avatar of bot [ID] to file [FILE] named [FILENAME] options [OPTIONS]', arguments: { ID: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, OPTIONS: { type: Scratch.ArgumentType.STRING, defaultValue: '{}' }, FILE: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, FILENAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'file.png' } }, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfPostChatBotsIdToken', blockType: Scratch.BlockType.COMMAND, text: 'new token for bot [ID] options [OPTIONS]', arguments: { ID: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, OPTIONS: { type: Scratch.ArgumentType.STRING, defaultValue: '{}' } }, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfDeleteChatBotsId', blockType: Scratch.BlockType.COMMAND, text: 'delete bot [ID]', arguments: { ID: { type: Scratch.ArgumentType.STRING, defaultValue: '' } }, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfPostChatBotsByNameUsernameAdd', blockType: Scratch.BlockType.COMMAND, text: 'add bot named [USERNAME] options [OPTIONS]', arguments: { USERNAME: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, OPTIONS: { type: Scratch.ArgumentType.STRING, defaultValue: '{}' } }, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfGetChatGifs', blockType: Scratch.BlockType.REPORTER, text: 'GIF search results with filters [QUERY]', arguments: { QUERY: { type: Scratch.ArgumentType.STRING, defaultValue: '{}' } }, hideFromPalette: true, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfGetChatMedia', blockType: Scratch.BlockType.REPORTER, text: 'media catalogue data', hideFromPalette: true, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfGetChatMediaLimits', blockType: Scratch.BlockType.REPORTER, text: 'upload size limits JSON (MB)', hideFromPalette: true, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfPostChatMediaSave', blockType: Scratch.BlockType.COMMAND, text: 'create / send Nookara media save options JSON [OPTIONS]', arguments: { OPTIONS: { type: Scratch.ArgumentType.STRING, defaultValue: '{}' } }, hideFromPalette: true, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfGetChatKlipyKindSlug', blockType: Scratch.BlockType.REPORTER, text: 'Klipy media details for [KIND] item [SLUG]', arguments: { KIND: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, SLUG: { type: Scratch.ArgumentType.STRING, defaultValue: '' } }, hideFromPalette: true, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfPostChatMediaGif', blockType: Scratch.BlockType.COMMAND, text: 'create / send Nookara media gif options JSON [OPTIONS]', arguments: { OPTIONS: { type: Scratch.ArgumentType.STRING, defaultValue: '{}' } }, hideFromPalette: true, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfDeleteChatMediaId', blockType: Scratch.BlockType.COMMAND, text: 'remove Nookara media [ID]', arguments: { ID: { type: Scratch.ArgumentType.STRING, defaultValue: '' } }, hideFromPalette: true, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfDeleteChatMedia', blockType: Scratch.BlockType.COMMAND, text: 'remove Nookara media query JSON [QUERY]', arguments: { QUERY: { type: Scratch.ArgumentType.STRING, defaultValue: '{}' } }, hideFromPalette: true, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { blockType: Scratch.BlockType.LABEL, text: 'Advanced: media' },
          { opcode: 'bfPostChatMediaUpload', blockType: Scratch.BlockType.COMMAND, text: 'upload media file [FILE] named [FILENAME] options [OPTIONS]', arguments: { OPTIONS: { type: Scratch.ArgumentType.STRING, defaultValue: '{}' }, FILE: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, FILENAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'file.png' } }, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfGetChatEmojis', blockType: Scratch.BlockType.REPORTER, text: 'emoji catalogue data', hideFromPalette: true, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfGetChatEmojisEidInfo', blockType: Scratch.BlockType.REPORTER, text: 'emoji details for [EID]', arguments: { EID: { type: Scratch.ArgumentType.STRING, defaultValue: '' } }, hideFromPalette: true, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfGetChatServersSidEmojis', blockType: Scratch.BlockType.REPORTER, text: 'emoji catalogue for community server ID [SID]', arguments: { SID: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' } }, hideFromPalette: true, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfPostChatServersSidEmojis', blockType: Scratch.BlockType.COMMAND, text: 'create / send Nookara servers server ID [SID] emojis options JSON [OPTIONS] file data URI [FILE] filename [FILENAME]', arguments: { SID: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' }, OPTIONS: { type: Scratch.ArgumentType.STRING, defaultValue: '{}' }, FILE: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, FILENAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'file.png' } }, hideFromPalette: true, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfPatchChatServersSidEmojisEid', blockType: Scratch.BlockType.COMMAND, text: 'update Nookara servers server ID [SID] emojis [EID] options JSON [OPTIONS]', arguments: { SID: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' }, EID: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, OPTIONS: { type: Scratch.ArgumentType.STRING, defaultValue: '{}' } }, hideFromPalette: true, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfDeleteChatServersSidEmojisEid', blockType: Scratch.BlockType.COMMAND, text: 'remove Nookara servers server ID [SID] emojis [EID]', arguments: { SID: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' }, EID: { type: Scratch.ArgumentType.STRING, defaultValue: '' } }, hideFromPalette: true, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfGetChatBridgePlatforms', blockType: Scratch.BlockType.REPORTER, text: 'supported bridge services', hideFromPalette: true, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfGetChatBridgePlatformGuilds', blockType: Scratch.BlockType.REPORTER, text: 'linked communities on [PLATFORM]', arguments: { PLATFORM: { type: Scratch.ArgumentType.STRING, defaultValue: '' } }, hideFromPalette: true, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfGetChatBridgePlatformGuildsGid', blockType: Scratch.BlockType.REPORTER, text: 'linked community [GID] on [PLATFORM]', arguments: { PLATFORM: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, GID: { type: Scratch.ArgumentType.STRING, defaultValue: '' } }, hideFromPalette: true, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfPostChatBridgePlatformGuildsGidImport', blockType: Scratch.BlockType.COMMAND, text: 'create / send Nookara bridge [PLATFORM] guilds [GID] import options JSON [OPTIONS]', arguments: { PLATFORM: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, GID: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, OPTIONS: { type: Scratch.ArgumentType.STRING, defaultValue: '{}' } }, hideFromPalette: true, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfGetChatBridgeServersSid', blockType: Scratch.BlockType.REPORTER, text: 'bridge configuration for community server ID [SID]', arguments: { SID: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' } }, hideFromPalette: true, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfPutChatBridgeServersSid', blockType: Scratch.BlockType.COMMAND, text: 'set Nookara bridge servers server ID [SID] options JSON [OPTIONS]', arguments: { SID: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' }, OPTIONS: { type: Scratch.ArgumentType.STRING, defaultValue: '{}' } }, hideFromPalette: true, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfPatchChatBridgeServersSid', blockType: Scratch.BlockType.COMMAND, text: 'update Nookara bridge servers server ID [SID] options JSON [OPTIONS]', arguments: { SID: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' }, OPTIONS: { type: Scratch.ArgumentType.STRING, defaultValue: '{}' } }, hideFromPalette: true, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfDeleteChatBridgeServersSid', blockType: Scratch.BlockType.COMMAND, text: 'remove Nookara bridge servers server ID [SID]', arguments: { SID: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' } }, hideFromPalette: true, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfPutChatBridgeServersSidChannelsCid', blockType: Scratch.BlockType.COMMAND, text: 'set Nookara bridge servers server ID [SID] channels channel ID [CID] options JSON [OPTIONS]', arguments: { SID: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' }, CID: { type: Scratch.ArgumentType.STRING, defaultValue: 'c1' }, OPTIONS: { type: Scratch.ArgumentType.STRING, defaultValue: '{}' } }, hideFromPalette: true, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfPostChatMediaExternal', blockType: Scratch.BlockType.COMMAND, text: 'add media from file [FILE] named [FILENAME] options [OPTIONS]', arguments: { OPTIONS: { type: Scratch.ArgumentType.STRING, defaultValue: '{}' }, FILE: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, FILENAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'file.png' } }, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { blockType: Scratch.BlockType.LABEL, text: 'Advanced: servers' },
          { opcode: 'bfGetChatServersSidSearch', blockType: Scratch.BlockType.REPORTER, text: 'search server [SID] filters [QUERY]', arguments: { SID: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' }, QUERY: { type: Scratch.ArgumentType.STRING, defaultValue: '{}' } }, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { blockType: Scratch.BlockType.LABEL, text: 'Advanced: channels' },
          { opcode: 'bfGetChatChannelsCidStarboard', blockType: Scratch.BlockType.REPORTER, text: 'starred messages in channel [CID] filters [QUERY]', arguments: { CID: { type: Scratch.ArgumentType.STRING, defaultValue: 'c1' }, QUERY: { type: Scratch.ArgumentType.STRING, defaultValue: '{}' } }, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfGetChatChannelsCidCloudlink', blockType: Scratch.BlockType.REPORTER, text: 'CloudLink configuration for channel channel ID [CID]', arguments: { CID: { type: Scratch.ArgumentType.STRING, defaultValue: 'c1' } }, hideFromPalette: true, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfPostChatChannelsCidCloudlinkReconnect', blockType: Scratch.BlockType.COMMAND, text: 'post Nookara channels channel ID [CID] cloudlink reconnect', arguments: { CID: { type: Scratch.ArgumentType.STRING, defaultValue: 'c1' } }, hideFromPalette: true, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { blockType: Scratch.BlockType.LABEL, text: 'Advanced: messages' },
          { opcode: 'bfPutChatMessagesIdReactionsEmoji', blockType: Scratch.BlockType.COMMAND, text: 'react [EMOJI] to message [ID] options [OPTIONS]', arguments: { ID: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, EMOJI: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, OPTIONS: { type: Scratch.ArgumentType.STRING, defaultValue: '{}' } }, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfDeleteChatMessagesIdReactionsEmoji', blockType: Scratch.BlockType.COMMAND, text: 'remove reaction [EMOJI] from message [ID]', arguments: { ID: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, EMOJI: { type: Scratch.ArgumentType.STRING, defaultValue: '' } }, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { blockType: Scratch.BlockType.LABEL, text: 'Advanced: channels' },
          { opcode: 'bfPutChatChannelsCidPerms', blockType: Scratch.BlockType.COMMAND, text: 'set permissions of channel [CID] options [OPTIONS]', arguments: { CID: { type: Scratch.ArgumentType.STRING, defaultValue: 'c1' }, OPTIONS: { type: Scratch.ArgumentType.STRING, defaultValue: '{"overwrites": []}' } }, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfGetChatModmail', blockType: Scratch.BlockType.REPORTER, text: 'my moderation inbox data', hideFromPalette: true, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfPostChatModmailRead', blockType: Scratch.BlockType.COMMAND, text: 'create / send Nookara modmail read options JSON [OPTIONS]', arguments: { OPTIONS: { type: Scratch.ArgumentType.STRING, defaultValue: '{}' } }, hideFromPalette: true, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfGetChatModmailStaff', blockType: Scratch.BlockType.REPORTER, text: 'staff moderation inbox data', hideFromPalette: true, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfGetChatModmailWithUsername', blockType: Scratch.BlockType.REPORTER, text: 'moderation conversation with [USERNAME]', arguments: { USERNAME: { type: Scratch.ArgumentType.STRING, defaultValue: '' } }, hideFromPalette: true, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfPostChatModmailWithUsername', blockType: Scratch.BlockType.COMMAND, text: 'create / send Nookara modmail with [USERNAME] options JSON [OPTIONS]', arguments: { USERNAME: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, OPTIONS: { type: Scratch.ArgumentType.STRING, defaultValue: '{}' } }, hideFromPalette: true, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfGetChatSounds', blockType: Scratch.BlockType.REPORTER, text: 'sound catalogue data', hideFromPalette: true, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfGetChatServersSidSounds', blockType: Scratch.BlockType.REPORTER, text: 'sound catalogue for community server ID [SID]', arguments: { SID: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' } }, hideFromPalette: true, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfPostChatServersSidSounds', blockType: Scratch.BlockType.COMMAND, text: 'create / send Nookara servers server ID [SID] sounds options JSON [OPTIONS] file data URI [FILE] filename [FILENAME]', arguments: { SID: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' }, OPTIONS: { type: Scratch.ArgumentType.STRING, defaultValue: '{}' }, FILE: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, FILENAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'file.png' } }, hideFromPalette: true, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfPatchChatServersSidSoundsId', blockType: Scratch.BlockType.COMMAND, text: 'update Nookara servers server ID [SID] sounds [ID] options JSON [OPTIONS]', arguments: { SID: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' }, ID: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, OPTIONS: { type: Scratch.ArgumentType.STRING, defaultValue: '{}' } }, hideFromPalette: true, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfDeleteChatServersSidSoundsId', blockType: Scratch.BlockType.COMMAND, text: 'remove Nookara servers server ID [SID] sounds [ID]', arguments: { SID: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' }, ID: { type: Scratch.ArgumentType.STRING, defaultValue: '' } }, hideFromPalette: true, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { blockType: Scratch.BlockType.LABEL, text: 'Advanced: messages' },
          { opcode: 'bfPutChatMessagesIdPin', blockType: Scratch.BlockType.COMMAND, text: 'pin message [ID] options [OPTIONS]', arguments: { ID: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, OPTIONS: { type: Scratch.ArgumentType.STRING, defaultValue: '{}' } }, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfDeleteChatMessagesIdPin', blockType: Scratch.BlockType.COMMAND, text: 'unpin message [ID]', arguments: { ID: { type: Scratch.ArgumentType.STRING, defaultValue: '' } }, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { blockType: Scratch.BlockType.LABEL, text: 'Advanced: channels' },
          { opcode: 'bfGetChatChannelsCidPins', blockType: Scratch.BlockType.REPORTER, text: 'pinned messages in channel [CID]', arguments: { CID: { type: Scratch.ArgumentType.STRING, defaultValue: 'c1' } }, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfGetChatChannelsCidViewers', blockType: Scratch.BlockType.REPORTER, text: 'who can see channel [CID] (JSON)', arguments: { CID: { type: Scratch.ArgumentType.STRING, defaultValue: 'c1' } }, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfGetChatUnfurl', blockType: Scratch.BlockType.REPORTER, text: 'link preview data with options [QUERY]', arguments: { QUERY: { type: Scratch.ArgumentType.STRING, defaultValue: '{}' } }, hideFromPalette: true, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfGetChatChannelsCidShop', blockType: Scratch.BlockType.REPORTER, text: 'shop in channel [CID]', arguments: { CID: { type: Scratch.ArgumentType.STRING, defaultValue: 'c1' } }, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfPostChatChannelsCidShopRid', blockType: Scratch.BlockType.COMMAND, text: 'add role [RID] to shop in channel [CID] options [OPTIONS]', arguments: { CID: { type: Scratch.ArgumentType.STRING, defaultValue: 'c1' }, RID: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, OPTIONS: { type: Scratch.ArgumentType.STRING, defaultValue: '{}' } }, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfDeleteChatChannelsCidShopRid', blockType: Scratch.BlockType.COMMAND, text: 'remove role [RID] from shop in channel [CID]', arguments: { CID: { type: Scratch.ArgumentType.STRING, defaultValue: 'c1' }, RID: { type: Scratch.ArgumentType.STRING, defaultValue: '' } }, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfGetChatChannelsCidWebhooks', blockType: Scratch.BlockType.REPORTER, text: 'webhook configuration for channel channel ID [CID]', arguments: { CID: { type: Scratch.ArgumentType.STRING, defaultValue: 'c1' } }, hideFromPalette: true, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfPostChatChannelsCidWebhooks', blockType: Scratch.BlockType.COMMAND, text: 'create / send Nookara channels channel ID [CID] webhooks options JSON [OPTIONS]', arguments: { CID: { type: Scratch.ArgumentType.STRING, defaultValue: 'c1' }, OPTIONS: { type: Scratch.ArgumentType.STRING, defaultValue: '{}' } }, hideFromPalette: true, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfPatchChatHooksWid', blockType: Scratch.BlockType.COMMAND, text: 'update Nookara hooks [WID] options JSON [OPTIONS]', arguments: { WID: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, OPTIONS: { type: Scratch.ArgumentType.STRING, defaultValue: '{}' } }, hideFromPalette: true, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfDeleteChatHooksWid', blockType: Scratch.BlockType.COMMAND, text: 'remove Nookara hooks [WID]', arguments: { WID: { type: Scratch.ArgumentType.STRING, defaultValue: '' } }, hideFromPalette: true, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfPostChatHooksWidAvatar', blockType: Scratch.BlockType.COMMAND, text: 'create / send Nookara hooks [WID] avatar options JSON [OPTIONS] file data URI [FILE] filename [FILENAME]', arguments: { WID: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, OPTIONS: { type: Scratch.ArgumentType.STRING, defaultValue: '{}' }, FILE: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, FILENAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'file.png' } }, hideFromPalette: true, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { blockType: Scratch.BlockType.LABEL, text: 'Advanced' },
          { opcode: 'biApi', blockType: Scratch.BlockType.REPORTER, text: 'request [METHOD] [PATH] on [URL] options [OPTIONS]', arguments: { METHOD: { type: Scratch.ArgumentType.STRING, defaultValue: 'GET', menu: 'biMethods' }, PATH: { type: Scratch.ArgumentType.STRING, defaultValue: '/servers' }, URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' }, OPTIONS: { type: Scratch.ArgumentType.STRING, defaultValue: '{}' } } },
          { opcode: 'biWebhook', blockType: Scratch.BlockType.COMMAND, text: 'send [TEXT] with webhook [WEBHOOK_URL]', arguments: { TEXT: { type: Scratch.ArgumentType.STRING, defaultValue: 'Hello!' }, WEBHOOK_URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net/api/v1/webhooks/ID/TOKEN' } } },
          { blockType: Scratch.BlockType.LABEL, text: 'Events and permissions' },
          { opcode: 'bfWhenEvent', blockType: Scratch.BlockType.HAT, text: 'when [EVENT]', arguments: { EVENT: { type: Scratch.ArgumentType.STRING, defaultValue: 'chat_message', menu: 'bfEvents' } }, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfEventJson', blockType: Scratch.BlockType.REPORTER, text: 'last event as JSON', tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfEventField', blockType: Scratch.BlockType.REPORTER, text: 'last event [FIELD]', arguments: { FIELD: { type: Scratch.ArgumentType.STRING, defaultValue: 'type' } }, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfServerPermissions', blockType: Scratch.BlockType.REPORTER, text: 'my permissions in server [SERVER]', arguments: { SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' } }, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfChannelPermissions', blockType: Scratch.BlockType.REPORTER, text: 'my permissions in channel [CHANNEL] of server [SERVER]', arguments: { CHANNEL: { type: Scratch.ArgumentType.STRING, defaultValue: 'c1' }, SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' } }, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfHasPermission', blockType: Scratch.BlockType.BOOLEAN, text: 'can I [PERMISSION] in channel [CHANNEL] of server [SERVER]?', arguments: { PERMISSION: { type: Scratch.ArgumentType.STRING, defaultValue: 'SEND', menu: 'bfPermissions' }, CHANNEL: { type: Scratch.ArgumentType.STRING, defaultValue: 'c1' }, SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' } }, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfPermissionBit', blockType: Scratch.BlockType.REPORTER, text: 'number for permission [PERMISSION]', arguments: { PERMISSION: { type: Scratch.ArgumentType.STRING, defaultValue: 'SEND', menu: 'bfPermissions' } } },
          { opcode: 'bfRoles', blockType: Scratch.BlockType.REPORTER, text: 'roles in server [SERVER] as JSON', arguments: { SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' } }, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfSendReply', blockType: Scratch.BlockType.COMMAND, text: 'reply [MSG] to [ID] with attachments [ATTACHMENTS] in channel [CHANNEL] of server [SERVER]', arguments: { MSG: { type: Scratch.ArgumentType.STRING, defaultValue: 'Hello!' }, ID: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, ATTACHMENTS: { type: Scratch.ArgumentType.STRING, defaultValue: '[]' }, CHANNEL: { type: Scratch.ArgumentType.STRING, defaultValue: 'c1' }, SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' } }, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfTypingState', blockType: Scratch.BlockType.COMMAND, text: 'typing [STATE] in channel [CHANNEL] of server [SERVER]', arguments: { STATE: { type: Scratch.ArgumentType.STRING, defaultValue: 'on', menu: 'onOff' }, CHANNEL: { type: Scratch.ArgumentType.STRING, defaultValue: 'c1' }, SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' } }, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfPlaySound', blockType: Scratch.BlockType.COMMAND, text: 'play Nookara sound [SOUND]', arguments: { SOUND: { type: Scratch.ArgumentType.STRING, defaultValue: 'snd' } }, hideFromPalette: true },
          { blockType: Scratch.BlockType.LABEL, text: 'Minecraft' },
          { opcode: 'bfGameServers', blockType: Scratch.BlockType.REPORTER, text: 'game servers in server [SERVER] as JSON', arguments: { SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' } }, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfGameStatus', blockType: Scratch.BlockType.REPORTER, text: 'game [PROP] in channel [CHANNEL] of server [SERVER]', arguments: { PROP: { type: Scratch.ArgumentType.STRING, defaultValue: 'online', menu: 'bfGameProps' }, CHANNEL: { type: Scratch.ArgumentType.STRING, defaultValue: 'c1' }, SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' } }, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfGameOnline', blockType: Scratch.BlockType.BOOLEAN, text: 'is game in channel [CHANNEL] of server [SERVER] online?', arguments: { CHANNEL: { type: Scratch.ArgumentType.STRING, defaultValue: 'c1' }, SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' } }, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfGameConsole', blockType: Scratch.BlockType.REPORTER, text: 'game console in channel [CHANNEL] of server [SERVER] as JSON', arguments: { CHANNEL: { type: Scratch.ArgumentType.STRING, defaultValue: 'c1' }, SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' } }, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfGameCommand', blockType: Scratch.BlockType.COMMAND, text: 'run [COMMAND] in channel [CHANNEL] of server [SERVER]', arguments: { COMMAND: { type: Scratch.ArgumentType.STRING, defaultValue: 'list' }, CHANNEL: { type: Scratch.ArgumentType.STRING, defaultValue: 'c1' }, SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' } }, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfGameCommandOutput', blockType: Scratch.BlockType.REPORTER, text: 'last command result' },
          { opcode: 'bfWhenGameStatus', blockType: Scratch.BlockType.HAT, text: 'when game changes in channel [CHANNEL] of server [SERVER]', arguments: { CHANNEL: { type: Scratch.ArgumentType.STRING, defaultValue: 'c1' }, SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' } }, tooltip: 'Connect to the server first, then use server and channel IDs.', isEdgeActivated: false },
          { opcode: 'bfWhenGameConsole', blockType: Scratch.BlockType.HAT, text: 'when console prints in channel [CHANNEL] of server [SERVER]', arguments: { CHANNEL: { type: Scratch.ArgumentType.STRING, defaultValue: 'c1' }, SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' } }, tooltip: 'Connect to the server first, then use server and channel IDs.', isEdgeActivated: false },
          { opcode: 'bfGameLastLine', blockType: Scratch.BlockType.REPORTER, text: 'last console line' },
          { opcode: 'bfMessageFromMinecraft', blockType: Scratch.BlockType.BOOLEAN, text: 'last message from Minecraft?' },
          { opcode: 'bfMessageGameServer', blockType: Scratch.BlockType.REPORTER, text: 'last message Minecraft server' },
          { opcode: 'bfMessageGameEvent', blockType: Scratch.BlockType.REPORTER, text: 'last message Minecraft event' },
          { opcode: 'bfCloudlinkStatus', blockType: Scratch.BlockType.REPORTER, text: 'bridge detail [PROP] for channel ID [CHANNEL] in server ID [SERVER]', arguments: { PROP: { type: Scratch.ArgumentType.STRING, defaultValue: 'state', menu: 'bfCloudlinkProps' }, CHANNEL: { type: Scratch.ArgumentType.STRING, defaultValue: 'c1' }, SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' } }, hideFromPalette: true, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfCloudlinkConnected', blockType: Scratch.BlockType.BOOLEAN, text: 'bridge connection active in channel ID [CHANNEL] of server ID [SERVER]?', arguments: { CHANNEL: { type: Scratch.ArgumentType.STRING, defaultValue: 'c1' }, SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' } }, hideFromPalette: true, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { blockType: Scratch.BlockType.LABEL, text: 'CloudLink' },
          { opcode: 'bfMessageFromCloudlink', blockType: Scratch.BlockType.BOOLEAN, text: 'last message from CloudLink?' },
          { blockType: Scratch.BlockType.LABEL, text: 'Bot gallery' },
          { opcode: 'bfGetBonfireBotsGallery', blockType: Scratch.BlockType.REPORTER, text: 'gallery bots filters [QUERY]', arguments: { QUERY: { type: Scratch.ArgumentType.STRING, defaultValue: '{"q":"","tag":"","page":1}' } } },
          { opcode: 'bfGetBonfireBotsGalleryTags', blockType: Scratch.BlockType.REPORTER, text: 'gallery bot tags' },
          { opcode: 'bfGetBonfireBotsGalleryId', blockType: Scratch.BlockType.REPORTER, text: 'gallery bot [ID]', arguments: { ID: { type: Scratch.ArgumentType.STRING, defaultValue: '' } } },
          { opcode: 'bfPostBonfireBotsGalleryIdTicket', blockType: Scratch.BlockType.REPORTER, text: 'add ticket for gallery bot [ID] options [OPTIONS]', arguments: { ID: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, OPTIONS: { type: Scratch.ArgumentType.STRING, defaultValue: '{"instance":"https://chat.ikelene.net"}' } } },
          { opcode: 'bfGetChatBotsIdGallery', blockType: Scratch.BlockType.REPORTER, text: 'gallery status of my bot [ID]', arguments: { ID: { type: Scratch.ArgumentType.STRING, defaultValue: '' } } },
          { opcode: 'bfPutChatBotsIdGallery', blockType: Scratch.BlockType.COMMAND, text: 'edit gallery page of my bot [ID] options [OPTIONS]', arguments: { ID: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, OPTIONS: { type: Scratch.ArgumentType.STRING, defaultValue: '{"long_description":"","tags":[],"support_url":"","links":[],"permissions":[]}' } } },
          { opcode: 'bfPostChatBotsIdGallerySubmit', blockType: Scratch.BlockType.COMMAND, text: 'submit my bot [ID] to the gallery options [OPTIONS]', arguments: { ID: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, OPTIONS: { type: Scratch.ArgumentType.STRING, defaultValue: '{}' } } },
          { opcode: 'bfPostChatBotsIdGalleryWithdraw', blockType: Scratch.BlockType.COMMAND, text: 'take my bot [ID] off the gallery', arguments: { ID: { type: Scratch.ArgumentType.STRING, defaultValue: '' } } },
          { blockType: Scratch.BlockType.LABEL, text: 'Personal emojis' },
          { opcode: 'bfGetChatPersonalEmojis', blockType: Scratch.BlockType.REPORTER, text: 'my personal emojis (JSON)' },
          { opcode: 'bfPostChatPersonalEmojis', blockType: Scratch.BlockType.COMMAND, text: 'add personal emoji from image [FILE] filename [FILENAME] options JSON [OPTIONS] (name goes in options)', arguments: { OPTIONS: { type: Scratch.ArgumentType.STRING, defaultValue: '{"name":"myemoji"}' }, FILE: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, FILENAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'emoji.png' } } },
          { opcode: 'bfPatchChatPersonalEmojisEid', blockType: Scratch.BlockType.COMMAND, text: 'rename personal emoji [EID] options JSON [OPTIONS]', arguments: { EID: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, OPTIONS: { type: Scratch.ArgumentType.STRING, defaultValue: '{"name":"newname"}' } } },
          { opcode: 'bfDeleteChatPersonalEmojisEid', blockType: Scratch.BlockType.COMMAND, text: 'delete personal emoji [EID]', arguments: { EID: { type: Scratch.ArgumentType.STRING, defaultValue: '' } } },
      ];
      if (!this._coreApi()) blocks.unshift({ func: '_addCore', blockType: Scratch.BlockType.BUTTON, text: 'Add Nookara Login' });
      return {
        id: EXT_ID,
        name: 'Nookara Chat',
        color1: '#7c3aed',
        color2: '#5b21b6',
        color3: '#4c1d95',
        docsURI: 'https://nookara.cc/guides/nookara-extensions',
        blocks,
        menus: {
          onOff: { acceptReporters: false, items: ['on', 'off'] },
          chatMsgProps: { acceptReporters: false, items: ['text', 'author', 'channel', 'server', 'id', 'JSON'] },
          biConnectionStates: { acceptReporters: true, items: ['connecting', 'connected', 'disconnected', 'error'] },
          biInstanceProps: { acceptReporters: true, items: ['name', 'description', { text: 'icon', value: 'icon url' }, 'version', 'commit', { text: 'build', value: 'build id' }, { text: 'build date', value: 'built at' }, 'protocol', { text: 'accounts', value: 'accounts mode' }, 'registration', 'member count', { text: 'who can join', value: 'join policy' }, { text: 'server name', value: 'community name' }, { text: 'server id', value: 'community id' }, 'read only', { text: 'plan', value: 'hosting plan' }, { text: 'upload limit (MB)', value: 'max upload MB' }, 'update available', 'JSON'] },
          biFeatures: { acceptReporters: true, items: ['voice', 'signing', 'uploads', 'youtube', 'minecraft', 'discord bridge', 'fluxer bridge', 'cloudlink bridge'] },
          bfPermissions: { acceptReporters: true, items: [{ text: 'send messages', value: 'SEND' }, { text: 'manage channels', value: 'MANAGE_CHANNELS' }, { text: 'manage server', value: 'MANAGE_SERVER' }, { text: 'manage roles', value: 'MANAGE_ROLES' }, { text: 'kick', value: 'KICK' }, { text: 'ban', value: 'BAN' }, { text: 'manage messages', value: 'MANAGE_MESSAGES' }, { text: 'mention everyone', value: 'MENTION_EVERYONE' }, { text: 'attach files', value: 'ATTACH' }, { text: 'admin', value: 'ADMIN' }, { text: 'view', value: 'VIEW' }] },
          biRoleActions: { acceptReporters: false, items: ['add', 'remove'] },
          biChannelProps: { acceptReporters: true, items: ['id', 'name', 'type', 'topic', 'locked', 'can post', 'JSON'] },
          biChannelTypes: { acceptReporters: true, items: ['text', 'voice', 'logs', 'welcome', 'link', 'starboard'] },
          biEvents: { acceptReporters: true, items: ['any', 'chat_message', 'chat_message_update', 'chat_message_delete', 'chat_reactions', 'chat_typing', 'chat_pins_update', 'chat_mention', 'chat_member_update', 'chat_channels_update', 'chat_roles_update', 'chat_server_update', 'chat_identity_update', 'chat_join_request', 'chat_join_result', 'chat_starboard', 'chat_stickers_update', 'chat_voice_state', 'instance_restarting', 'game_status', 'game_console'] },
          biLastProps: { acceptReporters: true, items: ['text', 'author name', 'author display name', 'author id', { text: 'bot name', value: 'alias name' }, { text: 'bot avatar', value: 'alias avatar' }, { text: 'bot name unmarked?', value: 'alias unmarked?' }, 'channel', 'id', 'reply to', 'signed', { text: 'verified', value: 'server says verified' }, 'attachments', 'JSON'] },
          biMethods: { acceptReporters: false, items: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] },
          bfEvents: { acceptReporters: true, items: ['any', 'chat_ready', 'chat_message', 'chat_message_update', 'chat_message_delete', 'chat_reactions', 'chat_pins_update', 'chat_starboard', 'chat_typing', 'chat_read', 'chat_server_update', 'chat_channels_update', 'chat_server_removed', 'chat_roles_update', 'chat_perms_changed', 'chat_member_update', 'chat_members_stale', 'chat_emojis_update', 'chat_voice_state', 'chat_call_state', 'chat_ephemeral', 'chat_error', 'presence_update', 'im_received', 'im_edited', 'im_reactions', 'im_deleted', 'im_pins_update', 'dm_typing', 'roomMessage', 'room_message_edited', 'room_message_reactions', 'room_message_deleted', 'room_pins_update', 'group_update', 'group_removed', 'modmail', 'modmail_staff', 'voice_sound', 'voice_sound_failed', 'game_status', 'game_console', 'game_linked', 'game_unlinked'] },
          bfGameProps: { acceptReporters: true, items: ['online', 'player count', 'max players', 'players (JSON)', 'MOTD', 'version', 'last seen', 'JSON'] },
          bfCloudlinkProps: { acceptReporters: true, items: ['state', 'online count', 'online users (JSON)', 'url', 'room', 'error', 'JSON'] },
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
      api.on('login', () => this._onLogin());
      api.on('logout', () => this._onLogout());
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

    _rtcMessage(...args) { return this.runtime.ext_ikelenenookaravoice?._rtcMessage(...args); }
    _rtcLeave(...args) { return this.runtime.ext_ikelenenookaravoice?._rtcLeave(...args); }
    get _voiceInstance19() { return this.runtime.ext_ikelenenookaravoice?._voiceInstance19; }
    set _voiceInstance19(value) { const peer = this.runtime.ext_ikelenenookaravoice; if (peer) peer._voiceInstance19 = value; }
    get _rtc() { return this.runtime.ext_ikelenenookaravoice?._rtc; }
    set _rtc(value) { const peer = this.runtime.ext_ikelenenookaravoice; if (peer) peer._rtc = value; }
    _onLogin() {
        this._bfEvents = null; this._bfInit(); this._lastChatMsg = null; this._bfLastEvent = null;
        this._restoreInstances();
    }
    _onLogout() {
        this._bfEvents = null; this._bfInit(); this._lastChatMsg = null; this._bfLastEvent = null;
        this._instanceSigningKey = null;
        this._instanceSigningToken = null;
        this._bfMineAt = 0;
        for (const state of this._instances.values()) if (state.velora) { state.cancelled = true; this._stopInstance(state); state.session = null; this._instanceTransition(state, 'disconnected'); this._instances.delete(state.origin); }
    }

    _handleWS(msg) {
      switch (msg.type) {
        case 'chat_message': {
          const m = msg.message;
          const list = this._chatMsgs[m.channel] || (this._chatMsgs[m.channel] = []);
          list.push(m); if (list.length > 100) list.shift();
          this._lastChatMsg = m;
          this._chatEvt[m.channel] = true; this._chatEvt['*'] = true;
          if (this._chatTyping[m.channel] && m.author) delete this._chatTyping[m.channel][m.author.username];
          break;
        }
        case 'chat_message_update': {
          const list = this._chatMsgs[msg.message.channel];
          if (list) { const i = list.findIndex(x => x.id === msg.message.id); if (i >= 0) list[i] = msg.message; }
          break;
        }
        case 'chat_message_delete': {
          const list = this._chatMsgs[msg.channel];
          if (list) this._chatMsgs[msg.channel] = list.filter(x => x.id !== msg.id);
          break;
        }
        case 'chat_typing': {
          const t = this._chatTyping[msg.channel] || (this._chatTyping[msg.channel] = {});
          if (msg.typing === false) delete t[msg.username]; else t[msg.username] = Date.now() + 7000;
          break;
        }
        case 'chat_channels_update': case 'chat_server_update': case 'chat_server_removed':
          this._chatDetail = {}; this._chatServers = null;
          break;
        case 'presence_update': {
          const k = Scratch.Cast.toString(msg.username || '').toLowerCase();
          this._presence[k] = msg.presence;
          if (!msg.request) { this._presenceEvt[k] = true; this._presenceEvt['*'] = true; this._lastPresenceUser = msg.username; }
          break;
        }
        case 'globalMessage':
        case 'imageMessage':
          this._globalMessages.push(msg);
          if (this._globalMessages.length > 500) this._globalMessages.shift();
          this._evtGlobalMsg = true;
          this._lastMsg = msg;
          break;
        case 'roomMessage':
          if (!this._roomMessages[msg.room]) this._roomMessages[msg.room] = [];
          this._roomMessages[msg.room].push(msg);
          if (this._roomMessages[msg.room].length > 1000) this._roomMessages[msg.room].shift();
          this._evtRoomMsgMap[msg.room] = true;
          this._lastMsg = msg;
          break;
        case 'roomHistory':
          this._roomMessages[msg.room] = msg.messages;
          break;
        case 'globalHistory':
          this._globalMessages = msg.messages;
          break;
        case 'typing':
          if (!this._typingUsers.includes(msg.user)) this._typingUsers.push(msg.user);
          break;
        case 'stopTyping':
          this._typingUsers = this._typingUsers.filter(u => u !== msg.user);
          break;
        // Instant Messages
        // an admin changed which services this account can use (applies right away)
        // achievements (granted from any of your apps - the launcher pops them up)
        // ── Nookara Voice ──
      }
    }
    whenGlobalMessageReceived() { const v = this._evtGlobalMsg; this._evtGlobalMsg = false; return v; }
    whenRoomMessageReceived({ ROOM }) { const v = !!this._evtRoomMsgMap[ROOM]; this._evtRoomMsgMap[ROOM] = false; return v; }
    typingUsers()       { return JSON.stringify(this._typingUsers); }
    lastMessageUser()     { return this._lastMsg?.user || ''; }
    lastMessageContent()  { return this._lastMsg?.message || ''; }
    lastMessageUserJson() {
      const m = this._lastMsg;
      if (!m) return '{}';
      return JSON.stringify({ username: m.user, rank: m.rank, color: m.color });
    }
    sendGlobalMessage({ MSG }) {
      this._requireScope(SCOPES.CHAT);
      this._wsSend({ type: 'globalMessage', message: MSG });
    }
    joinRoom({ ROOM }) {
      this._requireScope(SCOPES.CHAT);
      this._wsSend({ type: 'joinRoom', room: ROOM });
    }
    sendRoomMessage({ MSG, ROOM }) {
      this._requireScope(SCOPES.CHAT);
      this._wsSend({ type: 'roomMessage', room: ROOM, message: MSG });
    }
    setTyping({ STATE }) {
      this._wsSend({ type: STATE === 'on' ? 'typing' : 'stopTyping' });
    }
    getGlobalMessages() { this._requireScope(SCOPES.CHAT); return JSON.stringify(this._globalMessages.slice(-50)); }
    getRoomMessages({ ROOM }) { this._requireScope(SCOPES.CHAT); return JSON.stringify((this._roomMessages[ROOM] || []).slice(-50)); }
  }

  // copy pasted from auth.js's SCOPES obj, gotta keep these two in sync by hand
  // since this file can't just require() the server code lol
  const SCOPES = {
    PROFILE_READ: 1,
    PROFILE_SENSITIVE: 2,
    PROJECT_AUTH: 4,
    ACCOUNT_WRITE: 8,
    STORAGE_READ: 16,
    STORAGE_WRITE: 32,
    VMAIL_READ: 64,   // Instant Messages (was vMail, same bits so old tokens still work)
    VMAIL_SEND: 128,
    FRIENDS_READ: 256,
    FRIENDS_MANAGE: 512,
    CURRENCY_PAY: 1024,
    CHAT: 2048,
    MEDIA_UPLOAD: 4096,
    CURRENCY_READ: 8192,
    VOICE: 16384,     // Nookara Voice (voice rooms + calling people into them)
    SIGN_MESSAGES: 32768,
  };
  const VELORA_ROUTES = [
  {
    "opcode": "bfGetChatInviteCode",
    "blockType": "reporter",
    "text": "invite details for [CODE]",
    "arguments": {
      "CODE": {
        "type": "string",
        "defaultValue": ""
      }
    },
    "method": "GET",
    "path": "/chat/invite/:code",
    "params": [
      "code"
    ],
    "query": [],
    "body": false,
    "upload": false,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfGetChatServers",
    "blockType": "reporter",
    "text": "community directory data",
    "arguments": {},
    "method": "GET",
    "path": "/chat/servers",
    "params": [],
    "query": [],
    "body": false,
    "upload": false,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfGetChatDiscover",
    "blockType": "reporter",
    "text": "discoverable community data",
    "arguments": {},
    "method": "GET",
    "path": "/chat/discover",
    "params": [],
    "query": [],
    "body": false,
    "upload": false,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfPostChatServers",
    "blockType": "command",
    "text": "create / send Nookara servers options JSON [OPTIONS]",
    "arguments": {
      "OPTIONS": {
        "type": "string",
        "defaultValue": "{\"name\": \"My server\", \"description\": \"\", \"discoverable\": false}"
      }
    },
    "method": "POST",
    "path": "/chat/servers",
    "params": [],
    "query": [],
    "body": true,
    "upload": false,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfGetChatServersSid",
    "blockType": "reporter",
    "text": "community details for [SID]",
    "arguments": {
      "SID": {
        "type": "string",
        "defaultValue": ""
      }
    },
    "method": "GET",
    "path": "/chat/servers/:sid",
    "params": [
      "sid"
    ],
    "query": [],
    "body": false,
    "upload": false,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfPatchChatServersSid",
    "blockType": "command",
    "text": "update Nookara servers [SID] options JSON [OPTIONS]",
    "arguments": {
      "SID": {
        "type": "string",
        "defaultValue": ""
      },
      "OPTIONS": {
        "type": "string",
        "defaultValue": "{}"
      }
    },
    "method": "PATCH",
    "path": "/chat/servers/:sid",
    "params": [
      "sid"
    ],
    "query": [],
    "body": true,
    "upload": false,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfPutChatServersSidLayout",
    "blockType": "command",
    "text": "set Nookara servers [SID] layout options JSON [OPTIONS]",
    "arguments": {
      "SID": {
        "type": "string",
        "defaultValue": ""
      },
      "OPTIONS": {
        "type": "string",
        "defaultValue": "{\"categories\": [], \"channels\": []}"
      }
    },
    "method": "PUT",
    "path": "/chat/servers/:sid/layout",
    "params": [
      "sid"
    ],
    "query": [],
    "body": true,
    "upload": false,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfPostChatServersSidRoles",
    "blockType": "command",
    "text": "create / send Nookara servers [SID] roles options JSON [OPTIONS]",
    "arguments": {
      "SID": {
        "type": "string",
        "defaultValue": ""
      },
      "OPTIONS": {
        "type": "string",
        "defaultValue": "{\"name\": \"Member\", \"permissions\": 257, \"color\": \"#c084fc\"}"
      }
    },
    "method": "POST",
    "path": "/chat/servers/:sid/roles",
    "params": [
      "sid"
    ],
    "query": [],
    "body": true,
    "upload": false,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfPutChatServersSidRolesOrder",
    "blockType": "command",
    "text": "set Nookara servers [SID] roles order options JSON [OPTIONS]",
    "arguments": {
      "SID": {
        "type": "string",
        "defaultValue": ""
      },
      "OPTIONS": {
        "type": "string",
        "defaultValue": "{\"order\": []}"
      }
    },
    "method": "PUT",
    "path": "/chat/servers/:sid/roles/order",
    "params": [
      "sid"
    ],
    "query": [],
    "body": true,
    "upload": false,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfPatchChatServersSidRolesRid",
    "blockType": "command",
    "text": "update Nookara servers [SID] roles [RID] options JSON [OPTIONS]",
    "arguments": {
      "SID": {
        "type": "string",
        "defaultValue": ""
      },
      "RID": {
        "type": "string",
        "defaultValue": ""
      },
      "OPTIONS": {
        "type": "string",
        "defaultValue": "{}"
      }
    },
    "method": "PATCH",
    "path": "/chat/servers/:sid/roles/:rid",
    "params": [
      "sid",
      "rid"
    ],
    "query": [],
    "body": true,
    "upload": false,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfDeleteChatServersSidRolesRid",
    "blockType": "command",
    "text": "remove Nookara servers [SID] roles [RID]",
    "arguments": {
      "SID": {
        "type": "string",
        "defaultValue": ""
      },
      "RID": {
        "type": "string",
        "defaultValue": ""
      }
    },
    "method": "DELETE",
    "path": "/chat/servers/:sid/roles/:rid",
    "params": [
      "sid",
      "rid"
    ],
    "query": [],
    "body": false,
    "upload": false,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfPutChatServersSidMembersUsernameRolesRid",
    "blockType": "command",
    "text": "set Nookara servers [SID] members [USERNAME] roles [RID] options JSON [OPTIONS]",
    "arguments": {
      "SID": {
        "type": "string",
        "defaultValue": ""
      },
      "USERNAME": {
        "type": "string",
        "defaultValue": ""
      },
      "RID": {
        "type": "string",
        "defaultValue": ""
      },
      "OPTIONS": {
        "type": "string",
        "defaultValue": "{}"
      }
    },
    "method": "PUT",
    "path": "/chat/servers/:sid/members/:username/roles/:rid",
    "params": [
      "sid",
      "username",
      "rid"
    ],
    "query": [],
    "body": true,
    "upload": false,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfDeleteChatServersSidMembersUsernameRolesRid",
    "blockType": "command",
    "text": "remove Nookara servers [SID] members [USERNAME] roles [RID]",
    "arguments": {
      "SID": {
        "type": "string",
        "defaultValue": ""
      },
      "USERNAME": {
        "type": "string",
        "defaultValue": ""
      },
      "RID": {
        "type": "string",
        "defaultValue": ""
      }
    },
    "method": "DELETE",
    "path": "/chat/servers/:sid/members/:username/roles/:rid",
    "params": [
      "sid",
      "username",
      "rid"
    ],
    "query": [],
    "body": false,
    "upload": false,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfPostChatServersSidRolesRidIcon",
    "blockType": "command",
    "text": "create / send Nookara servers [SID] roles [RID] icon options JSON [OPTIONS] file data URI [FILE] filename [FILENAME]",
    "arguments": {
      "SID": {
        "type": "string",
        "defaultValue": ""
      },
      "RID": {
        "type": "string",
        "defaultValue": ""
      },
      "OPTIONS": {
        "type": "string",
        "defaultValue": "{}"
      },
      "FILE": {
        "type": "string",
        "defaultValue": ""
      },
      "FILENAME": {
        "type": "string",
        "defaultValue": "file.png"
      }
    },
    "method": "POST",
    "path": "/chat/servers/:sid/roles/:rid/icon",
    "params": [
      "sid",
      "rid"
    ],
    "query": [],
    "body": true,
    "upload": true,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfDeleteChatServersSidRolesRidIcon",
    "blockType": "command",
    "text": "remove Nookara servers [SID] roles [RID] icon",
    "arguments": {
      "SID": {
        "type": "string",
        "defaultValue": ""
      },
      "RID": {
        "type": "string",
        "defaultValue": ""
      }
    },
    "method": "DELETE",
    "path": "/chat/servers/:sid/roles/:rid/icon",
    "params": [
      "sid",
      "rid"
    ],
    "query": [],
    "body": false,
    "upload": false,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfPostChatChannelsCidIcon",
    "blockType": "command",
    "text": "create / send Nookara channels [CID] icon options JSON [OPTIONS] file data URI [FILE] filename [FILENAME]",
    "arguments": {
      "CID": {
        "type": "string",
        "defaultValue": ""
      },
      "OPTIONS": {
        "type": "string",
        "defaultValue": "{}"
      },
      "FILE": {
        "type": "string",
        "defaultValue": ""
      },
      "FILENAME": {
        "type": "string",
        "defaultValue": "file.png"
      }
    },
    "method": "POST",
    "path": "/chat/channels/:cid/icon",
    "params": [
      "cid"
    ],
    "query": [],
    "body": true,
    "upload": true,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfDeleteChatServersSid",
    "blockType": "command",
    "text": "remove Nookara servers [SID]",
    "arguments": {
      "SID": {
        "type": "string",
        "defaultValue": ""
      }
    },
    "method": "DELETE",
    "path": "/chat/servers/:sid",
    "params": [
      "sid"
    ],
    "query": [],
    "body": false,
    "upload": false,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfPostChatServersSidJoin",
    "blockType": "command",
    "text": "create / send Nookara servers [SID] join options JSON [OPTIONS]",
    "arguments": {
      "SID": {
        "type": "string",
        "defaultValue": ""
      },
      "OPTIONS": {
        "type": "string",
        "defaultValue": "{}"
      }
    },
    "method": "POST",
    "path": "/chat/servers/:sid/join",
    "params": [
      "sid"
    ],
    "query": [],
    "body": true,
    "upload": false,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfPostChatJoinCode",
    "blockType": "command",
    "text": "create / send Nookara join [CODE] options JSON [OPTIONS]",
    "arguments": {
      "CODE": {
        "type": "string",
        "defaultValue": ""
      },
      "OPTIONS": {
        "type": "string",
        "defaultValue": "{}"
      }
    },
    "method": "POST",
    "path": "/chat/join/:code",
    "params": [
      "code"
    ],
    "query": [],
    "body": true,
    "upload": false,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfPostChatServersSidLeave",
    "blockType": "command",
    "text": "create / send Nookara servers [SID] leave options JSON [OPTIONS]",
    "arguments": {
      "SID": {
        "type": "string",
        "defaultValue": ""
      },
      "OPTIONS": {
        "type": "string",
        "defaultValue": "{}"
      }
    },
    "method": "POST",
    "path": "/chat/servers/:sid/leave",
    "params": [
      "sid"
    ],
    "query": [],
    "body": true,
    "upload": false,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfGetChatServersSidMembers",
    "blockType": "reporter",
    "text": "membership data for community [SID]",
    "arguments": {
      "SID": {
        "type": "string",
        "defaultValue": ""
      }
    },
    "method": "GET",
    "path": "/chat/servers/:sid/members",
    "params": [
      "sid"
    ],
    "query": [],
    "body": false,
    "upload": false,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfDeleteChatServersSidMembersUsername",
    "blockType": "command",
    "text": "remove Nookara servers [SID] members [USERNAME] query JSON [QUERY]",
    "arguments": {
      "SID": {
        "type": "string",
        "defaultValue": ""
      },
      "USERNAME": {
        "type": "string",
        "defaultValue": ""
      },
      "QUERY": {
        "type": "string",
        "defaultValue": "{}"
      }
    },
    "method": "DELETE",
    "path": "/chat/servers/:sid/members/:username",
    "params": [
      "sid",
      "username"
    ],
    "query": [
      "ban"
    ],
    "body": false,
    "upload": false,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfDeleteChatServersSidBansUsername",
    "blockType": "command",
    "text": "remove Nookara servers [SID] bans [USERNAME]",
    "arguments": {
      "SID": {
        "type": "string",
        "defaultValue": ""
      },
      "USERNAME": {
        "type": "string",
        "defaultValue": ""
      }
    },
    "method": "DELETE",
    "path": "/chat/servers/:sid/bans/:username",
    "params": [
      "sid",
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
    "opcode": "bfPostChatServersSidIcon",
    "blockType": "command",
    "text": "create / send Nookara servers [SID] icon options JSON [OPTIONS] file data URI [FILE] filename [FILENAME]",
    "arguments": {
      "SID": {
        "type": "string",
        "defaultValue": ""
      },
      "OPTIONS": {
        "type": "string",
        "defaultValue": "{}"
      },
      "FILE": {
        "type": "string",
        "defaultValue": ""
      },
      "FILENAME": {
        "type": "string",
        "defaultValue": "file.png"
      }
    },
    "method": "POST",
    "path": "/chat/servers/:sid/icon",
    "params": [
      "sid"
    ],
    "query": [],
    "body": true,
    "upload": true,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfPostChatServersSidBanner",
    "blockType": "command",
    "text": "create / send Nookara servers [SID] banner options JSON [OPTIONS] file data URI [FILE] filename [FILENAME]",
    "arguments": {
      "SID": {
        "type": "string",
        "defaultValue": ""
      },
      "OPTIONS": {
        "type": "string",
        "defaultValue": "{}"
      },
      "FILE": {
        "type": "string",
        "defaultValue": ""
      },
      "FILENAME": {
        "type": "string",
        "defaultValue": "file.png"
      }
    },
    "method": "POST",
    "path": "/chat/servers/:sid/banner",
    "params": [
      "sid"
    ],
    "query": [],
    "body": true,
    "upload": true,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfDeleteChatServersSidIcon",
    "blockType": "command",
    "text": "remove Nookara servers [SID] icon",
    "arguments": {
      "SID": {
        "type": "string",
        "defaultValue": ""
      }
    },
    "method": "DELETE",
    "path": "/chat/servers/:sid/icon",
    "params": [
      "sid"
    ],
    "query": [],
    "body": false,
    "upload": false,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfDeleteChatServersSidBanner",
    "blockType": "command",
    "text": "remove Nookara servers [SID] banner",
    "arguments": {
      "SID": {
        "type": "string",
        "defaultValue": ""
      }
    },
    "method": "DELETE",
    "path": "/chat/servers/:sid/banner",
    "params": [
      "sid"
    ],
    "query": [],
    "body": false,
    "upload": false,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfPostChatServersSidChannels",
    "blockType": "command",
    "text": "create / send Nookara servers [SID] channels options JSON [OPTIONS]",
    "arguments": {
      "SID": {
        "type": "string",
        "defaultValue": ""
      },
      "OPTIONS": {
        "type": "string",
        "defaultValue": "{\"name\": \"general\", \"type\": \"text\", \"topic\": \"\", \"category\": \"\"}"
      }
    },
    "method": "POST",
    "path": "/chat/servers/:sid/channels",
    "params": [
      "sid"
    ],
    "query": [],
    "body": true,
    "upload": false,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfPatchChatChannelsCid",
    "blockType": "command",
    "text": "update Nookara channels [CID] options JSON [OPTIONS]",
    "arguments": {
      "CID": {
        "type": "string",
        "defaultValue": ""
      },
      "OPTIONS": {
        "type": "string",
        "defaultValue": "{}"
      }
    },
    "method": "PATCH",
    "path": "/chat/channels/:cid",
    "params": [
      "cid"
    ],
    "query": [],
    "body": true,
    "upload": false,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfDeleteChatChannelsCid",
    "blockType": "command",
    "text": "remove Nookara channels [CID]",
    "arguments": {
      "CID": {
        "type": "string",
        "defaultValue": ""
      }
    },
    "method": "DELETE",
    "path": "/chat/channels/:cid",
    "params": [
      "cid"
    ],
    "query": [],
    "body": false,
    "upload": false,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfGetChatChannelsCidMessages",
    "blockType": "reporter",
    "text": "message data for channel [CID] with filters [QUERY]",
    "arguments": {
      "CID": {
        "type": "string",
        "defaultValue": ""
      },
      "QUERY": {
        "type": "string",
        "defaultValue": "{\"limit\": 100}"
      }
    },
    "method": "GET",
    "path": "/chat/channels/:cid/messages",
    "params": [
      "cid"
    ],
    "query": [
      "before",
      "after",
      "limit"
    ],
    "body": false,
    "upload": false,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfPostChatChannelsCidMessages",
    "blockType": "command",
    "text": "create / send Nookara channels [CID] messages options JSON [OPTIONS]",
    "arguments": {
      "CID": {
        "type": "string",
        "defaultValue": ""
      },
      "OPTIONS": {
        "type": "string",
        "defaultValue": "{\"message\": \"Hello!\", \"reply_to\": null, \"attachments\": []}"
      }
    },
    "method": "POST",
    "path": "/chat/channels/:cid/messages",
    "params": [
      "cid"
    ],
    "query": [],
    "body": true,
    "upload": false,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfPostChatChannelsCidRead",
    "blockType": "command",
    "text": "create / send Nookara channels [CID] read options JSON [OPTIONS]",
    "arguments": {
      "CID": {
        "type": "string",
        "defaultValue": ""
      },
      "OPTIONS": {
        "type": "string",
        "defaultValue": "{}"
      }
    },
    "method": "POST",
    "path": "/chat/channels/:cid/read",
    "params": [
      "cid"
    ],
    "query": [],
    "body": true,
    "upload": false,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfGetChatChannelsCidSearch",
    "blockType": "reporter",
    "text": "message search in channel [CID] with filters [QUERY]",
    "arguments": {
      "CID": {
        "type": "string",
        "defaultValue": ""
      },
      "QUERY": {
        "type": "string",
        "defaultValue": "{}"
      }
    },
    "method": "GET",
    "path": "/chat/channels/:cid/search",
    "params": [
      "cid"
    ],
    "query": [
      "q"
    ],
    "body": false,
    "upload": false,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfPatchChatMessagesId",
    "blockType": "command",
    "text": "update Nookara messages [ID] options JSON [OPTIONS]",
    "arguments": {
      "ID": {
        "type": "string",
        "defaultValue": ""
      },
      "OPTIONS": {
        "type": "string",
        "defaultValue": "{}"
      }
    },
    "method": "PATCH",
    "path": "/chat/messages/:id",
    "params": [
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
    "opcode": "bfDeleteChatMessagesId",
    "blockType": "command",
    "text": "remove Nookara messages [ID]",
    "arguments": {
      "ID": {
        "type": "string",
        "defaultValue": ""
      }
    },
    "method": "DELETE",
    "path": "/chat/messages/:id",
    "params": [
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
    "opcode": "bfPostChatUpload",
    "blockType": "command",
    "text": "create / send Nookara upload options JSON [OPTIONS] file data URI [FILE] filename [FILENAME]",
    "arguments": {
      "OPTIONS": {
        "type": "string",
        "defaultValue": "{}"
      },
      "FILE": {
        "type": "string",
        "defaultValue": ""
      },
      "FILENAME": {
        "type": "string",
        "defaultValue": "file.png"
      }
    },
    "method": "POST",
    "path": "/chat/upload",
    "params": [],
    "query": [],
    "body": true,
    "upload": true,
    "scopes": [
      2048,
      4096
    ]
  },
  {
    "opcode": "bfGetChatNotify",
    "blockType": "reporter",
    "text": "notification preferences data",
    "arguments": {},
    "method": "GET",
    "path": "/chat/notify",
    "params": [],
    "query": [],
    "body": false,
    "upload": false,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfPutChatNotifyTarget",
    "blockType": "command",
    "text": "set Nookara notify [TARGET] options JSON [OPTIONS]",
    "arguments": {
      "TARGET": {
        "type": "string",
        "defaultValue": ""
      },
      "OPTIONS": {
        "type": "string",
        "defaultValue": "{\"level\": \"mentions\", \"mute_minutes\": 0, \"push\": true}"
      }
    },
    "method": "PUT",
    "path": "/chat/notify/:target",
    "params": [
      "target"
    ],
    "query": [],
    "body": true,
    "upload": false,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfGetChatSettings",
    "blockType": "reporter",
    "text": "chat preference data",
    "arguments": {},
    "method": "GET",
    "path": "/chat/settings",
    "params": [],
    "query": [],
    "body": false,
    "upload": false,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfPatchChatSettings",
    "blockType": "command",
    "text": "update Nookara settings options JSON [OPTIONS]",
    "arguments": {
      "OPTIONS": {
        "type": "string",
        "defaultValue": "{}"
      }
    },
    "method": "PATCH",
    "path": "/chat/settings",
    "params": [],
    "query": [],
    "body": true,
    "upload": false,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfGetChatOpen",
    "blockType": "reporter",
    "text": "open chat destination data",
    "arguments": {},
    "method": "GET",
    "path": "/chat/open",
    "params": [],
    "query": [],
    "body": false,
    "upload": false,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfGetChatBots",
    "blockType": "reporter",
    "text": "bot directory data",
    "arguments": {},
    "method": "GET",
    "path": "/chat/bots",
    "params": [],
    "query": [],
    "body": false,
    "upload": false,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfPostChatBots",
    "blockType": "command",
    "text": "create / send Nookara bots options JSON [OPTIONS]",
    "arguments": {
      "OPTIONS": {
        "type": "string",
        "defaultValue": "{}"
      }
    },
    "method": "POST",
    "path": "/chat/bots",
    "params": [],
    "query": [],
    "body": true,
    "upload": false,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfPatchChatBotsId",
    "blockType": "command",
    "text": "update Nookara bots [ID] options JSON [OPTIONS]",
    "arguments": {
      "ID": {
        "type": "string",
        "defaultValue": ""
      },
      "OPTIONS": {
        "type": "string",
        "defaultValue": "{}"
      }
    },
    "method": "PATCH",
    "path": "/chat/bots/:id",
    "params": [
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
    "opcode": "bfPostChatBotsIdAvatar",
    "blockType": "command",
    "text": "create / send Nookara bots [ID] avatar options JSON [OPTIONS] file data URI [FILE] filename [FILENAME]",
    "arguments": {
      "ID": {
        "type": "string",
        "defaultValue": ""
      },
      "OPTIONS": {
        "type": "string",
        "defaultValue": "{}"
      },
      "FILE": {
        "type": "string",
        "defaultValue": ""
      },
      "FILENAME": {
        "type": "string",
        "defaultValue": "file.png"
      }
    },
    "method": "POST",
    "path": "/chat/bots/:id/avatar",
    "params": [
      "id"
    ],
    "query": [],
    "body": true,
    "upload": true,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfPostChatBotsIdToken",
    "blockType": "command",
    "text": "create / send Nookara bots [ID] token options JSON [OPTIONS]",
    "arguments": {
      "ID": {
        "type": "string",
        "defaultValue": ""
      },
      "OPTIONS": {
        "type": "string",
        "defaultValue": "{}"
      }
    },
    "method": "POST",
    "path": "/chat/bots/:id/token",
    "params": [
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
    "opcode": "bfDeleteChatBotsId",
    "blockType": "command",
    "text": "remove Nookara bots [ID]",
    "arguments": {
      "ID": {
        "type": "string",
        "defaultValue": ""
      }
    },
    "method": "DELETE",
    "path": "/chat/bots/:id",
    "params": [
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
    "opcode": "bfPostChatBotsByNameUsernameAdd",
    "blockType": "command",
    "text": "create / send Nookara bots by name [USERNAME] add options JSON [OPTIONS]",
    "arguments": {
      "USERNAME": {
        "type": "string",
        "defaultValue": ""
      },
      "OPTIONS": {
        "type": "string",
        "defaultValue": "{}"
      }
    },
    "method": "POST",
    "path": "/chat/bots/by-name/:username/add",
    "params": [
      "username"
    ],
    "query": [],
    "body": true,
    "upload": false,
    "scopes": [
      2048
    ]
  },
    {
      "opcode": "bfGetBonfireBotsGallery",
      "blockType": "reporter",
      "text": "bot gallery list query JSON [QUERY]",
      "arguments": {
        "QUERY": {
          "type": "string",
          "defaultValue": "{\"q\":\"\",\"tag\":\"\",\"page\":1}"
        }
      },
      "method": "GET",
      "path": "/bonfire/bots/gallery",
      "params": [],
      "query": [
        "q",
        "tag",
        "page"
      ],
      "body": false,
      "upload": false,
      "scopes": []
    },
    {
      "opcode": "bfGetBonfireBotsGalleryTags",
      "blockType": "reporter",
      "text": "bot gallery tags",
      "arguments": {},
      "method": "GET",
      "path": "/bonfire/bots/gallery/tags",
      "params": [],
      "query": [],
      "body": false,
      "upload": false,
      "scopes": []
    },
    {
      "opcode": "bfGetBonfireBotsGalleryId",
      "blockType": "reporter",
      "text": "bot gallery details for bot [ID]",
      "arguments": {
        "ID": {
          "type": "string",
          "defaultValue": ""
        }
      },
      "method": "GET",
      "path": "/bonfire/bots/gallery/:id",
      "params": [
        "id"
      ],
      "query": [],
      "body": false,
      "upload": false,
      "scopes": []
    },
    {
      "opcode": "bfPostBonfireBotsGalleryIdTicket",
      "blockType": "reporter",
      "text": "bot gallery add ticket for bot [ID] options JSON [OPTIONS]",
      "arguments": {
        "ID": {
          "type": "string",
          "defaultValue": ""
        },
        "OPTIONS": {
          "type": "string",
          "defaultValue": "{\"instance\":\"https://chat.ikelene.net\"}"
        }
      },
      "method": "POST",
      "path": "/bonfire/bots/gallery/:id/ticket",
      "params": [
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
      "opcode": "bfGetChatBotsIdGallery",
      "blockType": "reporter",
      "text": "my bot [ID] gallery status",
      "arguments": {
        "ID": {
          "type": "string",
          "defaultValue": ""
        }
      },
      "method": "GET",
      "path": "/chat/bots/:id/gallery",
      "params": [
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
      "opcode": "bfPutChatBotsIdGallery",
      "blockType": "command",
      "text": "save my bot [ID] gallery listing options JSON [OPTIONS]",
      "arguments": {
        "ID": {
          "type": "string",
          "defaultValue": ""
        },
        "OPTIONS": {
          "type": "string",
          "defaultValue": "{\"long_description\":\"\",\"tags\":[],\"support_url\":\"\",\"links\":[],\"permissions\":[]}"
        }
      },
      "method": "PUT",
      "path": "/chat/bots/:id/gallery",
      "params": [
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
      "opcode": "bfPostChatBotsIdGallerySubmit",
      "blockType": "command",
      "text": "submit my bot [ID] to the gallery options JSON [OPTIONS]",
      "arguments": {
        "ID": {
          "type": "string",
          "defaultValue": ""
        },
        "OPTIONS": {
          "type": "string",
          "defaultValue": "{}"
        }
      },
      "method": "POST",
      "path": "/chat/bots/:id/gallery/submit",
      "params": [
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
      "opcode": "bfPostChatBotsIdGalleryWithdraw",
      "blockType": "command",
      "text": "withdraw my bot [ID] from the gallery",
      "arguments": {
        "ID": {
          "type": "string",
          "defaultValue": ""
        }
      },
      "method": "POST",
      "path": "/chat/bots/:id/gallery/withdraw",
      "params": [
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
    "opcode": "bfGetChatGifs",
    "blockType": "reporter",
    "text": "GIF search results with filters [QUERY]",
    "arguments": {
      "QUERY": {
        "type": "string",
        "defaultValue": "{}"
      }
    },
    "method": "GET",
    "path": "/chat/gifs",
    "params": [],
    "query": [
      "q",
      "page"
    ],
    "body": false,
    "upload": false,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfGetChatMedia",
    "blockType": "reporter",
    "text": "media catalogue data",
    "arguments": {},
    "method": "GET",
    "path": "/chat/media",
    "params": [],
    "query": [],
    "body": false,
    "upload": false,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfGetChatMediaLimits",
    "blockType": "reporter",
    "text": "upload size limits JSON (MB)",
    "arguments": {},
    "method": "GET",
    "path": "/chat/media/limits",
    "params": [],
    "query": [],
    "body": false,
    "upload": false,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfPostChatMediaSave",
    "blockType": "command",
    "text": "create / send Nookara media save options JSON [OPTIONS]",
    "arguments": {
      "OPTIONS": {
        "type": "string",
        "defaultValue": "{}"
      }
    },
    "method": "POST",
    "path": "/chat/media/save",
    "params": [],
    "query": [],
    "body": true,
    "upload": false,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfGetChatKlipyKindSlug",
    "blockType": "reporter",
    "text": "Klipy media details for [KIND] item [SLUG]",
    "arguments": {
      "KIND": {
        "type": "string",
        "defaultValue": ""
      },
      "SLUG": {
        "type": "string",
        "defaultValue": ""
      }
    },
    "method": "GET",
    "path": "/chat/klipy/:kind/:slug",
    "params": [
      "kind",
      "slug"
    ],
    "query": [],
    "body": false,
    "upload": false,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfPostChatMediaGif",
    "blockType": "command",
    "text": "create / send Nookara media gif options JSON [OPTIONS]",
    "arguments": {
      "OPTIONS": {
        "type": "string",
        "defaultValue": "{}"
      }
    },
    "method": "POST",
    "path": "/chat/media/gif",
    "params": [],
    "query": [],
    "body": true,
    "upload": false,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfDeleteChatMediaId",
    "blockType": "command",
    "text": "remove Nookara media [ID]",
    "arguments": {
      "ID": {
        "type": "string",
        "defaultValue": ""
      }
    },
    "method": "DELETE",
    "path": "/chat/media/:id",
    "params": [
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
    "opcode": "bfDeleteChatMedia",
    "blockType": "command",
    "text": "remove Nookara media query JSON [QUERY]",
    "arguments": {
      "QUERY": {
        "type": "string",
        "defaultValue": "{}"
      }
    },
    "method": "DELETE",
    "path": "/chat/media",
    "params": [],
    "query": [
      "url"
    ],
    "body": false,
    "upload": false,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfPostChatMediaUpload",
    "blockType": "command",
    "text": "create / send Nookara media upload options JSON [OPTIONS] file data URI [FILE] filename [FILENAME]",
    "arguments": {
      "OPTIONS": {
        "type": "string",
        "defaultValue": "{}"
      },
      "FILE": {
        "type": "string",
        "defaultValue": ""
      },
      "FILENAME": {
        "type": "string",
        "defaultValue": "file.png"
      }
    },
    "method": "POST",
    "path": "/chat/media/upload",
    "params": [],
    "query": [],
    "body": true,
    "upload": true,
    "scopes": [
      2048,
      4096
    ]
  },
  {
    "opcode": "bfGetChatEmojis",
    "blockType": "reporter",
    "text": "emoji catalogue data",
    "arguments": {},
    "method": "GET",
    "path": "/chat/emojis",
    "params": [],
    "query": [],
    "body": false,
    "upload": false,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfGetChatEmojisEidInfo",
    "blockType": "reporter",
    "text": "emoji details for [EID]",
    "arguments": {
      "EID": {
        "type": "string",
        "defaultValue": ""
      }
    },
    "method": "GET",
    "path": "/chat/emojis/:eid/info",
    "params": [
      "eid"
    ],
    "query": [],
    "body": false,
    "upload": false,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfGetChatServersSidEmojis",
    "blockType": "reporter",
    "text": "emoji catalogue for community [SID]",
    "arguments": {
      "SID": {
        "type": "string",
        "defaultValue": ""
      }
    },
    "method": "GET",
    "path": "/chat/servers/:sid/emojis",
    "params": [
      "sid"
    ],
    "query": [],
    "body": false,
    "upload": false,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfPostChatServersSidEmojis",
    "blockType": "command",
    "text": "create / send Nookara servers [SID] emojis options JSON [OPTIONS] file data URI [FILE] filename [FILENAME]",
    "arguments": {
      "SID": {
        "type": "string",
        "defaultValue": ""
      },
      "OPTIONS": {
        "type": "string",
        "defaultValue": "{}"
      },
      "FILE": {
        "type": "string",
        "defaultValue": ""
      },
      "FILENAME": {
        "type": "string",
        "defaultValue": "file.png"
      }
    },
    "method": "POST",
    "path": "/chat/servers/:sid/emojis",
    "params": [
      "sid"
    ],
    "query": [],
    "body": true,
    "upload": true,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfPatchChatServersSidEmojisEid",
    "blockType": "command",
    "text": "update Nookara servers [SID] emojis [EID] options JSON [OPTIONS]",
    "arguments": {
      "SID": {
        "type": "string",
        "defaultValue": ""
      },
      "EID": {
        "type": "string",
        "defaultValue": ""
      },
      "OPTIONS": {
        "type": "string",
        "defaultValue": "{}"
      }
    },
    "method": "PATCH",
    "path": "/chat/servers/:sid/emojis/:eid",
    "params": [
      "sid",
      "eid"
    ],
    "query": [],
    "body": true,
    "upload": false,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfDeleteChatServersSidEmojisEid",
    "blockType": "command",
    "text": "remove Nookara servers [SID] emojis [EID]",
    "arguments": {
      "SID": {
        "type": "string",
        "defaultValue": ""
      },
      "EID": {
        "type": "string",
        "defaultValue": ""
      }
    },
    "method": "DELETE",
    "path": "/chat/servers/:sid/emojis/:eid",
    "params": [
      "sid",
      "eid"
    ],
    "query": [],
    "body": false,
    "upload": false,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfGetChatBridgePlatforms",
    "blockType": "reporter",
    "text": "supported bridge services",
    "arguments": {},
    "method": "GET",
    "path": "/chat/bridge/platforms",
    "params": [],
    "query": [],
    "body": false,
    "upload": false,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfGetChatBridgePlatformGuilds",
    "blockType": "reporter",
    "text": "linked communities on [PLATFORM]",
    "arguments": {
      "PLATFORM": {
        "type": "string",
        "defaultValue": ""
      }
    },
    "method": "GET",
    "path": "/chat/bridge/:platform/guilds",
    "params": [
      "platform"
    ],
    "query": [],
    "body": false,
    "upload": false,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfGetChatBridgePlatformGuildsGid",
    "blockType": "reporter",
    "text": "linked community [GID] on [PLATFORM]",
    "arguments": {
      "PLATFORM": {
        "type": "string",
        "defaultValue": ""
      },
      "GID": {
        "type": "string",
        "defaultValue": ""
      }
    },
    "method": "GET",
    "path": "/chat/bridge/:platform/guilds/:gid",
    "params": [
      "platform",
      "gid"
    ],
    "query": [],
    "body": false,
    "upload": false,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfPostChatBridgePlatformGuildsGidImport",
    "blockType": "command",
    "text": "create / send Nookara bridge [PLATFORM] guilds [GID] import options JSON [OPTIONS]",
    "arguments": {
      "PLATFORM": {
        "type": "string",
        "defaultValue": ""
      },
      "GID": {
        "type": "string",
        "defaultValue": ""
      },
      "OPTIONS": {
        "type": "string",
        "defaultValue": "{}"
      }
    },
    "method": "POST",
    "path": "/chat/bridge/:platform/guilds/:gid/import",
    "params": [
      "platform",
      "gid"
    ],
    "query": [],
    "body": true,
    "upload": false,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfGetChatBridgeServersSid",
    "blockType": "reporter",
    "text": "bridge configuration for community [SID]",
    "arguments": {
      "SID": {
        "type": "string",
        "defaultValue": ""
      }
    },
    "method": "GET",
    "path": "/chat/bridge/servers/:sid",
    "params": [
      "sid"
    ],
    "query": [],
    "body": false,
    "upload": false,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfPutChatBridgeServersSid",
    "blockType": "command",
    "text": "set Nookara bridge servers [SID] options JSON [OPTIONS]",
    "arguments": {
      "SID": {
        "type": "string",
        "defaultValue": ""
      },
      "OPTIONS": {
        "type": "string",
        "defaultValue": "{}"
      }
    },
    "method": "PUT",
    "path": "/chat/bridge/servers/:sid",
    "params": [
      "sid"
    ],
    "query": [],
    "body": true,
    "upload": false,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfPatchChatBridgeServersSid",
    "blockType": "command",
    "text": "update Nookara bridge servers [SID] options JSON [OPTIONS]",
    "arguments": {
      "SID": {
        "type": "string",
        "defaultValue": ""
      },
      "OPTIONS": {
        "type": "string",
        "defaultValue": "{}"
      }
    },
    "method": "PATCH",
    "path": "/chat/bridge/servers/:sid",
    "params": [
      "sid"
    ],
    "query": [],
    "body": true,
    "upload": false,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfDeleteChatBridgeServersSid",
    "blockType": "command",
    "text": "remove Nookara bridge servers [SID]",
    "arguments": {
      "SID": {
        "type": "string",
        "defaultValue": ""
      }
    },
    "method": "DELETE",
    "path": "/chat/bridge/servers/:sid",
    "params": [
      "sid"
    ],
    "query": [],
    "body": false,
    "upload": false,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfPutChatBridgeServersSidChannelsCid",
    "blockType": "command",
    "text": "set Nookara bridge servers [SID] channels [CID] options JSON [OPTIONS]",
    "arguments": {
      "SID": {
        "type": "string",
        "defaultValue": ""
      },
      "CID": {
        "type": "string",
        "defaultValue": ""
      },
      "OPTIONS": {
        "type": "string",
        "defaultValue": "{}"
      }
    },
    "method": "PUT",
    "path": "/chat/bridge/servers/:sid/channels/:cid",
    "params": [
      "sid",
      "cid"
    ],
    "query": [],
    "body": true,
    "upload": false,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfPostChatMediaExternal",
    "blockType": "command",
    "text": "create / send Nookara media external options JSON [OPTIONS] file data URI [FILE] filename [FILENAME]",
    "arguments": {
      "OPTIONS": {
        "type": "string",
        "defaultValue": "{}"
      },
      "FILE": {
        "type": "string",
        "defaultValue": ""
      },
      "FILENAME": {
        "type": "string",
        "defaultValue": "file.png"
      }
    },
    "method": "POST",
    "path": "/chat/media/external",
    "params": [],
    "query": [],
    "body": true,
    "upload": true,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfGetChatServersSidSearch",
    "blockType": "reporter",
    "text": "community search in [SID] with filters [QUERY]",
    "arguments": {
      "SID": {
        "type": "string",
        "defaultValue": ""
      },
      "QUERY": {
        "type": "string",
        "defaultValue": "{}"
      }
    },
    "method": "GET",
    "path": "/chat/servers/:sid/search",
    "params": [
      "sid"
    ],
    "query": [
      "q",
      "offset"
    ],
    "body": false,
    "upload": false,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfGetChatChannelsCidStarboard",
    "blockType": "reporter",
    "text": "highlighted posts for channel [CID] with filters [QUERY]",
    "arguments": {
      "CID": {
        "type": "string",
        "defaultValue": ""
      },
      "QUERY": {
        "type": "string",
        "defaultValue": "{}"
      }
    },
    "method": "GET",
    "path": "/chat/channels/:cid/starboard",
    "params": [
      "cid"
    ],
    "query": [
      "before"
    ],
    "body": false,
    "upload": false,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfGetChatChannelsCidCloudlink",
    "blockType": "reporter",
    "text": "CloudLink configuration for channel [CID]",
    "arguments": {
      "CID": {
        "type": "string",
        "defaultValue": ""
      }
    },
    "method": "GET",
    "path": "/chat/channels/:cid/cloudlink",
    "params": [
      "cid"
    ],
    "query": [],
    "body": false,
    "upload": false,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfPostChatChannelsCidCloudlinkReconnect",
    "blockType": "command",
    "text": "post Nookara channels [CID] cloudlink reconnect",
    "arguments": {
      "CID": {
        "type": "string",
        "defaultValue": ""
      }
    },
    "method": "POST",
    "path": "/chat/channels/:cid/cloudlink/reconnect",
    "params": [
      "cid"
    ],
    "query": [],
    "body": false,
    "upload": false,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfPutChatMessagesIdReactionsEmoji",
    "blockType": "command",
    "text": "set Nookara messages [ID] reactions [EMOJI] options JSON [OPTIONS]",
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
    "path": "/chat/messages/:id/reactions/:emoji",
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
    "opcode": "bfDeleteChatMessagesIdReactionsEmoji",
    "blockType": "command",
    "text": "remove Nookara messages [ID] reactions [EMOJI]",
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
    "path": "/chat/messages/:id/reactions/:emoji",
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
    "opcode": "bfPutChatChannelsCidPerms",
    "blockType": "command",
    "text": "set Nookara channels [CID] perms options JSON [OPTIONS]",
    "arguments": {
      "CID": {
        "type": "string",
        "defaultValue": ""
      },
      "OPTIONS": {
        "type": "string",
        "defaultValue": "{\"overwrites\": []}"
      }
    },
    "method": "PUT",
    "path": "/chat/channels/:cid/perms",
    "params": [
      "cid"
    ],
    "query": [],
    "body": true,
    "upload": false,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfGetChatModmail",
    "blockType": "reporter",
    "text": "my moderation inbox data",
    "arguments": {},
    "method": "GET",
    "path": "/chat/modmail",
    "params": [],
    "query": [],
    "body": false,
    "upload": false,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfPostChatModmailRead",
    "blockType": "command",
    "text": "create / send Nookara modmail read options JSON [OPTIONS]",
    "arguments": {
      "OPTIONS": {
        "type": "string",
        "defaultValue": "{}"
      }
    },
    "method": "POST",
    "path": "/chat/modmail/read",
    "params": [],
    "query": [],
    "body": true,
    "upload": false,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfGetChatModmailStaff",
    "blockType": "reporter",
    "text": "staff moderation inbox data",
    "arguments": {},
    "method": "GET",
    "path": "/chat/modmail/staff",
    "params": [],
    "query": [],
    "body": false,
    "upload": false,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfGetChatModmailWithUsername",
    "blockType": "reporter",
    "text": "moderation conversation with [USERNAME]",
    "arguments": {
      "USERNAME": {
        "type": "string",
        "defaultValue": ""
      }
    },
    "method": "GET",
    "path": "/chat/modmail/with/:username",
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
    "opcode": "bfPostChatModmailWithUsername",
    "blockType": "command",
    "text": "create / send Nookara modmail with [USERNAME] options JSON [OPTIONS]",
    "arguments": {
      "USERNAME": {
        "type": "string",
        "defaultValue": ""
      },
      "OPTIONS": {
        "type": "string",
        "defaultValue": "{}"
      }
    },
    "method": "POST",
    "path": "/chat/modmail/with/:username",
    "params": [
      "username"
    ],
    "query": [],
    "body": true,
    "upload": false,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfGetChatSounds",
    "blockType": "reporter",
    "text": "sound catalogue data",
    "arguments": {},
    "method": "GET",
    "path": "/chat/sounds",
    "params": [],
    "query": [],
    "body": false,
    "upload": false,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfGetChatServersSidSounds",
    "blockType": "reporter",
    "text": "sound catalogue for community [SID]",
    "arguments": {
      "SID": {
        "type": "string",
        "defaultValue": ""
      }
    },
    "method": "GET",
    "path": "/chat/servers/:sid/sounds",
    "params": [
      "sid"
    ],
    "query": [],
    "body": false,
    "upload": false,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfPostChatServersSidSounds",
    "blockType": "command",
    "text": "create / send Nookara servers [SID] sounds options JSON [OPTIONS] file data URI [FILE] filename [FILENAME]",
    "arguments": {
      "SID": {
        "type": "string",
        "defaultValue": ""
      },
      "OPTIONS": {
        "type": "string",
        "defaultValue": "{}"
      },
      "FILE": {
        "type": "string",
        "defaultValue": ""
      },
      "FILENAME": {
        "type": "string",
        "defaultValue": "file.png"
      }
    },
    "method": "POST",
    "path": "/chat/servers/:sid/sounds",
    "params": [
      "sid"
    ],
    "query": [],
    "body": true,
    "upload": true,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfPatchChatServersSidSoundsId",
    "blockType": "command",
    "text": "update Nookara servers [SID] sounds [ID] options JSON [OPTIONS]",
    "arguments": {
      "SID": {
        "type": "string",
        "defaultValue": ""
      },
      "ID": {
        "type": "string",
        "defaultValue": ""
      },
      "OPTIONS": {
        "type": "string",
        "defaultValue": "{}"
      }
    },
    "method": "PATCH",
    "path": "/chat/servers/:sid/sounds/:id",
    "params": [
      "sid",
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
    "opcode": "bfDeleteChatServersSidSoundsId",
    "blockType": "command",
    "text": "remove Nookara servers [SID] sounds [ID]",
    "arguments": {
      "SID": {
        "type": "string",
        "defaultValue": ""
      },
      "ID": {
        "type": "string",
        "defaultValue": ""
      }
    },
    "method": "DELETE",
    "path": "/chat/servers/:sid/sounds/:id",
    "params": [
      "sid",
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
    "opcode": "bfPutChatMessagesIdPin",
    "blockType": "command",
    "text": "set Nookara messages [ID] pin options JSON [OPTIONS]",
    "arguments": {
      "ID": {
        "type": "string",
        "defaultValue": ""
      },
      "OPTIONS": {
        "type": "string",
        "defaultValue": "{}"
      }
    },
    "method": "PUT",
    "path": "/chat/messages/:id/pin",
    "params": [
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
    "opcode": "bfDeleteChatMessagesIdPin",
    "blockType": "command",
    "text": "remove Nookara messages [ID] pin",
    "arguments": {
      "ID": {
        "type": "string",
        "defaultValue": ""
      }
    },
    "method": "DELETE",
    "path": "/chat/messages/:id/pin",
    "params": [
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
    "opcode": "bfGetChatChannelsCidPins",
    "blockType": "reporter",
    "text": "pinned posts for channel [CID]",
    "arguments": {
      "CID": {
        "type": "string",
        "defaultValue": ""
      }
    },
    "method": "GET",
    "path": "/chat/channels/:cid/pins",
    "params": [
      "cid"
    ],
    "query": [],
    "body": false,
    "upload": false,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfGetChatChannelsCidViewers",
    "blockType": "reporter",
    "text": "viewers for channel [CID]",
    "arguments": {
      "CID": {
        "type": "string",
        "defaultValue": ""
      }
    },
    "method": "GET",
    "path": "/chat/channels/:cid/viewers",
    "params": [
      "cid"
    ],
    "query": [],
    "body": false,
    "upload": false,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfGetChatPersonalEmojis",
    "blockType": "reporter",
    "text": "my personal emojis as JSON",
    "arguments": {},
    "method": "GET",
    "path": "/chat/personal-emojis",
    "params": [],
    "query": [],
    "body": false,
    "upload": false,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfPostChatPersonalEmojis",
    "blockType": "command",
    "text": "add personal emoji options JSON [OPTIONS] file data URI [FILE] filename [FILENAME]",
    "arguments": {
      "OPTIONS": {
        "type": "string",
        "defaultValue": "{\"name\":\"myemoji\"}"
      },
      "FILE": {
        "type": "string",
        "defaultValue": ""
      },
      "FILENAME": {
        "type": "string",
        "defaultValue": "emoji.png"
      }
    },
    "method": "POST",
    "path": "/chat/personal-emojis",
    "params": [],
    "query": [],
    "body": true,
    "upload": true,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfPatchChatPersonalEmojisEid",
    "blockType": "command",
    "text": "rename personal emoji [EID] options JSON [OPTIONS]",
    "arguments": {
      "EID": {
        "type": "string",
        "defaultValue": ""
      },
      "OPTIONS": {
        "type": "string",
        "defaultValue": "{\"name\":\"newname\"}"
      }
    },
    "method": "PATCH",
    "path": "/chat/personal-emojis/:eid",
    "params": [
      "eid"
    ],
    "query": [],
    "body": true,
    "upload": false,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfDeleteChatPersonalEmojisEid",
    "blockType": "command",
    "text": "delete personal emoji [EID]",
    "arguments": {
      "EID": {
        "type": "string",
        "defaultValue": ""
      }
    },
    "method": "DELETE",
    "path": "/chat/personal-emojis/:eid",
    "params": [
      "eid"
    ],
    "query": [],
    "body": false,
    "upload": false,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfGetChatUnfurl",
    "blockType": "reporter",
    "text": "link preview data with options [QUERY]",
    "arguments": {
      "QUERY": {
        "type": "string",
        "defaultValue": "{}"
      }
    },
    "method": "GET",
    "path": "/chat/unfurl",
    "params": [],
    "query": [
      "url"
    ],
    "body": false,
    "upload": false,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfGetChatChannelsCidShop",
    "blockType": "reporter",
    "text": "shop catalogue for channel [CID]",
    "arguments": {
      "CID": {
        "type": "string",
        "defaultValue": ""
      }
    },
    "method": "GET",
    "path": "/chat/channels/:cid/shop",
    "params": [
      "cid"
    ],
    "query": [],
    "body": false,
    "upload": false,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfPostChatChannelsCidShopRid",
    "blockType": "command",
    "text": "create / send Nookara channels [CID] shop [RID] options JSON [OPTIONS]",
    "arguments": {
      "CID": {
        "type": "string",
        "defaultValue": ""
      },
      "RID": {
        "type": "string",
        "defaultValue": ""
      },
      "OPTIONS": {
        "type": "string",
        "defaultValue": "{}"
      }
    },
    "method": "POST",
    "path": "/chat/channels/:cid/shop/:rid",
    "params": [
      "cid",
      "rid"
    ],
    "query": [],
    "body": true,
    "upload": false,
    "scopes": [
      2048,
      1024
    ]
  },
  {
    "opcode": "bfDeleteChatChannelsCidShopRid",
    "blockType": "command",
    "text": "remove Nookara channels [CID] shop [RID]",
    "arguments": {
      "CID": {
        "type": "string",
        "defaultValue": ""
      },
      "RID": {
        "type": "string",
        "defaultValue": ""
      }
    },
    "method": "DELETE",
    "path": "/chat/channels/:cid/shop/:rid",
    "params": [
      "cid",
      "rid"
    ],
    "query": [],
    "body": false,
    "upload": false,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfGetChatChannelsCidWebhooks",
    "blockType": "reporter",
    "text": "webhook configuration for channel [CID]",
    "arguments": {
      "CID": {
        "type": "string",
        "defaultValue": ""
      }
    },
    "method": "GET",
    "path": "/chat/channels/:cid/webhooks",
    "params": [
      "cid"
    ],
    "query": [],
    "body": false,
    "upload": false,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfPostChatChannelsCidWebhooks",
    "blockType": "command",
    "text": "create / send Nookara channels [CID] webhooks options JSON [OPTIONS]",
    "arguments": {
      "CID": {
        "type": "string",
        "defaultValue": ""
      },
      "OPTIONS": {
        "type": "string",
        "defaultValue": "{}"
      }
    },
    "method": "POST",
    "path": "/chat/channels/:cid/webhooks",
    "params": [
      "cid"
    ],
    "query": [],
    "body": true,
    "upload": false,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfPatchChatHooksWid",
    "blockType": "command",
    "text": "update Nookara hooks [WID] options JSON [OPTIONS]",
    "arguments": {
      "WID": {
        "type": "string",
        "defaultValue": ""
      },
      "OPTIONS": {
        "type": "string",
        "defaultValue": "{}"
      }
    },
    "method": "PATCH",
    "path": "/chat/hooks/:wid",
    "params": [
      "wid"
    ],
    "query": [],
    "body": true,
    "upload": false,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfDeleteChatHooksWid",
    "blockType": "command",
    "text": "remove Nookara hooks [WID]",
    "arguments": {
      "WID": {
        "type": "string",
        "defaultValue": ""
      }
    },
    "method": "DELETE",
    "path": "/chat/hooks/:wid",
    "params": [
      "wid"
    ],
    "query": [],
    "body": false,
    "upload": false,
    "scopes": [
      2048
    ]
  },
  {
    "opcode": "bfPostChatHooksWidAvatar",
    "blockType": "command",
    "text": "create / send Nookara hooks [WID] avatar options JSON [OPTIONS] file data URI [FILE] filename [FILENAME]",
    "arguments": {
      "WID": {
        "type": "string",
        "defaultValue": ""
      },
      "OPTIONS": {
        "type": "string",
        "defaultValue": "{}"
      },
      "FILE": {
        "type": "string",
        "defaultValue": ""
      },
      "FILENAME": {
        "type": "string",
        "defaultValue": "file.png"
      }
    },
    "method": "POST",
    "path": "/chat/hooks/:wid/avatar",
    "params": [
      "wid"
    ],
    "query": [],
    "body": true,
    "upload": true,
    "scopes": [
      2048
    ]
  },
  ];
  const VELORA_PERMS = { SEND: 1, MANAGE_CHANNELS: 2, MANAGE_SERVER: 4, MANAGE_ROLES: 8, KICK: 16, BAN: 32, MANAGE_MESSAGES: 64, MENTION_EVERYONE: 128, ATTACH: 256, ADMIN: 512, VIEW: 1024 };
  const bfString = value => Scratch.Cast.toString(value);
  Object.assign(NookaraExtension.prototype, {
    async _chatChannel(chRef, srvRef) {
      const d = await this._chatServer(srvRef);
      const c = await this._instanceChannel(d.instance, chRef);
      return { d, c };
    },
    async chatChannels({ SERVER }) {
      if (!this._authenticated) throw new Error('Not logged in');
      const d = await this._chatServer(SERVER);
      return JSON.stringify(d.channels);
    },
    async chatOnlineMembers({ SERVER }) {
      const all = await this.chatMembers({ SERVER });
      if (all === 'Not logged in') return all;
      return JSON.stringify(JSON.parse(all).filter(m => m.presence && m.presence.status !== 'offline'));
    },
    async chatIsMember({ SERVER }) {
      if (!this._authenticated) return false;
      if (!this._chatServers) await this.chatMyServers().catch(() => null);
      const k = Scratch.Cast.toString(SERVER).trim().toLowerCase();
      return !!(this._chatServers || []).some(s => s.sid.toLowerCase() === k || s.name.toLowerCase() === k);
    },
    async chatChannelLocked({ CHANNEL, SERVER }) {
      if (!this._authenticated) return false;
      const { c } = await this._chatChannel(CHANNEL, SERVER).catch(() => ({ c: null }));
      return !!c?.locked;
    },
    async chatCanPost({ CHANNEL, SERVER }) {
      if (!this._authenticated) return false;
      const { c } = await this._chatChannel(CHANNEL, SERVER).catch(() => ({ c: null }));
      return !!c?.can_post;
    },
    // hats: needs to know the channel's ID, which is looked up (and then remembered) the first time
    whenChatMessage({ CHANNEL, SERVER }) {
      const key = `${Scratch.Cast.toString(SERVER).trim().toLowerCase()}/${Scratch.Cast.toString(CHANNEL).trim().replace(/^#/, '').toLowerCase()}`;
      this._chatHatIds = this._chatHatIds || {};
      const cid = this._chatHatIds[key];
      if (cid === undefined) {
        this._chatHatIds[key] = null;
        if (this._authenticated) this._chatChannel(CHANNEL, SERVER).then(({ c }) => { this._chatHatIds[key] = c.cid; }).catch(() => { delete this._chatHatIds[key]; });
        return false;
      }
      if (!cid || !this._chatEvt[cid]) return false;
      this._chatEvt[cid] = false;
      return true;
    },
    whenAnyChatMessage() { const v = !!this._chatEvt['*']; this._chatEvt['*'] = false; return v; },
    chatLastMessage({ PROP }) {
      const m = this._lastChatMsg;
      if (!m) return '';
      if (PROP === 'JSON') return JSON.stringify(m);
      if (PROP === 'author') return m.author ? m.author.username : 'Nookara';
      if (PROP === 'channel') return m.channel;
      if (PROP === 'server') return m.server;
      if (PROP === 'id') return m.id;
      return m.body;
    },
    async chatTypingUsers({ CHANNEL, SERVER }) {
      const { c } = await this._chatChannel(CHANNEL, SERVER).catch(() => ({ c: null }));
      const now = Date.now();
      return JSON.stringify(c ? Object.keys(this._chatTyping[c.cid] || {}).filter(u => this._chatTyping[c.cid][u] > now) : []);
    },
    _bfInit() {
      if (this._bfEvents) return;
      this._bfEvents = new Map();
      this._chatServers = null;
      this._chatDetail = Object.create(null);
      this._chatMsgs = Object.create(null);
      this._chatEvt = Object.create(null);
      this._chatTyping = Object.create(null);
      this._chatHatIds = Object.create(null);
      this._presence = Object.create(null);
      this._presenceEvt = Object.create(null);
    },
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
    bfWhenEvent({ EVENT }) { this._bfInit(); const key = bfString(EVENT); const value = this._bfEvents.get(key); this._bfEvents.delete(key); return !!value; },
    bfEventJson() { return JSON.stringify(this._bfLastEvent || {}); },
    bfEventField({ FIELD }) { const value = this._bfLastEvent?.[bfString(FIELD)]; return value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : value; },
    bfPermissionBit({ PERMISSION }) { return VELORA_PERMS[bfString(PERMISSION)] || 0; },
    async bfServerPermissions({ SERVER }) { return Number((await this._chatServer(SERVER)).server.perms) || 0; },
    async bfChannelPermissions({ CHANNEL, SERVER }) {
      const { c, d } = await this._chatChannel(CHANNEL, SERVER);
      const base = Number(d.server.perms) || 0;
      if (base === 1023) return 2047;
      let bits = base | 1024;
      const members = JSON.parse(await this.chatMembers({ SERVER }));
      const me = members.find(m => m.username.toLowerCase() === (this._username || this._accountObj.username || '').toLowerCase());
      const everyone = d.roles.find(r => r.is_default);
      const overrides = c.overwrites || [];
      const common = overrides.find(o => o.rid === everyone?.rid);
      if (common) bits = (bits & ~common.deny) | common.allow;
      let allow = 0, deny = 0;
      for (const o of overrides) if ((me?.roles || []).includes(o.rid)) { allow |= o.allow; deny |= o.deny; }
      return (bits & ~deny) | allow;
    },
    async bfHasPermission(args) {
      const bit = this.bfPermissionBit(args);
      if (!bit) return false;
      if (bit === 1) return this.chatCanPost(args);
      const bits = await this.bfChannelPermissions(args);
      if (bit === 1024 && (await this.bfServerPermissions(args) & 2)) return true;
      return (bits & bit) === bit;
    },
    async bfRoles({ SERVER }) { return JSON.stringify((await this._chatServer(SERVER)).roles); },
    async bfSendReply({ MSG, ID, ATTACHMENTS, CHANNEL, SERVER }) { const { c } = await this._chatChannel(CHANNEL, SERVER); await this._bfRequest(`/chat/channels/${encodeURIComponent(c.cid)}/messages`, 'POST', { message: bfString(MSG), reply_to: bfString(ID) || null, attachments: this._bfJson(ATTACHMENTS, true) }); },
    async bfTypingState({ STATE, CHANNEL, SERVER }) { const { c } = await this._chatChannel(CHANNEL, SERVER); this._wsSend({ type: 'chat_typing', channel: c.cid, typing: bfString(STATE) === 'on' }); },
    bfPlaySound({ SOUND }) { this._requireScope(SCOPES.VOICE); if (!this._rtc?.room) throw new Error('Join a Nookara voice channel first.'); this._wsSend({ type: 'voice_sound', sound: bfString(SOUND), room: this._rtc.room }); },
    _gameKey(CHANNEL, SERVER) { return `${bfString(SERVER).trim().toLowerCase()}/${bfString(CHANNEL).trim().replace(/^#/, '').toLowerCase()}`; },
    async _gameChannel(CHANNEL, SERVER) {
      this._requireScope(SCOPES.CHAT);
      const { c } = await this._chatChannel(CHANNEL, SERVER);
      if (c.type !== 'game') throw new Error('Choose a game server channel.');
      return c;
    },
    async bfGameServers({ SERVER }) {
      const d = await this._chatServer(SERVER);
      const data = await this._bfRequest(`/chat/game/servers/${encodeURIComponent(d.server.sid)}/instances`);
      return JSON.stringify(data.instances || []);
    },
    async _gameStatusOf(CHANNEL, SERVER) {
      const c = await this._gameChannel(CHANNEL, SERVER);
      const data = await this._bfRequest(`/chat/game/channels/${encodeURIComponent(c.cid)}/status`);
      return data;
    },
    async bfGameStatus({ PROP, CHANNEL, SERVER }) {
      const data = await this._gameStatusOf(CHANNEL, SERVER);
      const st = data.status || {};
      switch (bfString(PROP)) {
        case 'online': return !!data.online;
        case 'player count': return st.players ? Number(st.players.online) || 0 : 0;
        case 'max players': return st.players ? Number(st.players.max) || 0 : 0;
        case 'players (JSON)': return JSON.stringify(st.players?.list || []);
        case 'MOTD': return (Array.isArray(st.motd) ? st.motd.map(x => x.text || '').join('') : bfString(st.motd || ''));
        case 'version': return st.version || data.instance?.mc_version || '';
        case 'last seen': return data.last_seen || 0;
        default: return JSON.stringify(data);
      }
    },
    async bfGameOnline({ CHANNEL, SERVER }) { return !!(await this._gameStatusOf(CHANNEL, SERVER)).online; },
    async bfGameConsole({ CHANNEL, SERVER }) {
      const c = await this._gameChannel(CHANNEL, SERVER);
      const data = await this._bfRequest(`/chat/game/channels/${encodeURIComponent(c.cid)}/console`);
      return JSON.stringify(data.lines || []);
    },
    async bfGameCommand({ COMMAND, CHANNEL, SERVER }) {
      const c = await this._gameChannel(CHANNEL, SERVER);
      this._gameOutput = '';
      try {
        const data = await this._bfRequest(`/chat/game/channels/${encodeURIComponent(c.cid)}/console`, 'POST', { command: bfString(COMMAND) });
        this._gameOutput = Array.isArray(data.output) ? data.output.join('\n') : bfString(data.output || '');
      } catch (error) {
        if (error.message === 'console_needs_bonfire') throw new Error('Console commands only work from the Nookara website or the Bonfire app, not from a project token.');
        throw error;
      }
    },
    bfGameCommandOutput() { return this._gameOutput || ''; },
    _gameHat(kind, { CHANNEL, SERVER }) {
      this._bfInit();
      this._gameCids = this._gameCids || Object.create(null);
      this._gameEvt = this._gameEvt || Object.create(null);
      const key = this._gameKey(CHANNEL, SERVER);
      const cid = this._gameCids[key];
      if (cid === undefined) {
        this._gameCids[key] = null;
        if (this._authenticated) this._chatChannel(CHANNEL, SERVER).then(({ c }) => { this._gameCids[key] = c.cid; }).catch(() => { delete this._gameCids[key]; });
        return false;
      }
      if (!cid) return false;
      const flag = `${kind}:${cid}`;
      const value = !!this._gameEvt[flag];
      this._gameEvt[flag] = false;
      return value;
    },
    bfWhenGameStatus(args) { return this._gameHat('status', args); },
    bfWhenGameConsole(args) { return this._gameHat('console', args); },
    bfGameLastLine() {
      const l = this._gameLastLine;
      if (!l) return '';
      return l.kind === 'command' ? `> ${l.command || ''}` : bfString(l.msg ?? l.text ?? '');
    },
    bfMessageFromMinecraft() { return this._lastChatMsg?.author?.bridge === 'minecraft' || /^mc_/.test(this._lastChatMsg?.sys_kind || ''); },
    bfMessageGameServer() { return this._lastChatMsg?.author?.bridge_from || ''; },
    async _cloudlinkStatusOf(CHANNEL, SERVER) {
      this._requireScope(SCOPES.CHAT);
      const { c } = await this._chatChannel(CHANNEL, SERVER);
      if (c.type !== 'logs' || c.config?.mode !== 'cloudlink') throw new Error('Choose a CloudLink bridge channel.');
      return (await this._bfRequest(`/chat/channels/${encodeURIComponent(c.cid)}/cloudlink`)).status || {};
    },
    async bfCloudlinkStatus({ PROP, CHANNEL, SERVER }) {
      const st = await this._cloudlinkStatusOf(CHANNEL, SERVER);
      switch (bfString(PROP)) {
        case 'state': return st.state || '';
        case 'online count': return Number(st.online) || 0;
        case 'online users (JSON)': return JSON.stringify(st.users || []);
        case 'url': return st.url || '';
        case 'room': return st.room || '';
        case 'error': return st.error || '';
        default: return JSON.stringify(st);
      }
    },
    async bfCloudlinkConnected({ CHANNEL, SERVER }) { return (await this._cloudlinkStatusOf(CHANNEL, SERVER)).state === 'connected'; },
    bfMessageFromCloudlink() { return this._lastChatMsg?.author?.bridge === 'cloudlink'; },
    bfMessageGameEvent() { const k = this._lastChatMsg?.sys_kind || ''; return /^mc_/.test(k) ? k.slice(3) : ''; },
  });
  for (const spec of VELORA_ROUTES) NookaraExtension.prototype[spec.opcode] = function (args) { return this._bfRoute(spec, args); };
  const bfHandleWS = NookaraExtension.prototype._handleWS;
  NookaraExtension.prototype._handleWS = function (msg) {
    this._bfInit();
    if (msg.type === 'auth_success') { this._bfEvents = null; this._bfInit(); this._lastChatMsg = null; this._bfLastEvent = null; }
    if (msg.type === 'game_status' || msg.type === 'game_console') {
      this._gameEvt = this._gameEvt || Object.create(null);
      this._gameEvt[`${msg.type === 'game_status' ? 'status' : 'console'}:${msg.channel}`] = true;
      if (msg.type === 'game_console' && Array.isArray(msg.lines) && msg.lines.length) this._gameLastLine = msg.lines[msg.lines.length - 1];
    }
    if (/^(chat_|presence_|im_|dm_|group_|room_|modmail|voice_sound|game_)/.test(msg.type) || msg.type === 'roomMessage') {
      this._bfLastEvent = msg;
      this._bfEvents.set(msg.type, true); this._bfEvents.set('any', true);
    }
    if (['chat_roles_update', 'chat_perms_changed', 'chat_member_update', 'chat_members_stale', 'chat_channels_update', 'chat_server_update', 'chat_server_removed'].includes(msg.type)) { this._chatDetail = Object.create(null); this._chatServers = null; this._chatHatIds = Object.create(null); }
    switch (msg.type) {
      case 'chat_message': {
        const m = msg.message;
        if (!m?.channel) return;
        const list = this._chatMsgs[m.channel] || (this._chatMsgs[m.channel] = []);
        if (!list.some(x => Scratch.Cast.toString(x.id) === Scratch.Cast.toString(m.id))) list.push(m);
        if (list.length > 100) list.shift();
        this._lastChatMsg = m; this._chatEvt[m.channel] = true; this._chatEvt['*'] = true;
        if (m.author && this._chatTyping[m.channel]) delete this._chatTyping[m.channel][m.author.username];
        return;
      }
      case 'chat_message_update': { const m = msg.message; const list = this._chatMsgs[m?.channel]; const i = list?.findIndex(x => Scratch.Cast.toString(x.id) === Scratch.Cast.toString(m.id)); if (i >= 0) list[i] = m; return; }
      case 'chat_message_delete': { const list = this._chatMsgs[msg.channel]; if (list) this._chatMsgs[msg.channel] = list.filter(m => Scratch.Cast.toString(m.id) !== Scratch.Cast.toString(msg.id)); return; }
      case 'chat_reactions': { const m = this._chatMsgs[msg.channel]?.find(m => Scratch.Cast.toString(m.id) === Scratch.Cast.toString(msg.id)); if (m) m.reactions = msg.reactions; return; }
      case 'chat_typing': { const users = this._chatTyping[msg.channel] || (this._chatTyping[msg.channel] = Object.create(null)); if (msg.typing === false) delete users[msg.username]; else users[msg.username] = Date.now() + 7000; return; }
      case 'presence_update': { const key = bfString(msg.username).toLowerCase(); this._presence[key] = msg.presence; if (!msg.request) { this._presenceEvt[key] = true; this._presenceEvt['*'] = true; this._lastPresenceUser = msg.username; } return; }
    }
    bfHandleWS.call(this, msg);
    // Community chat is subscribed only on explicitly connected instance gateways.
  };
  // use the checked HTTP contract for the convenient name-based blocks too
  NookaraExtension.prototype._chatServer = async function (ref) {
    this._bfInit();
    return this._bfRequest(`/chat/servers/${encodeURIComponent(bfString(ref).trim())}`);
  };
  NookaraExtension.prototype.chatSend = async function ({ MSG, CHANNEL, SERVER }) { const { c } = await this._chatChannel(CHANNEL, SERVER); await this._bfRequest(`/chat/channels/${encodeURIComponent(c.cid)}/messages`, 'POST', { message: bfString(MSG) }); };
  NookaraExtension.prototype.chatMessages = async function ({ CHANNEL, SERVER }) { const { c } = await this._chatChannel(CHANNEL, SERVER); const d = await this._bfRequest(`/chat/channels/${encodeURIComponent(c.cid)}/messages?limit=100`); this._chatMsgs[c.cid] = d.messages; return JSON.stringify(d.messages); };
  NookaraExtension.prototype.chatMembers = async function ({ SERVER }) { const d = await this._bfRequest(`/chat/servers/${encodeURIComponent(bfString(SERVER).trim())}/members`); for (const m of d.members) this._presence[m.username.toLowerCase()] = m.presence; return JSON.stringify(d.members); };
  NookaraExtension.prototype.chatMyServers = async function () { const d = await this._bfRequest('/chat/servers'); this._chatServers = d.servers; return JSON.stringify(d.servers); };
  NookaraExtension.prototype.chatJoinServer = async function ({ SERVER }) {
    const ref = bfString(SERVER).trim().replace(/\/$/, '').split('/').pop();
    try { await this._bfRequest(`/chat/servers/${encodeURIComponent(ref)}/join`, 'POST', {}); }
    catch (error) { if (error.message !== 'server_not_found') throw error; await this._bfRequest(`/chat/join/${encodeURIComponent(ref)}`, 'POST', {}); }
  };
  NookaraExtension.prototype.chatLeaveServer = async function ({ SERVER }) { const d = await this._chatServer(SERVER); await this._bfRequest(`/chat/servers/${encodeURIComponent(d.server.sid)}/leave`, 'POST', {}); };
  NookaraExtension.prototype.chatTyping = async function (args) { return this.bfTypingState({ ...args, STATE: 'on' }); };
  const bfReadyTyping = NookaraExtension.prototype.bfTypingState;
  NookaraExtension.prototype.bfTypingState = async function (args) { await this._bfEnsureSocket(); return bfReadyTyping.call(this, args); };
  const instanceBlockUrl = 'https://chat.ikelene.net';
  const U = instanceBlockUrl;
  // [opcode, type, text, { ARG: default | [default, menu] }]. A plain string entry is a section label.
  const instanceBlocks = [
    'Bonfire servers: connect',
    ['biConnect', 'COMMAND', 'connect to Bonfire server [URL]', { URL: U }],
    ['biConnectLocal', 'COMMAND', 'connect to Bonfire server [URL] as [USERNAME] password [PASSWORD]', { URL: U, USERNAME: '', PASSWORD: '' }],
    ['biRegister', 'COMMAND', 'register on Bonfire server [URL] as [USERNAME] password [PASSWORD]', { URL: U, USERNAME: '', PASSWORD: '' }],
    ['biDisconnect', 'COMMAND', 'disconnect from [URL]', { URL: U }],
    ['biConnected', 'BOOLEAN', 'connected to [URL]?', { URL: U }],
    ['biMyInstances', 'REPORTER', 'my Bonfire server list (from Nookara) as JSON', {}],
    ['biSaveInstance', 'COMMAND', 'add [URL] to my Bonfire server list', { URL: U }],
    ['biForgetInstance', 'COMMAND', 'remove [URL] from my Bonfire server list', { URL: U }],
    ['biConnectedList', 'REPORTER', 'connected Bonfire servers as JSON', {}],
    ['biHostedServers', 'REPORTER', 'my hosted Bonfire servers as JSON', {}],
    ['biDirectory', 'REPORTER', 'search public Bonfire servers [QUERY] page [PAGE] as JSON', { QUERY: '', PAGE: '1' }],

    'Bonfire servers: info',
    ['biAbout', 'REPORTER', '[PROP] of Bonfire server [URL]', { PROP: ['name', 'biInstanceProps'], URL: U }],
    ['biHasFeature', 'BOOLEAN', 'Bonfire server [URL] supports [FEATURE]?', { URL: U, FEATURE: ['voice', 'biFeatures'] }],
    ['biServerName', 'REPORTER', 'server name of [URL]', { URL: U }],
    ['biMyId', 'REPORTER', 'my id on [URL]', { URL: U }],
    ['biVoiceInfo', 'REPORTER', 'voice channel info for [CHANNEL] on [URL] as JSON', { CHANNEL: 'Voice', URL: U }],

    'Bonfire communities',
    ['biCommunity', 'REPORTER', 'community details of [URL] as JSON', { URL: U }],
    ['biJoin', 'COMMAND', 'join the community on [URL]', { URL: U }],
    ['biPending', 'BOOLEAN', 'join request pending on [URL]?', { URL: U }],
    ['biLeave', 'COMMAND', 'leave the community on [URL]', { URL: U }],
    ['biMembers', 'REPORTER', 'members of [URL] as JSON', { URL: U }],
    ['biRoles', 'REPORTER', 'roles of [URL] as JSON', { URL: U }],
    ['biPermissions', 'REPORTER', 'my permission mask on [URL]', { URL: U }],
    ['biHasPermission', 'BOOLEAN', 'I have permission [PERMISSION] in channel [CHANNEL] on [URL]?', { PERMISSION: ['SEND', 'bfPermissions'], CHANNEL: 'general', URL: U }],
    ['biSetRole', 'COMMAND', '[ACTION] role [ROLE] for member [USER] on [URL]', { ACTION: ['add', 'biRoleActions'], ROLE: '', USER: '', URL: U }],
    ['biKick', 'COMMAND', 'kick member [USER] from [URL]', { USER: '', URL: U }],
    ['biBan', 'COMMAND', 'ban member [USER] from [URL]', { USER: '', URL: U }],
    ['biUnban', 'COMMAND', 'unban [USER] on [URL]', { USER: '', URL: U }],
    ['biJoinRequests', 'REPORTER', 'pending join requests on [URL] as JSON', { URL: U }],
    ['biAcceptRequest', 'COMMAND', 'accept join request from [USER] on [URL]', { USER: '', URL: U }],
    ['biDenyRequest', 'COMMAND', 'deny join request from [USER] on [URL]', { USER: '', URL: U }],

    'Bonfire invites',
    ['biCreateInvite', 'REPORTER', 'create invite on [URL] expires in [SECONDS] seconds (0 = never) max uses [USES] (0 = unlimited)', { URL: U, SECONDS: '0', USES: '0' }],
    ['biInviteLink', 'REPORTER', 'invite link for code [CODE] on [URL]', { CODE: '', URL: U }],
    ['biInviteInfo', 'REPORTER', 'invite [CODE] details on [URL] as JSON', { CODE: '', URL: U }],
    ['biJoinInvite', 'COMMAND', 'join with invite [CODE] on [URL]', { CODE: '', URL: U }],
    ['biInvites', 'REPORTER', 'invites of [URL] as JSON', { URL: U }],
    ['biDeleteInvite', 'COMMAND', 'delete invite [CODE] on [URL]', { CODE: '', URL: U }],

    'Bonfire channels',
    ['biChannels', 'REPORTER', 'channels of [URL] as JSON', { URL: U }],
    ['biChannelId', 'REPORTER', 'channel id named [NAME] on [URL]', { NAME: 'general', URL: U }],
    ['biChannelProp', 'REPORTER', '[PROP] of channel [CHANNEL] on [URL]', { PROP: ['topic', 'biChannelProps'], CHANNEL: 'general', URL: U }],
    ['biCreateChannel', 'COMMAND', 'create [TYPE] channel [NAME] on [URL]', { TYPE: ['text', 'biChannelTypes'], NAME: 'new-channel', URL: U }],
    ['biRenameChannel', 'COMMAND', 'rename channel [CHANNEL] to [NAME] on [URL]', { CHANNEL: 'general', NAME: 'chat', URL: U }],
    ['biDeleteChannel', 'COMMAND', 'delete channel [CHANNEL] on [URL]', { CHANNEL: 'old-channel', URL: U }],

    'Bonfire messages',
    ['biSend', 'COMMAND', 'send [TEXT] to channel [CHANNEL] on [URL]', { TEXT: 'Hello!', CHANNEL: 'general', URL: U }],
    ['biReply', 'COMMAND', 'reply [TEXT] to message [ID] in channel [CHANNEL] on [URL]', { TEXT: 'Hello!', ID: '', CHANNEL: 'general', URL: U }],
    ['biEdit', 'COMMAND', 'edit message [ID] to [TEXT] in channel [CHANNEL] on [URL]', { ID: '', TEXT: 'Edited', CHANNEL: 'general', URL: U }],
    ['biSendAlias', 'COMMAND', 'send [TEXT] as bot [TOKEN] to channel id [CHANNEL] on [URL] with alias [NAME] and avatar [AVATAR]', { TEXT: 'Hello!', TOKEN: '', CHANNEL: '', URL: U, NAME: 'Narrator', AVATAR: '' }],
    ['biEditAlias', 'COMMAND', 'set alias of message [ID] in channel id [CHANNEL] as bot [TOKEN] on [URL] to [NAME] and avatar [AVATAR] (blank name clears it)', { ID: '', CHANNEL: '', TOKEN: '', URL: U, NAME: '', AVATAR: '' }],
    ['biDelete', 'COMMAND', 'delete message [ID] on [URL]', { ID: '', URL: U }],
    ['biReact', 'COMMAND', 'react [EMOJI] to message [ID] on [URL]', { EMOJI: 'like', ID: '', URL: U }],
    ['biUnreact', 'COMMAND', 'remove my reaction [EMOJI] from message [ID] on [URL]', { EMOJI: 'like', ID: '', URL: U }],
    ['biPin', 'COMMAND', 'pin message [ID] on [URL]', { ID: '', URL: U }],
    ['biUnpin', 'COMMAND', 'unpin message [ID] on [URL]', { ID: '', URL: U }],
    ['biPins', 'REPORTER', 'pinned messages in channel [CHANNEL] on [URL] as JSON', { CHANNEL: 'general', URL: U }],
    ['biMessages', 'REPORTER', 'messages in channel [CHANNEL] on [URL] as JSON', { CHANNEL: 'general', URL: U }],
    ['biHistory', 'REPORTER', 'messages in channel [CHANNEL] on [URL] filters JSON [QUERY]', { CHANNEL: 'general', URL: U, QUERY: '{"limit":50}' }],
    ['biMessage', 'REPORTER', 'message [ID] in channel [CHANNEL] on [URL] as JSON', { ID: '', CHANNEL: 'general', URL: U }],
    ['biSearch', 'REPORTER', 'search [QUERY] in channel [CHANNEL] on [URL] as JSON', { QUERY: '', CHANNEL: 'general', URL: U }],
    ['biSearchAll', 'REPORTER', 'search [QUERY] in the whole community on [URL] as JSON', { QUERY: '', URL: U }],
    ['biMarkRead', 'COMMAND', 'mark channel [CHANNEL] as read on [URL] (up to message [ID], blank = latest)', { CHANNEL: 'general', ID: '', URL: U }],
    ['biTyping', 'COMMAND', 'show me typing in channel [CHANNEL] on [URL]', { CHANNEL: 'general', URL: U }],
    ['biTypingUsers', 'REPORTER', 'who is typing in channel [CHANNEL] on [URL] as JSON', { CHANNEL: 'general', URL: U }],
    ['biWhenMessage', 'HAT', 'when a message is sent in [CHANNEL] on [URL]', { CHANNEL: 'general', URL: U }],
    ['biWhenEvent', 'HAT', 'when [EVENT] happens on [URL]', { EVENT: ['chat_reactions', 'biEvents'], URL: U }],
    ['biEventJson', 'REPORTER', 'latest event on [URL] as JSON', { URL: U }],
    ['biLastText', 'REPORTER', 'last message text on [URL]', { URL: U }],
    ['biLastAuthor', 'REPORTER', 'last message author on [URL]', { URL: U }],
    ['biLastAlias', 'REPORTER', 'alias name of last message on [URL] (blank when none)', { URL: U }],
    ['biLastId', 'REPORTER', 'last message id on [URL]', { URL: U }],
    ['biLastChannel', 'REPORTER', 'last message channel on [URL]', { URL: U }],
    ['biLastProp', 'REPORTER', '[PROP] of the latest message on [URL]', { PROP: ['author name', 'biLastProps'], URL: U }],

    'Bonfire media',
    ['biUpload', 'REPORTER', 'upload file [FILE] named [FILENAME] for channel [CHANNEL] on [URL] as attachment JSON', { FILE: '', FILENAME: 'file.png', CHANNEL: 'general', URL: U }],
    ['biImportMedia', 'REPORTER', 'import media from [MEDIA_URL] for channel [CHANNEL] on [URL] as attachment JSON', { MEDIA_URL: 'https://', CHANNEL: 'general', URL: U }],
    ['biSendAttachments', 'COMMAND', 'send [TEXT] with attachments JSON [ATTACHMENTS] to channel [CHANNEL] on [URL]', { TEXT: '', ATTACHMENTS: '[]', CHANNEL: 'general', URL: U }],
    ['biSendFile', 'COMMAND', 'send [TEXT] with file [FILE] named [FILENAME] to channel [CHANNEL] on [URL]', { TEXT: '', FILE: '', FILENAME: 'file.png', CHANNEL: 'general', URL: U }],

    'Bonfire stickers',
    ['biStickers', 'REPORTER', 'stickers of [URL] as JSON', { URL: U }],
    ['biSendSticker', 'COMMAND', 'send sticker [STICKER] to channel [CHANNEL] on [URL]', { STICKER: '', CHANNEL: 'general', URL: U }],
    ['biAddSticker', 'REPORTER', 'add sticker named [NAME] from file [FILE] filename [FILENAME] on [URL] as JSON', { NAME: 'sticker', FILE: '', FILENAME: 'sticker.png', URL: U }],
    ['biRenameSticker', 'COMMAND', 'rename sticker [STICKER] to [NAME] on [URL]', { STICKER: '', NAME: 'sticker', URL: U }],
    ['biDeleteSticker', 'COMMAND', 'delete sticker [STICKER] on [URL]', { STICKER: '', URL: U }],
    ['biMessageSticker', 'REPORTER', 'sticker of message [ID] in channel [CHANNEL] on [URL] as JSON', { ID: '', CHANNEL: 'general', URL: U }],

    'Bonfire bots',
    ['biBots', 'REPORTER', 'bots on [URL] as JSON', { URL: U }],
    ['biCreateBot', 'REPORTER', 'create bot [NAME] description [DESCRIPTION] on [URL] (shows the token once) as JSON', { NAME: 'MyBot', DESCRIPTION: '', URL: U }],
    ['biRemoveBot', 'COMMAND', 'remove bot [BOT] from [URL]', { BOT: '', URL: U }],
    ['biAddGalleryBot', 'COMMAND', 'add gallery bot [BOT] to the community on [URL]', { BOT: '', URL: U }],

    'Bonfire bot DMs (Nookara)',
    ['biOpenBotDm', 'COMMAND', 'open DM with user [ID] as bot [TOKEN]', { ID: '', TOKEN: '' }],
    ['biSendBotDm', 'COMMAND', 'send DM [TEXT] to user [ID] as bot [TOKEN]', { TEXT: 'Hello!', ID: '', TOKEN: '' }],
    ['biSendBotDmChannel', 'COMMAND', 'send DM [TEXT] in DM channel [CHANNEL] as bot [TOKEN]', { TEXT: 'Hello!', CHANNEL: '', TOKEN: '' }],
    ['biBotDmChannelFor', 'REPORTER', 'DM channel id of user id [ID]', { ID: '' }],
    ['biBotDmConnect', 'COMMAND', 'connect bot [TOKEN] to receive DMs', { TOKEN: '' }],
    ['biBotDmDisconnect', 'COMMAND', 'stop receiving DMs as bot', {}],
    ['biBotDmConnected', 'BOOLEAN', 'bot receiving DMs?', {}],
    ['biWhenBotDm', 'HAT', 'when bot gets a DM', {}],
    ['biBotDmText', 'REPORTER', 'text of last DM to the bot', {}],
    ['biBotDmAuthor', 'REPORTER', 'author name of last DM to the bot', {}],
    ['biBotDmAuthorId', 'REPORTER', 'author id of last DM to the bot', {}],
    ['biBotDmChannel', 'REPORTER', 'DM channel id of last DM to the bot', {}],
    ['biBotDmJson', 'REPORTER', 'last DM to the bot as JSON', {}],
    ['biBotDmError', 'REPORTER', 'last bot DM error', {}],

    'Bonfire advanced',
    ['biApi', 'REPORTER', 'call [METHOD] [PATH] on [URL] options JSON [OPTIONS]', { METHOD: ['GET', 'biMethods'], PATH: '/servers', URL: U, OPTIONS: '{}' }],
    ['biWebhook', 'COMMAND', 'send [TEXT] as webhook [WEBHOOK_URL]', { TEXT: 'Hello!', WEBHOOK_URL: 'https://chat.ikelene.net/api/v1/webhooks/ID/TOKEN' }],
  ];
  const instanceCanonical = value => {
    if (value === null || value === undefined) return 'null';
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new Error('Invalid signing number.');
      return Scratch.Cast.toString(Math.trunc(value));
    }
    if (Array.isArray(value)) return '[' + value.map(instanceCanonical).join(',') + ']';
    if (typeof value !== 'object') return JSON.stringify(value);
    return '{' + Object.keys(value).filter(key => value[key] !== undefined).sort().map(key => JSON.stringify(key) + ':' + instanceCanonical(value[key])).join(',') + '}';
  };
  const instanceB64 = bytes => btoa(Array.from(new Uint8Array(bytes), byte => String.fromCharCode(byte)).join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const instanceBytes = value => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0));
  const instanceId = value => {
    const id = bfString(value).trim();
    if (!/^\d{1,15}$/.test(id)) throw new Error('Invalid message id.');
    return id;
  };
  const instanceBody = value => bfString(value).replace(/\r\n/g, '\n').slice(0, 4000);
  // what a signed attachment is bound to: the upload's sha256, or the stored URL for hash-less link GIFs (PROTOCOL §8)
  const instanceAttachHash = item => item && item.sha256 ? bfString(item.sha256) : 'url:' + bfString(item && item.url).slice(0, 512);
  // uploads answer { url, name, size, mime, type, sha256, width?, height? }; a message attachment is { url, type, name, size, width?, height?, sha256 }
  const instanceAttachment = item => {
    if (!item || typeof item !== 'object' || !item.url) throw new Error('Attachments need a url (use the upload block to make one).');
    const out = { url: bfString(item.url), type: bfString(item.type || 'file'), name: bfString(item.name || 'file'), size: Number(item.size) || 0 };
    if (item.width) out.width = Number(item.width);
    if (item.height) out.height = Number(item.height);
    if (item.sha256) out.sha256 = bfString(item.sha256);
    return out;
  };
  const instanceAttachments = value => {
    const text = bfString(value).trim();
    if (!text) return [];
    let parsed;
    try { parsed = JSON.parse(text); } catch { throw new Error('Enter valid JSON.'); }
    const list = Array.isArray(parsed) ? parsed : [parsed];
    if (list.length > 10) throw new Error('A message can have at most 10 attachments.');
    return list.map(instanceAttachment);
  };
  const instanceNumber = (value, fallback = 0) => { const n = Number(bfString(value).trim()); return Number.isFinite(n) ? n : fallback; };
  // an invite can be pasted as a bare code or as a Nookara/Bonfire invite link (VELORA/chat#/i/<instance>/invite/<code>)
  const instanceParseInvite = (code, url) => {
    const text = bfString(code).trim();
    const link = text.match(/#\/i\/([^/]+)\/invite\/([A-Za-z0-9_-]+)/);
    if (link) {
      let origin = link[1];
      try { origin = decodeURIComponent(origin); } catch { /* keep as is */ }
      return { origin: /^https?:\/\//i.test(origin) ? origin : 'https://' + origin, code: link[2] };
    }
    return { origin: bfString(url).trim(), code: text.split('/').pop() };
  };
  Object.assign(NookaraExtension.prototype, {
    _instanceOrigin(value) {
      let url;
      try { url = new URL(bfString(value).trim()); } catch { throw new Error('Invalid Bonfire server URL.'); }
      if (url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === 'localhost'))) {
        throw new Error('Bonfire servers require HTTPS (HTTP is allowed only on localhost).');
      }
      return url.origin;
    },
    async _instanceFetch(origin, path, method = 'GET', body = null, session = null) {
      const options = { method, credentials: 'omit', redirect: 'error', headers: {}, signal: AbortSignal.timeout(15000) };
      if (session) options.headers.Authorization = `Bearer ${session}`;
      if (body !== null) { options.headers['Content-Type'] = 'application/json'; options.body = JSON.stringify(body); }
      this._lastActionSuccess = false;
      try {
        const response = await fetch(origin + path, options);
        const data = response.status === 204 ? {} : await response.json();
        if (!response.ok || data.error) {
          const error = new Error(data.error || data.message || `HTTP ${response.status}`);
          error.status = response.status;
          throw error;
        }
        this._lastActionSuccess = true;
        // auth responses contain sessions, so never expose them in operation reporters
        this._lastActionOutput = JSON.stringify(path.startsWith('/api/v1/auth/') ? { ok: true } : data);
        return data;
      } catch (error) {
        this._lastActionOutput = JSON.stringify({ error: error.message });
        throw error;
      }
    },
    _instanceState(value) {
      const state = this._instances.get(this._instanceOrigin(value));
      if (!state?.session || !state.ready) throw new Error(`not connected to ${this._instanceOrigin(value)}: use the connect block`);
      return state;
    },
    // Every operation requires a project-initiated connection; reporters never sign in.
    async _instanceEnsure(value) { return this._instanceState(value); },
    // Join commands are project-initiated, so they may connect first; otherwise a join before connecting silently fails and leaves a non-member.
    async _instanceForJoin(value) {
      const known = this._instanceLookup(value);
      if (known?.session && known.ready) return known;
      await this._connectInstance(value);
      return this._instanceState(value);
    },
    _instanceLookup(value) {
      try { return this._instances.get(this._instanceOrigin(value)) || null; } catch { return null; }
    },
    async _instanceRequest(state, path, method = 'GET', body = null) {
      if (this._instances.get(state.origin) !== state || !state.session) throw new Error('Bonfire server disconnected.');
      try { return await this._instanceFetch(state.origin, '/api/v1' + path, method, body, state.session); }
      catch (error) {
        if (error.status === 401) { this._instanceSigningKey = null; this._stopInstance(state); state.session = null; this._instanceTransition(state, 'error', error.message); }
        throw error;
      }
    },
    _stopInstance(state, cancel = true) {
      clearTimeout(state.retryTimer);
      clearTimeout(state.watchdog);
      clearInterval(state.heartbeat);
      state.ready = false;
      if (cancel && state.connectReject) { const reject = state.connectReject; state.connectReject = null; reject(new Error('Instance connection cancelled.')); }
      const socket = state.socket;
      state.socket = null;
      if (socket) { socket.onclose = null; socket.onmessage = null; socket.onopen = null; socket.onerror = null; socket.close(); }
    },
    _disposeInstances() {
      for (const state of this._instances.values()) { state.cancelled = true; this._stopInstance(state); state.session = null; this._instanceTransition(state, 'disconnected'); }
      this._instances.clear();
      this._instancePending?.clear();
      this._instanceSigningKey = null;
      this._instanceSigningToken = null;
    },
    // credentials = local-account login; opts.noJoin = connect without joining the community (invite flow);
    // opts.remember === false = don't save this URL in the project (used when connecting to the person's own server list)
    _connectInstance(value, credentials = null, opts = {}) {
      const origin = this._instanceOrigin(value);
      this._instancePending ||= new Map();
      if (!credentials) { const running = this._instancePending.get(origin); if (running) return running; }
      const run = this._connectInstanceNow(origin, credentials, opts || {});
      this._instancePending.set(origin, run);
      run.then(() => {}, () => {}).then(() => { if (this._instancePending.get(origin) === run) this._instancePending.delete(origin); });
      return run;
    },
    async _connectInstanceNow(origin, credentials, opts) {
      const previous = this._instances.get(origin);
      if (previous) this._stopInstance(previous);
      const state = { origin, session: null, channels: new Map(), messages: new Map(), attempts: 0, ready: false, last: null,
        chatEvt: Object.create(null), typing: Object.create(null), eventFlags: new Set(), lastEvent: null, detail: null, detailAt: 0 };
      this._instances.set(origin, state);
      this._instanceTransition(state, 'connecting');
      try {
        if (!credentials) this._requireScope(SCOPES.CHAT);
        state.discovery = await this._instanceFetch(origin, '/.well-known/bonfire');
        if (state.discovery.software !== 'bonfire-server' || state.discovery.protocol !== 1) throw new Error('Unsupported Bonfire server.');
        let auth;
        if (credentials) {
          auth = await this._instanceFetch(origin, credentials.register ? '/api/v1/auth/register' : '/api/v1/auth/login', 'POST', { username: credentials.username, password: credentials.password });
        } else {
          if (state.discovery.accounts_mode !== 'velora') throw new Error('This server needs a local username and password.');
          // only this Nookara-side request sees the account token
          const response = await fetch(SERVER_HTTP + '/bonfire/instance-token', {
            method: 'POST', credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(15000),
            headers: { Authorization: `Bearer ${this._token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ instance: origin }),
          });
          const data = await response.json();
          if (!response.ok || data.error) throw (this._scopeErrorFromData(data) || new Error(data.error || `HTTP ${response.status}`));
          if (!data.token || data.token === this._token || data.aud !== origin) throw new Error('Invalid instance token response.');
          auth = await this._instanceFetch(origin, '/api/v1/auth/velora', 'POST', { token: data.token });
        }
        if (this._instances.get(origin) !== state || state.cancelled) throw new Error('Bonfire connection cancelled.');
        if (!auth.session || auth.session === this._token || !auth.user) throw new Error('Invalid instance session response.');
        state.session = auth.session;
        state.user = auth.user;
        state.velora = !credentials;
        const servers = await this._instanceRequest(state, '/servers');
        state.community = state.discovery.community;
        let member = !!state.community && (servers.servers || []).some(server => server.sid === state.community.sid);
        if (state.community && !member && opts.join === true) {
          const joined = await this._instanceRequest(state, `/servers/${encodeURIComponent(state.community.sid)}/join`, 'POST', {});
          state.pending = !!joined.pending;
          member = !state.pending;
        }
        if (state.community && member && !state.pending) await this._instanceDetail(state);
        if (opts.remember !== false) this._instanceURLs.add(origin);
        await this._instanceSocket(state);
      } catch (error) {
        if (this._instances.get(origin) === state && !state.cancelled) { this._stopInstance(state); state.session = null; this._instanceTransition(state, 'error', error.message); }
        throw error;
      }
    },
    async _instanceDetail(state) {
      if (state.pending) throw new Error('Community join request is pending approval.');
      const sid = state.community?.sid;
      if (!sid) throw new Error('This Bonfire server has no community yet.');
      const detail = await this._instanceRequest(state, `/servers/${encodeURIComponent(sid)}`);
      state.community = detail.server;
      state.channels = new Map((detail.channels || []).map(channel => [channel.cid, channel]));
      state.detail = detail; state.detailAt = Date.now();
      return detail;
    },
    // short-lived cache so a script that asks several questions in a row doesn't refetch the community each time
    async _instanceDetailCached(state) {
      if (state.detail && Date.now() - state.detailAt < 3000) return state.detail;
      return this._instanceDetail(state);
    },
    async _instanceChannel(state, value) {
      const ref = bfString(value).trim();
      const name = ref.replace(/^#/, '').toLowerCase();
      if (!state.channels.size) await this._instanceDetail(state);
      const matches = [...state.channels.values()].filter(item => item.name.toLowerCase() === name);
      if (!state.channels.has(ref) && matches.length > 1) throw new Error('Ambiguous channel name: use the connect block and the channel ID.');
      const channel = state.channels.get(ref) || matches[0];
      if (!channel) throw new Error('Channel not found on the connected instance: use the connect block and the channel ID.');
      return channel;
    },
    // sync channel lookup for hats (only knows channels of an already loaded community)
    _instanceChannelSync(state, value) {
      const ref = bfString(value).trim();
      const name = ref.replace(/^#/, '').toLowerCase();
      const matches = [...state.channels.values()].filter(item => item.name.toLowerCase() === name);
      return state.channels.get(ref) || (matches.length === 1 ? matches[0] : null);
    },
    _instanceRemember(state, message) {
      state.messages.set(bfString(message.id), message);
      while (state.messages.size > 200) state.messages.delete(state.messages.keys().next().value);
    },
    _instanceSocket(state) {
      if (this._instances.get(state.origin) !== state || !state.session) return;
      let socket;
      return new Promise((resolve, reject) => {
      state.connectReject = reject;
      const fail = error => {
        if (state.socket && state.socket !== socket) return;
        state.connectReject = null;
        this._stopInstance(state, false);
        this._instanceTransition(state, 'error', error.message);
        reject(error);
      };
      try { socket = new WebSocket(state.origin.replace(/^http/, 'ws') + '/gateway'); }
      catch (error) { fail(error); return; }
      state.socket = socket;
      let pong = true;
      state.watchdog = setTimeout(() => fail(new Error('Instance gateway timed out.')), 10000);
      socket.onopen = () => { if (state.socket === socket) socket.send(JSON.stringify({ type: 'auth', session: state.session })); };
      socket.onmessage = event => {
        if (state.socket !== socket) return;
        let frame;
        try { frame = JSON.parse(event.data); } catch { return; }
        this._bfInit();
        if (frame.type === 'auth_success') socket.send(JSON.stringify({ type: 'chat_hello' }));
        if (frame.type === 'chat_ready') {
          clearTimeout(state.watchdog);
          clearInterval(state.heartbeat);
          state.ready = true; state.attempts = 0;
          state.connectReject = null;
          this._instanceTransition(state, 'connected');
          resolve();
          state.heartbeat = setInterval(() => {
            if (!pong) { socket.close(); return; }
            pong = false;
            if (socket.readyState === 1) socket.send(JSON.stringify({ type: 'ping' }));
          }, 25000);
        }
        if (frame.type === 'auth_error' || frame.type === 'error' || (frame.type === 'chat_error' && !state.ready)) { fail(new Error(frame.error || frame.message || 'Instance gateway error.')); return; }
        if (frame.type === 'pong') { pong = true; return; }
        if (this._voiceInstance19 === state && (frame.type?.startsWith('chat_rtc_') || frame.nonce && this._rtc?.pending.has(frame.nonce))) this._rtcMessage(frame, frame.type === 'chat_error');
        // every other frame becomes an event the "when [EVENT] happens" hat can see
        if (frame.type && frame.type !== 'auth_success') {
          state.eventFlags.add(frame.type); state.eventFlags.add('any'); state.lastEvent = frame;
          this._bfLastEvent = { ...frame, instance: state.origin };
          this._bfEvents.set(frame.type, true); this._bfEvents.set('any', true);
        }
        if (frame.type === 'chat_message' && frame.message) {
          const message = frame.message;
          this._instanceRemember(state, message);
          state.last = message;
          // keeps the older "when message received" / "latest channel post" blocks working for Bonfire servers
          state.chatEvt[message.channel] = true; this._chatEvt['*'] = true;
          this._lastChatMsg = { ...message, server: state.community?.sid || '', instance: state.origin };
          const typing = state.typing[message.channel];
          if (typing && message.author) delete typing[message.author.username];
          this._instanceEvent = state;
          try { for (const opcode of ['biWhenMessage', 'biWhenMessageIds', 'whenChatMessage', 'whenAnyChatMessage', 'whenGlobalMessageReceived', 'whenRoomMessageReceived']) this.runtime.startHats(EXT_ID + '_' + opcode); }
          finally { this._instanceEvent = null; }
        }
        if (frame.type === 'chat_message_update' && frame.message) this._instanceRemember(state, frame.message);
        if (frame.type === 'chat_message_delete') state.messages.delete(bfString(frame.id));
        if (frame.type === 'chat_typing' && frame.channel) {
          const users = state.typing[frame.channel] || (state.typing[frame.channel] = Object.create(null));
          const who = bfString(frame.username || frame.user_id);
          if (frame.typing === false) delete users[who]; else users[who] = Date.now() + 7000;
        }
        if (frame.type === 'game_status' || frame.type === 'game_console') {
          this._gameEvt = this._gameEvt || Object.create(null);
          this._gameEvt[`${frame.type === 'game_status' ? 'status' : 'console'}:${frame.channel}`] = true;
          if (frame.type === 'game_console' && Array.isArray(frame.lines) && frame.lines.length) this._gameLastLine = frame.lines[frame.lines.length - 1];
          this._gameEvent19 = { state, frame };
          try { this.runtime.startHats(EXT_ID + (frame.type === 'game_status' ? '_bfWhenGameStatus' : '_bfWhenGameConsole')); }
          finally { this._gameEvent19 = null; }
        }
        if (frame.type === 'chat_join_result' && frame.accepted) state.pending = false;
        if (frame.type === 'chat_server_added') { state.community = frame.server; state.pending = false; }
        if (['chat_channels_update', 'chat_server_update', 'chat_server_added', 'chat_join_result', 'chat_roles_update', 'chat_perms_changed', 'chat_member_update'].includes(frame.type)) state.detailAt = 0;
        if (['chat_channels_update', 'chat_server_update', 'chat_server_added', 'chat_join_result'].includes(frame.type)) {
          state.channels.clear();
          this._instanceDetail(state).catch(error => { state.error = error.message; });
        }
        if (frame.type === 'chat_server_removed') { state.community = null; state.channels.clear(); state.detail = null; }
        if (frame.type === 'instance_restarting') socket.close();
      };
      socket.onerror = () => fail(new Error('Instance gateway error.'));
      socket.onclose = event => {
        if (state.socket !== socket) return;
        const error = event.code === 4001 ? 'invalid_session' : event.code === 4003 ? 'banned' : `Instance gateway closed (${event.code || 1006}).`;
        state.connectReject = null;
        this._stopInstance(state, false);
        if (event.code === 4001 || event.code === 4003) state.session = null;
        this._instanceTransition(state, event.code === 1000 ? 'disconnected' : 'error', event.code === 1000 ? '' : error);
        reject(new Error(error));
      };
      });
    },
    async _instanceMessage(state, channel, value) {
      const id = instanceId(value);
      // a bounded history query also finds older messages without paging in a loop
      const data = await this._instanceRequest(state, `/channels/${encodeURIComponent(channel.cid)}/messages?before=${BigInt(id) + 1n}&limit=1`);
      const message = (data.messages || []).find(item => bfString(item.id) === id);
      if (!message || bfString(message.channel) !== bfString(channel.cid)) throw new Error('message_not_found');
      this._instanceRemember(state, message);
      return message;
    },
    // the issuer this instance announces in /.well-known/bonfire (velora.issuer), normalized like the server does; legacy origin when absent.
    // Not SERVER_HTTP: the instance verifies against its own configured Nookara origin, which can differ from the domain we log in through.
    _instanceIssuer(state) {
      const announced = state.discovery?.velora?.issuer;
      if (announced) { try { const url = new URL(String(announced).trim()); if (url.protocol === 'https:' || url.protocol === 'http:') return url.origin; } catch { /* use the default */ } }
      return 'https://velora.ikelene.net';
    },
    _instanceCanSign(state) {
      return state.velora && state.user.kind === 'velora' && this._authenticated &&
        (this._grantedScopes & SCOPES.SIGN_MESSAGES) !== 0 && !(this._disabledScopes & SCOPES.SIGN_MESSAGES);
    },
    // returns { kid, sig, ts, nonce } or null when this session can't / mustn't sign (see the MESSAGE SIGNING note above)
    async _instanceSignature(state, channel, body, reply, edit, attachments = []) {
      if (!this._instanceCanSign(state)) return null;
      const token = this._token;
      if (!this._instanceSigningKey || this._instanceSigningToken !== token) {
        const response = await fetch(SERVER_HTTP + '/bonfire/signing-key', {
          credentials: 'omit', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15000), headers: { Authorization: `Bearer ${token}` },
        });
        const data = await response.json();
        if (!response.ok || data.error) throw (this._scopeErrorFromData(data) || new Error(data.error || `HTTP ${response.status}`));
        const bytes = instanceBytes(data.private_key);
        let key;
        try { key = await crypto.subtle.importKey('pkcs8', bytes, 'Ed25519', false, ['sign']); }
        finally { bytes.fill(0); delete data.private_key; }
        if (this._token !== token) throw new Error('Nookara account changed while signing.');
        this._instanceSigningKey = { key, kid: data.kid };
        this._instanceSigningToken = token;
      }
      const { key, kid } = this._instanceSigningKey;
      const ts = Date.now(), nonce = instanceB64(crypto.getRandomValues(new Uint8Array(16)));
      const payload = { v: 1, iss: this._instanceIssuer(state), instance: state.origin, community: state.community.sid,
        channel: channel.cid, author: bfString(state.user.velora_id), ts, nonce, body,
        attachments: attachments.map(instanceAttachHash), reply_to: reply, edit_of: edit };
      try {
        const sig = instanceB64(await crypto.subtle.sign('Ed25519', key, new TextEncoder().encode('bonfire-msg-v1\n' + instanceCanonical(payload))));
        return { kid, sig, ts, nonce };
      } catch (error) { this._instanceSigningKey = null; throw error; }
    },
    // send (edit = null) or edit (edit = message id) a message; signed when allowed, otherwise plain. Returns the stored message.
    async _instanceWrite(state, channel, body, reply = null, edit = null, attachments = [], sticker = null) {
      for (let attempt = 0; attempt < 2; attempt++) {
        const signature = await this._instanceSignature(state, channel, body, reply, edit, attachments);
        try {
          const data = await this._instanceRequest(state, edit ? `/messages/${encodeURIComponent(edit)}` : `/channels/${encodeURIComponent(channel.cid)}/messages`, edit ? 'PATCH' : 'POST',
            { message: body, ...(!edit ? { reply_to: reply } : {}), ...(!edit && attachments.length ? { attachments } : {}), ...(!edit && sticker ? { sticker } : {}), ...(signature ? { signature } : {}) });
          if (data.message) this._instanceRemember(state, data.message);
          return data.message || null;
        } catch (error) {
          if (!signature || error.message !== 'bad_signature' || attempt) throw error;
          this._instanceSigningKey = null;
        }
      }
      return null;
    },
    // ids of people / roles: usernames and role names are accepted everywhere a block asks for them
    async _instanceMemberId(state, value) {
      const ref = bfString(value).trim().replace(/^@/, '');
      if (!ref) throw new Error('Enter a username.');
      if (/^[vlb]:\d+$/.test(ref)) return ref;
      const sid = state.community?.sid;
      if (!sid) throw new Error('This Bonfire server has no community yet.');
      const found = (await this._instanceRequest(state, `/servers/${encodeURIComponent(sid)}/members`)).members.find(member => bfString(member.username).toLowerCase() === ref.toLowerCase());
      if (!found) throw new Error('member_not_found');
      return found.id;
    },
    async _instanceRoleId(state, value) {
      const ref = bfString(value).trim();
      const role = (await this._instanceDetailCached(state)).roles.find(item => item.rid === ref || bfString(item.name).toLowerCase() === ref.toLowerCase());
      if (!role) throw new Error('role_not_found');
      return role.rid;
    },
    _instanceSid(state) {
      if (state.pending) throw new Error('Community join request is pending approval.');
      if (!state.community?.sid) throw new Error('This Bonfire server has no community yet.');
      return encodeURIComponent(state.community.sid);
    },
    // public facts about a server (discovery + instance info); uses the session when connected so admins also see the update status
    async _instanceInfoOf(url) {
      const origin = this._instanceOrigin(url);
      const cache = this._instanceInfoCache || (this._instanceInfoCache = new Map());
      const hit = cache.get(origin);
      if (hit && Date.now() - hit.at < 30000) return hit;
      const session = this._instances.get(origin)?.session || null;
      const discovery = await this._instanceFetch(origin, '/.well-known/bonfire');
      let info = {};
      try { info = await this._instanceFetch(origin, '/api/v1/instance/info', 'GET', null, session); } catch { /* older servers: discovery only */ }
      const entry = { at: Date.now(), discovery, info };
      cache.set(origin, entry);
      return entry;
    },
    // ── connecting ──
    biConnect({ URL }) { return this._connectInstance(URL); },
    biConnectLocal({ URL, USERNAME, PASSWORD }) { return this._connectInstance(URL, { username: bfString(USERNAME), password: bfString(PASSWORD) }); },
    biRegister({ URL, USERNAME, PASSWORD }) { return this._connectInstance(URL, { register: true, username: bfString(USERNAME), password: bfString(PASSWORD) }); },
    async biDisconnect({ URL }) {
      const origin = this._instanceOrigin(URL), state = this._instances.get(origin);
      this._instanceURLs.delete(origin);
      if (!state) return;
      state.cancelled = true;
      this._stopInstance(state);
      this._instanceTransition(state, 'disconnected');
      const session = state.session; state.session = null;
      if (session) await this._instanceFetch(origin, '/api/v1/auth/logout', 'POST', null, session);
    },
    biConnected({ URL }) { return !!this._instances.get(this._instanceOrigin(URL))?.ready; },
    // the person's own server list on Nookara (follows them between devices); needs Chat Messaging
    async biMyInstances() { return JSON.stringify(await this._bfRequest('/bonfire/instances')); },
    async biSaveInstance({ URL }) {
      const origin = this._instanceOrigin(URL);
      const list = (await this._bfRequest('/bonfire/instances')).instances || [];
      if (!list.some(item => item.url === origin)) await this._bfRequest('/bonfire/instances', 'PUT', { instances: [...list.map(item => ({ url: item.url })), { url: origin }] });
    },
    async biForgetInstance({ URL }) {
      const origin = this._instanceOrigin(URL);
      const list = (await this._bfRequest('/bonfire/instances')).instances || [];
      await this._bfRequest('/bonfire/instances', 'PUT', { instances: list.filter(item => item.url !== origin).map(item => ({ url: item.url })) });
    },
    biConnectedList() {
      return JSON.stringify([...this._instances.values()].filter(state => state.ready).map(state => ({
        instance: state.origin, state: state.status, error: state.error || '', url: state.origin, name: state.community?.name || state.discovery?.name || '', sid: state.community?.sid || null, ready: !!state.ready, pending: !!state.pending, velora_account: !!state.velora, user: state.user?.id || null })));
    },
    async biHostedServers() { return JSON.stringify(await this._bfRequest('/bonfire/hosting/servers')); },
    async biDirectory({ QUERY, PAGE }) {
      const search = new URLSearchParams();
      if (bfString(QUERY).trim()) search.set('q', bfString(QUERY).trim());
      search.set('page', String(Math.max(1, Math.floor(instanceNumber(PAGE, 1)))));
      return JSON.stringify(await this._bfRequest('/bonfire/directory?' + search));
    },
    // ── about a server ──
    async biAbout({ PROP, URL }) {
      const { discovery: d, info } = await this._instanceInfoOf(URL);
      const b = d.build || info.build || {};
      switch (bfString(PROP).toLowerCase()) {
        case 'name': return d.name || '';
        case 'description': return d.description || '';
        case 'icon url': return d.icon_url || '';
        case 'version': return b.version || d.version || '';
        case 'commit': return b.commit_short || b.commit || '';
        case 'build id': return b.build_id || '';
        case 'built at': return b.built_at || '';
        case 'protocol': return d.protocol || 0;
        case 'accounts mode': return d.accounts_mode || '';
        case 'registration': return d.registration || '';
        case 'member count': return d.community?.member_count ?? 0;
        case 'join policy': return d.community?.join_policy || '';
        case 'community name': return d.community?.name || '';
        case 'community id': return d.community?.sid || '';
        case 'read only': return !!d.read_only;
        case 'hosting plan': return d.managed?.plan || '';
        case 'max upload mb': return d.max_upload_mb ?? 0;
        // only admins of that server get an update status
        case 'update available': return !!info.update?.outdated;
        default: return JSON.stringify({ discovery: d, info });
      }
    },
    async biHasFeature({ URL, FEATURE }) {
      const f = (await this._instanceInfoOf(URL)).discovery.features || {};
      switch (bfString(FEATURE).toLowerCase()) {
        case 'voice': return !!f.voice;
        case 'signing': return !!f.signing;
        case 'uploads': return !!f.uploads;
        case 'youtube': return !!f.youtube;
        case 'minecraft': return !!f.minecraft;
        case 'discord bridge': return !!f.bridges?.discord;
        case 'fluxer bridge': return !!f.bridges?.fluxer;
        case 'cloudlink bridge': return !!f.bridges?.cloudlink;
        default: return false;
      }
    },
    async biServerName({ URL }) { const state = await this._instanceEnsure(URL); return state.community?.name || state.discovery.name || ''; },
    async biMyId({ URL }) { return (await this._instanceEnsure(URL)).user.id; },
    // Voice runs over the instance's own gateway (chat_rtc_* with room bf_<cid>). This extension can't join Bonfire-server voice
    // yet (its audio engine is wired to the Nookara socket), so this only reports what a client needs to know.
    async biVoiceInfo({ CHANNEL, URL }) {
      const state = await this._instanceEnsure(URL), channel = await this._instanceChannel(state, CHANNEL);
      const features = (await this._instanceInfoOf(state.origin)).discovery.features || {};
      return JSON.stringify({ voice_available: !!features.voice, is_voice_channel: channel.type === 'voice', cid: channel.cid, name: channel.name, room: `bf_${channel.cid}`,
        user_limit: channel.config?.user_limit ?? 0, allow_call_in: !!channel.config?.allow_call_in, gateway: state.origin.replace(/^http/, 'ws') + '/gateway', joinable_from_this_extension: false });
    },
    // ── community ──
    async biCommunity({ URL }) { const state = await this._instanceEnsure(URL); return JSON.stringify({ ...(await this._instanceDetailCached(state)).server, instance: state.origin }); },
    async biJoin({ URL }) {
      const state = await this._instanceForJoin(URL);
      const data = await this._instanceRequest(state, `/servers/${this._instanceSid(state)}/join`, 'POST', {});
      if (data.pending) { state.pending = true; state.detailAt = 0; return; }
      state.pending = false;
      if (data.server) state.community = data.server;
      state.channels.clear(); state.detailAt = 0;
      await this._instanceDetail(state).catch(() => {});
      this._instanceURLs.add(state.origin);
    },
    biPending({ URL }) { return !!this._instances.get(this._instanceOrigin(URL))?.pending; },
    async biLeave({ URL }) {
      const state = await this._instanceEnsure(URL, { noJoin: true });
      await this._instanceRequest(state, `/servers/${this._instanceSid(state)}/leave`, 'POST', {});
      state.pending = false; state.detail = null; state.channels.clear();
    },
    async biMembers({ URL }) {
      const state = await this._instanceEnsure(URL);
      return JSON.stringify((await this._instanceRequest(state, `/servers/${this._instanceSid(state)}/members`)).members);
    },
    async biRoles({ URL }) { return JSON.stringify((await this._instanceDetailCached(await this._instanceEnsure(URL))).roles || []); },
    async biPermissions({ URL }) { return Number((await this._instanceDetailCached(await this._instanceEnsure(URL))).server.perms) || 0; },
    async biHasPermission({ PERMISSION, CHANNEL, URL }) { return this.bfHasPermission({ PERMISSION, CHANNEL, SERVER: URL }); },
    async biSetRole({ ACTION, ROLE, USER, URL }) {
      const state = await this._instanceEnsure(URL);
      const rid = await this._instanceRoleId(state, ROLE), uid = await this._instanceMemberId(state, USER);
      await this._instanceRequest(state, `/servers/${this._instanceSid(state)}/members/${encodeURIComponent(uid)}/roles/${encodeURIComponent(rid)}`, bfString(ACTION).toLowerCase() === 'remove' ? 'DELETE' : 'PUT', bfString(ACTION).toLowerCase() === 'remove' ? null : {});
      state.detailAt = 0;
    },
    async biKick({ USER, URL }) {
      const state = await this._instanceEnsure(URL);
      await this._instanceRequest(state, `/servers/${this._instanceSid(state)}/members/${encodeURIComponent(await this._instanceMemberId(state, USER))}`, 'DELETE');
    },
    async biBan({ USER, URL }) {
      const state = await this._instanceEnsure(URL);
      await this._instanceRequest(state, `/servers/${this._instanceSid(state)}/members/${encodeURIComponent(await this._instanceMemberId(state, USER))}?ban=1`, 'DELETE');
    },
    async biUnban({ USER, URL }) {
      const state = await this._instanceEnsure(URL);
      const ref = bfString(USER).trim().replace(/^@/, '');
      let uid = /^[vlb]:\d+$/.test(ref) ? ref : null;
      if (!uid) {
        // a banned person isn't a member any more, so look them up in the ban list
        const bans = (await this._instanceRequest(state, `/servers/${this._instanceSid(state)}/bans`)).bans || [];
        const hit = bans.map(ban => ban.user || ban).find(user => bfString(user.username).toLowerCase() === ref.toLowerCase());
        if (!hit) throw new Error('member_not_found');
        uid = hit.id;
      }
      await this._instanceRequest(state, `/servers/${this._instanceSid(state)}/bans/${encodeURIComponent(uid)}`, 'DELETE');
    },
    async biJoinRequests({ URL }) { const state = await this._instanceEnsure(URL); return JSON.stringify((await this._instanceRequest(state, `/servers/${this._instanceSid(state)}/requests`)).requests || []); },
    async _instanceResolveRequest(URL, USER, verb) {
      const state = await this._instanceEnsure(URL);
      const ref = bfString(USER).trim().replace(/^@/, '');
      let uid = /^[vlb]:\d+$/.test(ref) ? ref : null;
      if (!uid) {
        const hit = ((await this._instanceRequest(state, `/servers/${this._instanceSid(state)}/requests`)).requests || []).find(item => bfString(item.user?.username).toLowerCase() === ref.toLowerCase());
        if (!hit) throw new Error('request_not_found');
        uid = hit.user.id;
      }
      await this._instanceRequest(state, `/servers/${this._instanceSid(state)}/requests/${encodeURIComponent(uid)}/${verb}`, 'POST', {});
    },
    biAcceptRequest({ USER, URL }) { return this._instanceResolveRequest(URL, USER, 'accept'); },
    biDenyRequest({ USER, URL }) { return this._instanceResolveRequest(URL, USER, 'deny'); },
    // ── invites ──
    async biCreateInvite({ URL, SECONDS, USES }) {
      const state = await this._instanceEnsure(URL);
      const body = {};
      if (instanceNumber(SECONDS) > 0) body.expires_in = Math.floor(instanceNumber(SECONDS));
      if (instanceNumber(USES) > 0) body.max_uses = Math.floor(instanceNumber(USES));
      const invite = await this._instanceRequest(state, `/servers/${this._instanceSid(state)}/invites`, 'POST', body);
      return JSON.stringify({ ...invite, link: this._instanceInviteLink(state.origin, invite.code) });
    },
    _instanceInviteLink(origin, code) { return `${SERVER_HTTP}/chat#/i/${encodeURIComponent(origin)}/invite/${encodeURIComponent(bfString(code))}`; },
    biInviteLink({ CODE, URL }) { return this._instanceInviteLink(this._instanceOrigin(URL), instanceParseInvite(CODE, URL).code); },
    async biInviteInfo({ CODE, URL }) {
      const { origin, code } = instanceParseInvite(CODE, URL);
      return JSON.stringify(await this._instanceFetch(this._instanceOrigin(origin), `/api/v1/invite/${encodeURIComponent(code)}`));
    },
    async _instanceJoinInvite(originRef, code) {
      const state = await this._instanceForJoin(originRef);
      const data = await this._instanceRequest(state, `/join/${encodeURIComponent(code)}`, 'POST', {});
      if (data.pending) { state.pending = true; return state; }
      state.pending = false;
      if (data.server) state.community = data.server;
      state.channels.clear(); state.detailAt = 0;
      await this._instanceDetail(state).catch(() => {});
      this._instanceURLs.add(state.origin);
      return state;
    },
    async biJoinInvite({ CODE, URL }) { const { origin, code } = instanceParseInvite(CODE, URL); await this._instanceJoinInvite(origin, code); },
    async biInvites({ URL }) { const state = await this._instanceEnsure(URL); return JSON.stringify((await this._instanceRequest(state, `/servers/${this._instanceSid(state)}/invites`)).invites || []); },
    async biDeleteInvite({ CODE, URL }) { const state = await this._instanceEnsure(URL); await this._instanceRequest(state, `/invites/${encodeURIComponent(instanceParseInvite(CODE, URL).code)}`, 'DELETE'); },
    // ── channels ──
    async biChannels({ URL }) { const state = await this._instanceEnsure(URL); await this._instanceDetail(state); return JSON.stringify([...state.channels.values()]); },
    async biChannelId({ URL, NAME }) { return (await this._instanceChannel(await this._instanceEnsure(URL), NAME)).cid; },
    async biChannelProp({ PROP, CHANNEL, URL }) {
      const state = await this._instanceEnsure(URL), channel = await this._instanceChannel(state, CHANNEL);
      switch (bfString(PROP).toLowerCase()) {
        case 'id': return channel.cid;
        case 'name': return channel.name;
        case 'type': return channel.type || 'text';
        case 'topic': return channel.topic || '';
        case 'locked': return !!channel.locked;
        case 'can post': return !!channel.can_post;
        default: return JSON.stringify(channel);
      }
    },
    async biCreateChannel({ TYPE, NAME, URL }) {
      const state = await this._instanceEnsure(URL);
      await this._instanceRequest(state, `/servers/${this._instanceSid(state)}/channels`, 'POST', { name: bfString(NAME).trim(), type: bfString(TYPE).trim().toLowerCase() || 'text' });
      state.channels.clear(); state.detailAt = 0;
    },
    async biRenameChannel({ CHANNEL, NAME, URL }) {
      const state = await this._instanceEnsure(URL), channel = await this._instanceChannel(state, CHANNEL);
      await this._instanceRequest(state, `/channels/${encodeURIComponent(channel.cid)}`, 'PATCH', { name: bfString(NAME).trim() });
      state.channels.clear(); state.detailAt = 0;
    },
    async biDeleteChannel({ CHANNEL, URL }) {
      const state = await this._instanceEnsure(URL), channel = await this._instanceChannel(state, CHANNEL);
      await this._instanceRequest(state, `/channels/${encodeURIComponent(channel.cid)}`, 'DELETE');
      state.channels.clear(); state.detailAt = 0;
    },
    // ── messages ──
    async biMessages({ URL, CHANNEL }) {
      const state = await this._instanceEnsure(URL), channel = await this._instanceChannel(state, CHANNEL);
      const data = await this._instanceRequest(state, `/channels/${encodeURIComponent(channel.cid)}/messages?limit=100`);
      for (const message of data.messages || []) this._instanceRemember(state, message);
      return JSON.stringify(data.messages || []);
    },
    // filters JSON: { "limit": 1-100, "before": <message id>, "after": <message id> }
    async biHistory({ URL, CHANNEL, QUERY }) {
      const state = await this._instanceEnsure(URL), channel = await this._instanceChannel(state, CHANNEL);
      const query = bfString(QUERY).trim() ? this._bfJson(QUERY) : {};
      const search = new URLSearchParams();
      search.set('limit', String(Math.min(100, Math.max(1, Math.floor(instanceNumber(query.limit, 50))))));
      if (query.before) search.set('before', instanceId(query.before));
      if (query.after) search.set('after', instanceId(query.after));
      const data = await this._instanceRequest(state, `/channels/${encodeURIComponent(channel.cid)}/messages?${search}`);
      for (const message of data.messages || []) this._instanceRemember(state, message);
      return JSON.stringify(data.messages || []);
    },
    async biMessage({ ID, CHANNEL, URL }) { const state = await this._instanceEnsure(URL); return JSON.stringify(await this._instanceMessage(state, await this._instanceChannel(state, CHANNEL), ID)); },
    async biPins({ CHANNEL, URL }) {
      const state = await this._instanceEnsure(URL), channel = await this._instanceChannel(state, CHANNEL);
      const data = await this._instanceRequest(state, `/channels/${encodeURIComponent(channel.cid)}/pins`);
      return JSON.stringify(data.messages || data.pins || data);
    },
    async biSearch({ QUERY, CHANNEL, URL }) {
      const state = await this._instanceEnsure(URL), channel = await this._instanceChannel(state, CHANNEL);
      return JSON.stringify(await this._instanceRequest(state, `/channels/${encodeURIComponent(channel.cid)}/search?q=${encodeURIComponent(bfString(QUERY))}`));
    },
    async biSearchAll({ QUERY, URL }) {
      const state = await this._instanceEnsure(URL);
      return JSON.stringify(await this._instanceRequest(state, `/servers/${this._instanceSid(state)}/search?q=${encodeURIComponent(bfString(QUERY))}`));
    },
    async biMarkRead({ CHANNEL, ID, URL }) {
      const state = await this._instanceEnsure(URL), channel = await this._instanceChannel(state, CHANNEL);
      let id = bfString(ID).trim();
      if (!id) id = bfString(((await this._instanceRequest(state, `/channels/${encodeURIComponent(channel.cid)}/messages?limit=1`)).messages || [])[0]?.id || '');
      if (!id) return;
      await this._instanceRequest(state, `/channels/${encodeURIComponent(channel.cid)}/read`, 'POST', { id: instanceId(id) });
    },
    async biTyping({ CHANNEL, URL }) {
      const state = await this._instanceEnsure(URL), channel = await this._instanceChannel(state, CHANNEL);
      if (state.socket?.readyState === 1 && state.ready) state.socket.send(JSON.stringify({ type: 'chat_typing', channel: channel.cid }));
    },
    async biTypingUsers({ CHANNEL, URL }) {
      const state = await this._instanceEnsure(URL), channel = await this._instanceChannel(state, CHANNEL);
      const now = Date.now(), users = state.typing[channel.cid] || {};
      return JSON.stringify(Object.keys(users).filter(user => users[user] > now));
    },
    async biSend({ URL, CHANNEL, TEXT }) {
      const state = await this._instanceEnsure(URL), channel = await this._instanceChannel(state, CHANNEL);
      await this._instanceWrite(state, channel, instanceBody(TEXT));
    },
    async biReply({ URL, CHANNEL, ID, TEXT }) {
      const state = await this._instanceEnsure(URL), channel = await this._instanceChannel(state, CHANNEL);
      const message = await this._instanceMessage(state, channel, ID);
      await this._instanceWrite(state, channel, instanceBody(TEXT), bfString(message.id));
    },
    async biEdit({ URL, CHANNEL, ID, TEXT }) {
      const state = await this._instanceEnsure(URL), channel = await this._instanceChannel(state, CHANNEL);
      const message = await this._instanceMessage(state, channel, ID);
      // an edit is signed over the same reply target + attachments the message already has
      const reply = message.reply_to != null ? bfString(message.reply_to) : (message.reply?.id == null ? null : bfString(message.reply.id));
      await this._instanceWrite(state, channel, instanceBody(TEXT), reply, bfString(message.id), message.attachments || []);
    },
    async biDelete({ URL, ID }) { await this._instanceRequest(await this._instanceEnsure(URL), `/messages/${encodeURIComponent(instanceId(ID))}`, 'DELETE'); },
    async biReact({ URL, ID, EMOJI }) { await this._instanceRequest(await this._instanceEnsure(URL), `/messages/${encodeURIComponent(instanceId(ID))}/reactions/${encodeURIComponent(bfString(EMOJI))}`, 'PUT'); },
    async biUnreact({ URL, ID, EMOJI }) { await this._instanceRequest(await this._instanceEnsure(URL), `/messages/${encodeURIComponent(instanceId(ID))}/reactions/${encodeURIComponent(bfString(EMOJI))}`, 'DELETE'); },
    async biPin({ URL, ID }) { await this._instanceRequest(await this._instanceEnsure(URL), `/messages/${encodeURIComponent(instanceId(ID))}/pin`, 'PUT'); },
    async biUnpin({ URL, ID }) { await this._instanceRequest(await this._instanceEnsure(URL), `/messages/${encodeURIComponent(instanceId(ID))}/pin`, 'DELETE'); },
    biWhenMessage({ URL, CHANNEL }) {
      const state = this._instanceEvent;
      if (!state || state.origin !== this._instanceOrigin(URL)) return false;
      const channel = bfString(CHANNEL).trim();
      return state.last.channel === channel || state.channels.get(state.last.channel)?.name.toLowerCase() === channel.replace(/^#/, '').toLowerCase();
    },
    // polled hat: true once per event of that type, then it resets
    biWhenEvent({ EVENT, URL }) {
      const state = this._instanceLookup(URL);
      if (!state) return false;
      return state.eventFlags.delete(bfString(EVENT).trim() || 'any');
    },
    biEventJson({ URL }) { return JSON.stringify(this._instanceState(URL).lastEvent || {}); },
    biLastText({ URL }) { return this._instanceState(URL).last?.body || ''; },
    biLastAuthor({ URL }) { return this._instanceState(URL).last?.author?.id || ''; },
    biLastAlias({ URL }) { return this._instanceState(URL).last?.alias?.name || ''; },
    // Aliases are bot-only, so these two use a bot token on the Discord-style /bot/v1 routes (Authorization: Bot TOKEN).
    // Never put a real bot token in a project you share: anyone who opens it can read it.
    async _botAliasRequest(URL, TOKEN, path, method, body) {
      const origin = this._instanceOrigin(URL), token = bfString(TOKEN).trim();
      if (!token) throw new Error('Enter the bot token.');
      this._lastActionSuccess = false;
      const response = await fetch(origin + '/bot/v1' + path, { method, credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(15000), headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = response.status === 204 ? {} : await response.json().catch(() => ({}));
      if (!response.ok || data.error) throw new Error(data.message || data.error || `HTTP ${response.status}`);
      this._lastActionSuccess = true;
      return data;
    },
    _botAlias(NAME, AVATAR) {
      const name = bfString(NAME).replace(/[\r\n]+/g, ' ').trim(), avatar = bfString(AVATAR).trim();
      if (!name || name.length > 32) throw new Error('An alias name is 1 to 32 characters.');
      if (avatar && (!/^https:\/\/[^\s@/]+(?:[/?#]\S*)?$/i.test(avatar) || avatar.length > 500)) throw new Error('An alias avatar must be an https:// link of at most 500 characters, without spaces or user:pass@.');
      return avatar ? { name, avatar_url: avatar } : { name };
    },
    async biSendAlias({ TEXT, TOKEN, CHANNEL, URL, NAME, AVATAR }) {
      const channel = bfString(CHANNEL).trim();
      if (!/^\d+$/.test(channel)) throw new Error('Enter the numeric channel id.');
      await this._botAliasRequest(URL, TOKEN, `/channels/${channel}/messages`, 'POST', { content: bfString(TEXT), alias: this._botAlias(NAME, AVATAR) });
    },
    async biEditAlias({ ID, CHANNEL, TOKEN, URL, NAME, AVATAR }) {
      const channel = bfString(CHANNEL).trim(), id = bfString(ID).trim();
      if (!/^\d+$/.test(channel) || !/^\d+$/.test(id)) throw new Error('Enter the numeric channel id and message id.');
      const alias = bfString(NAME).trim() ? this._botAlias(NAME, AVATAR) : null;
      await this._botAliasRequest(URL, TOKEN, `/channels/${channel}/messages/${id}`, 'PATCH', { alias });
    },
    // ---- Bot DMs on Nookara (a bot token + https://nookara.cc/chat/api/v1 and wss://nookara.cc/chat/gateway) ----
    // A DM with a bot is never encrypted. A bot may start a DM only with someone it shares an Ember server with (and their privacy
    // setting allows bots), or answer someone who wrote to it first. 30 messages a minute, 20 new conversations an hour, 100 a day.
    // Never put a real bot token in a project you share: anyone who opens it can read it.
    async _botDmRequest(TOKEN, path, method, body) {
      const token = bfString(TOKEN).trim();
      if (!token) throw new Error('Enter the bot token.');
      this._lastActionSuccess = false;
      this._botDmError = '';
      try {
        const response = await fetch(SERVER_HTTP + '/chat/api/v1' + path, { method, credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(15000), headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
        const data = response.status === 204 ? {} : await response.json().catch(() => ({}));
        if (!response.ok) {
          const why = data.error === 'rate_limited' || response.status === 429 ? `The bot is sending DMs too fast. Try again in ${Math.ceil(Number(data.retry_after) || 1)} seconds.` : (data.detail || data.message || data.error || `HTTP ${response.status}`);
          throw new Error(why);
        }
        this._lastActionSuccess = true;
        return data;
      } catch (error) {
        this._botDmError = String(error?.message || error);
        throw error;
      }
    },
    async _botDmOpenWith(TOKEN, ID) {
      const who = bfString(ID).trim().replace(/^@/, '');
      if (!who) throw new Error('Enter the user id (or username).');
      const channel = await this._botDmRequest(TOKEN, '/users/@me/channels', 'POST', /^\d{1,18}$/.test(who) ? { recipient_id: who } : { username: who });
      return channel.id;
    },
    async biOpenBotDm({ ID, TOKEN }) { await this._botDmOpenWith(TOKEN, ID); },
    async biSendBotDm({ TEXT, ID, TOKEN }) {
      const channel = await this._botDmOpenWith(TOKEN, ID);
      await this._botDmRequest(TOKEN, `/channels/${channel}/messages`, 'POST', { content: bfString(TEXT) });
    },
    async biSendBotDmChannel({ TEXT, CHANNEL, TOKEN }) {
      const channel = bfString(CHANNEL).trim();
      if (!/^\d+$/.test(channel)) throw new Error('Enter the numeric DM channel id.');
      await this._botDmRequest(TOKEN, `/channels/${channel}/messages`, 'POST', { content: bfString(TEXT) });
    },
    biBotDmChannelFor({ ID }) { const id = bfString(ID).trim(); return /^\d{1,12}$/.test(id) ? String(1000000000000 + Number(id)) : ''; },
    biBotDmConnect({ TOKEN }) {
      const token = bfString(TOKEN).trim();
      if (!token) throw new Error('Enter the bot token.');
      this.biBotDmDisconnect();
      const st = { token, ws: null, ready: false, closed: false, tries: 0, me: null, beat: null, retry: null };
      this._botDmGate = st;
      this._botDmError = '';
      this._botDmDial(st);
    },
    _botDmDial(st) {
      if (st.closed) return;
      let ws;
      try { ws = new WebSocket(SERVER_WS + '/chat/gateway'); } catch (error) { this._botDmError = String(error?.message || error); return; }
      st.ws = ws;
      ws.onmessage = event => {
        let frame;
        try { frame = JSON.parse(event.data); } catch { return; }
        if (frame.op === 10) {
          clearInterval(st.beat);
          st.beat = setInterval(() => { if (ws.readyState === 1) ws.send(JSON.stringify({ op: 1, d: null })); }, Math.max(5000, Number(frame.d?.heartbeat_interval) || 41250));
          ws.send(JSON.stringify({ op: 2, d: { token: st.token, intents: 0, properties: {} } }));
          return;
        }
        if (frame.op !== 0) return;
        if (frame.t === 'READY') { st.ready = true; st.tries = 0; st.me = frame.d?.user?.id == null ? null : String(frame.d.user.id); this._botDmError = ''; return; }
        const m = frame.d;
        // a DM has no guild_id and bonfire.dm; the bot's own sent messages come back too, so skip them
        if (frame.t === 'MESSAGE_CREATE' && m && !m.guild_id && m.bonfire?.dm && String(m.author?.id) !== st.me) { this._botDmLast = m; this._evtBotDm = true; }
      };
      ws.onerror = () => { this._botDmError = 'Could not reach the Nookara bot gateway.'; };
      ws.onclose = event => {
        clearInterval(st.beat);
        st.ready = false;
        if (st.closed) return;
        if (event.code === 4004) { st.closed = true; this._botDmError = 'The bot token was refused.'; return; }
        st.tries += 1;
        st.retry = setTimeout(() => this._botDmDial(st), Math.min(30000, 1000 * 2 ** Math.min(st.tries, 5)));
      };
    },
    biBotDmDisconnect() {
      const st = this._botDmGate;
      this._botDmGate = null;
      if (!st) return;
      st.closed = true;
      clearInterval(st.beat);
      clearTimeout(st.retry);
      try { st.ws?.close(); } catch { /* already closed */ }
    },
    biBotDmConnected() { return !!this._botDmGate?.ready; },
    biWhenBotDm() { const v = !!this._evtBotDm; this._evtBotDm = false; return v; },
    biBotDmText() { return this._botDmLast?.content || ''; },
    biBotDmAuthor() { return this._botDmLast?.author?.username || ''; },
    biBotDmAuthorId() { return this._botDmLast?.author?.id == null ? '' : String(this._botDmLast.author.id); },
    biBotDmChannel() { return this._botDmLast?.channel_id == null ? '' : String(this._botDmLast.channel_id); },
    biBotDmJson() { return JSON.stringify(this._botDmLast || {}); },
    biBotDmError() { return this._botDmError || ''; },
    biLastId({ URL }) { return this._instanceState(URL).last?.id || ''; },
    biLastChannel({ URL }) { return this._instanceState(URL).last?.channel || ''; },
    biLastProp({ PROP, URL }) {
      const m = this._instanceState(URL).last;
      if (!m) return '';
      switch (bfString(PROP).toLowerCase()) {
        case 'text': return m.body || '';
        case 'author name': return m.author?.username || m.author?.display_name || '';
        case 'author display name': return m.author?.display_name || m.author?.username || '';
        case 'author id': return m.author?.id || '';
        case 'alias name': return m.alias?.name || '';
        case 'alias avatar': return m.alias?.avatar_url || '';
        case 'alias unmarked?': return !!m.alias?.unmarked; // the server lets this bot's aliases show with no mark (Danger zone setting)
        case 'channel': return m.channel || '';
        case 'id': return m.id || '';
        case 'reply to': return m.reply_to != null ? bfString(m.reply_to) : (m.reply?.id == null ? '' : bfString(m.reply.id));
        case 'signed': return !!m.signature;
        // the server's own verdict (clients are meant to verify against Nookara's keys themselves; this extension does not)
        case 'server says verified': return m.verified === true;
        case 'attachments': return JSON.stringify(m.attachments || []);
        default: return JSON.stringify(m);
      }
    },
    // ── media ──
    async _instanceUpload(state, channel, dataUri, filename) {
      if (state.velora) this._requireScope(SCOPES.MEDIA_UPLOAD);
      const uri = bfString(dataUri);
      if (!/^(data:|blob:)/.test(uri)) throw new Error('Choose a file or provide its data URI.');
      const source = await fetch(uri);
      if (!source.ok) throw new Error('Could not read the file.');
      const form = new FormData();
      form.append('file', await source.blob(), bfString(filename).trim() || 'file');
      const query = new URLSearchParams({ sid: state.community.sid, cid: channel.cid });
      return this._instanceMultipart(state, `/media/upload?${query}`, form);
    },
    async _instanceMultipart(state, path, form) {
      this._lastActionSuccess = false;
      const response = await fetch(`${state.origin}/api/v1${path}`, { method: 'POST', credentials: 'omit', redirect: 'error', headers: { Authorization: `Bearer ${state.session}` }, body: form, signal: AbortSignal.timeout(120000) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.error) { this._lastActionOutput = JSON.stringify(data); throw new Error(data.error || data.message || `HTTP ${response.status}`); }
      this._lastActionSuccess = true; this._lastActionOutput = JSON.stringify(data);
      return data;
    },
    async biUpload({ FILE, FILENAME, CHANNEL, URL }) {
      const state = await this._instanceEnsure(URL), channel = await this._instanceChannel(state, CHANNEL);
      return JSON.stringify(instanceAttachment(await this._instanceUpload(state, channel, FILE, FILENAME)));
    },
    // asks the server itself to fetch the file (HTTPS links only), so the browser never has to download it
    async biImportMedia({ MEDIA_URL, CHANNEL, URL }) {
      const state = await this._instanceEnsure(URL), channel = await this._instanceChannel(state, CHANNEL);
      if (state.velora) this._requireScope(SCOPES.MEDIA_UPLOAD);
      const query = new URLSearchParams({ sid: state.community.sid, cid: channel.cid });
      return JSON.stringify(instanceAttachment(await this._instanceRequest(state, `/media/import?${query}`, 'POST', { url: bfString(MEDIA_URL).trim() })));
    },
    async biSendAttachments({ TEXT, ATTACHMENTS, CHANNEL, URL }) {
      const state = await this._instanceEnsure(URL), channel = await this._instanceChannel(state, CHANNEL);
      await this._instanceWrite(state, channel, instanceBody(TEXT), null, null, instanceAttachments(ATTACHMENTS));
    },
    async biSendFile({ TEXT, FILE, FILENAME, CHANNEL, URL }) {
      const state = await this._instanceEnsure(URL), channel = await this._instanceChannel(state, CHANNEL);
      const attachment = instanceAttachment(await this._instanceUpload(state, channel, FILE, FILENAME));
      await this._instanceWrite(state, channel, instanceBody(TEXT), null, null, [attachment]);
    },
    // ── stickers (Ember servers, PROTOCOL 6.1.1): server-only, up to 30 per server, a sticker goes out as a message of its own ──
    async biStickers({ URL }) { const state = await this._instanceEnsure(URL); return JSON.stringify((await this._instanceRequest(state, `/servers/${this._instanceSid(state)}/stickers`)).stickers || []); },
    // accepts the sticker's id (tid) or its name
    async _instanceStickerId(state, value) {
      const ref = bfString(value).trim().replace(/^:|:$/g, '');
      if (!ref) throw new Error('Enter a sticker name or id.');
      if (/^t[0-9a-f]{10}$/.test(ref)) return ref;
      const list = (await this._instanceRequest(state, `/servers/${this._instanceSid(state)}/stickers`)).stickers || [];
      const hit = list.find(item => bfString(item.name).toLowerCase() === ref.toLowerCase());
      if (!hit) throw new Error('No sticker with that name or id on this server.');
      return hit.tid;
    },
    async biSendSticker({ STICKER, CHANNEL, URL }) {
      const state = await this._instanceEnsure(URL), channel = await this._instanceChannel(state, CHANNEL);
      await this._instanceWrite(state, channel, '', null, null, [], await this._instanceStickerId(state, STICKER));
    },
    async biAddSticker({ NAME, FILE, FILENAME, URL }) {
      const state = await this._instanceEnsure(URL);
      if (!/^(data:|blob:)/.test(bfString(FILE))) throw new Error('Choose a file or provide its data URI.');
      const source = await fetch(bfString(FILE));
      if (!source.ok) throw new Error('Could not read the file.');
      const form = new FormData();
      form.append('file', await source.blob(), bfString(FILENAME).trim() || 'sticker.png');
      if (bfString(NAME).trim()) form.append('name', bfString(NAME).trim());
      const data = await this._instanceMultipart(state, `/servers/${this._instanceSid(state)}/stickers`, form);
      return JSON.stringify(data.sticker || data);
    },
    async biRenameSticker({ STICKER, NAME, URL }) {
      const state = await this._instanceEnsure(URL);
      await this._instanceRequest(state, `/servers/${this._instanceSid(state)}/stickers/${encodeURIComponent(await this._instanceStickerId(state, STICKER))}`, 'PATCH', { name: bfString(NAME).trim() });
    },
    async biDeleteSticker({ STICKER, URL }) {
      const state = await this._instanceEnsure(URL);
      await this._instanceRequest(state, `/servers/${this._instanceSid(state)}/stickers/${encodeURIComponent(await this._instanceStickerId(state, STICKER))}`, 'DELETE');
    },
    // { tid, name, url, animated } (or { tid, name: null, url: null, animated: false, deleted: true } once it was deleted); {} when the message has none
    async biMessageSticker({ ID, CHANNEL, URL }) { const state = await this._instanceEnsure(URL); return JSON.stringify((await this._instanceMessage(state, await this._instanceChannel(state, CHANNEL), ID)).sticker || {}); },
    // ── bots ──
    // (the person's OWN bots - create / token / gallery listing - live on Nookara: see the "Nookara API: bots" blocks.
    //  These manage the bot accounts inside one community.)
    async biBots({ URL }) { return JSON.stringify(await this._instanceRequest(await this._instanceEnsure(URL), '/bots')); },
    async biCreateBot({ NAME, DESCRIPTION, URL }) { return JSON.stringify(await this._instanceRequest(await this._instanceEnsure(URL), '/bots', 'POST', { name: bfString(NAME).trim(), description: bfString(DESCRIPTION) })); },
    async biRemoveBot({ BOT, URL }) { await this._instanceRequest(await this._instanceEnsure(URL), `/bots/${encodeURIComponent(bfString(BOT).trim())}`, 'DELETE'); },
    // listed (gallery) bot -> this community: Nookara hands out a short-lived ticket for this server, the server checks it offline
    async biAddGalleryBot({ BOT, URL }) {
      const state = await this._instanceEnsure(URL);
      if (!state.velora) throw new Error('gallery_needs_velora_account');
      const sid = state.community?.sid;
      if (!sid) throw new Error('This Bonfire server has no community yet.');
      const ticket = await this._bfRequest(`/bonfire/bots/gallery/${encodeURIComponent(bfString(BOT).trim())}/ticket`, 'POST', { instance: state.origin });
      await this._instanceRequest(state, '/bots/gallery/add', 'POST', { ticket: ticket.ticket, sid });
      state.detailAt = 0;
    },
    // ── anything else the server's REST API has (roles, emojis, sounds, webhooks, shop, bridges, settings ...) ──
    // PROTOCOL.md lists the routes; the path is relative to INSTANCE/api/v1. For GET / DELETE the options become the query string.
    async biApi({ METHOD, PATH, URL, OPTIONS }) {
      const method = bfString(METHOD).trim().toUpperCase();
      if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) throw new Error('Choose GET, POST, PUT, PATCH or DELETE.');
      const path = bfString(PATH).trim();
      if (!path.startsWith('/') || path.startsWith('//') || path.includes('..') || path.length > 512 || /^\/auth(\/|$)/.test(path)) throw new Error('Invalid API path.');
      const state = await this._instanceEnsure(URL);
      const options = bfString(OPTIONS).trim() ? this._bfJson(OPTIONS) : {};
      let full = path, body = null;
      if (method === 'GET' || method === 'DELETE') {
        const search = new URLSearchParams();
        for (const [key, value] of Object.entries(options)) if (value !== undefined && value !== null && value !== '') search.set(key, bfString(value));
        if (search.size) full += (path.includes('?') ? '&' : '?') + search;
      } else body = options;
      return JSON.stringify(await this._instanceRequest(state, full, method, body));
    },
    biWebhook({ TEXT, WEBHOOK_URL }) {
      const url = new URL(bfString(WEBHOOK_URL).trim());
      const origin = this._instanceOrigin(url.href);
      if (!/^\/api\/v1\/webhooks\/[^/]+\/[^/]+$/.test(url.pathname)) throw new Error('Invalid Bonfire webhook URL.');
      return this._instanceFetch(origin, url.pathname + url.search, 'POST', { content: bfString(TEXT) });
    },
    serialize() { return { instances: [...this._instanceURLs] }; },
    deserialize(data) {
      this._disposeInstances();
      this._instanceURLs.clear();
      for (const value of Array.isArray(data?.instances) ? data.instances.slice(0, 100) : []) {
        try { this._instanceURLs.add(this._instanceOrigin(value)); } catch { /* skip invalid saved origins */ }
      }
      this._restoreInstances();
    },
    _restoreInstances() {
      // Saved URLs are project configuration only. The project decides when to connect and retry.
    },
    // ── the older "server" blocks: [SERVER] can now be a Bonfire server URL or the name / id of a community on a server you're connected to ──
    _bfMatchCommunity(state, key) {
      const c = state.community;
      if (!c) return false;
      let host = '';
      try { host = new URL(state.origin).host; } catch { /* ignore */ }
      return [c.sid, c.name, state.origin, host].some(value => value && bfString(value).toLowerCase() === key);
    },
    _bfLooksLikeInstance(text) { return /^https?:\/\/[^\s/]+/i.test(text) || /^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?$/i.test(text); },
    // only looks at servers that are already connected (hats poll this every frame, so it must not do any network)
    _bfResolveSync(ref) {
      const text = bfString(ref).trim();
      if (!text) return null;
      const key = text.toLowerCase().replace(/\/$/, '');
      const matches = [...this._instances.values()].filter(state => state.ready && !state.pending && this._bfMatchCommunity(state, key));
      if (matches.length === 1) return matches[0];
      if (matches.length > 1) return null;
      if (/^https?:\/\//i.test(text)) { const state = this._instanceLookup(text); if (state?.ready) return state; }
      return null;
    },
    async _bfResolveTarget(ref) {
      const text = bfString(ref).trim();
      const matches = [...this._instances.values()].filter(state => state.ready && !state.pending && this._bfMatchCommunity(state, text.toLowerCase().replace(/\/$/, '')));
      if (matches.length > 1) throw new Error('Ambiguous server name: use the new ID-based block with instance URL and server ID.');
      if (matches.length) return matches[0];
      if (this._bfLooksLikeInstance(text)) return this._instanceState(/^https?:/i.test(text) ? text : 'https://' + text);
      throw new Error('Server name could not be resolved on a connected instance: use the new ID-based block with instance URL, server ID and channel ID.');
    },
    _bfHatTarget(ref) { return this._bfResolveSync(ref); },
    // game + CloudLink routes have the same shape on Nookara (/chat/...) and on a Bonfire server (/api/v1/...)
    _bfApi(d, path, method = 'GET', body = null) {
      return d.instance ? this._instanceRequest(d.instance, path, method, body) : this._bfRequest('/chat' + path, method, body);
    },
  });
  // ---- hook the older blocks up to Bonfire servers ----
  {
    const proto = NookaraExtension.prototype;
    const legacy = {};
    const reroute = (name, handler) => {
      legacy[name] = proto[name];
      proto[name] = async function (args = {}) {
        const state = await this._bfResolveTarget(args.SERVER);
        return state ? handler.call(this, state, args) : legacy[name].call(this, args);
      };
    };

    const legacyChatServer = proto._chatServer;
    proto._chatServer = async function (ref) {
      this._bfInit();
      const text = bfString(ref).trim();
      if (!text) throw new Error('server_required');
      this._requireScope(SCOPES.CHAT);
      const state = await this._bfResolveTarget(text);
      return { ...(await this._instanceDetailCached(state)), instance: state };
    };

    // Saved rail entries use public discovery until explicitly connected. Membership is unknown then.
    proto.chatMyServers = async function () {
      this._requireScope(SCOPES.CHAT);
      const saved = (await this._bfRequest('/bonfire/instances')).instances || [];
      const origins = new Set(saved.map(item => this._instanceOrigin(item.url)));
      for (const state of this._instances.values()) if (state.session) origins.add(state.origin);
      const list = [];
      for (const origin of origins) {
        const state = this._instances.get(origin);
        try {
          if (state?.session) {
            const data = await this._instanceRequest(state, '/servers');
            for (const server of data.servers || []) list.push(this._communityEntry(origin, server, !!state.ready, true));
          } else {
            const d = await this._instanceFetch(origin, '/.well-known/bonfire');
            list.push(this._communityEntry(origin, d.community || {}, false, null, { membership: 'unknown', source: 'saved_instance', read_only: !!d.read_only }));
          }
        } catch (error) {
          list.push(this._communityEntry(origin, {}, !!state?.ready, null, { membership: 'unknown', error: error.message }));
        }
      }
      this._chatServers = list;
      return JSON.stringify(list);
    };
    const legacyJoin = proto.chatJoinServer;
    proto.chatJoinServer = async function (args = {}) {
      const text = bfString(args.SERVER).trim();
      const invite = text.match(/#\/i\/([^/]+)\/invite\/([A-Za-z0-9_-]+)/);
      if (invite) { const parsed = instanceParseInvite(text, ''); await this._instanceJoinInvite(parsed.origin, parsed.code); return; }
      if (this._bfLooksLikeInstance(text)) { return this.biJoin({ URL: /^https?:/i.test(text) ? text : 'https://' + text }); }
      const state = await this._bfResolveTarget(text);
      await this._instanceRequest(state, `/servers/${this._instanceSid(state)}/join`, 'POST', {});
    };
    reroute('chatLeaveServer', async function (state) {
      await this._instanceRequest(state, `/servers/${this._instanceSid(state)}/leave`, 'POST', {});
      state.pending = false; state.detail = null; state.channels.clear(); this._chatServers = null;
    });
    reroute('chatMembers', async function (state) {
      const data = await this._instanceRequest(state, `/servers/${this._instanceSid(state)}/members`);
      return JSON.stringify(data.members);
    });
    // Bonfire servers don't relay presence, so "active" members are the ones whose presence this client already knows from Nookara
    reroute('chatOnlineMembers', async function (state) {
      const data = await this._instanceRequest(state, `/servers/${this._instanceSid(state)}/members`);
      return JSON.stringify(data.members.filter(member => { const p = this._presence[bfString(member.username).toLowerCase()]; return p && p.status && p.status !== 'offline'; }));
    });
    reroute('chatIsMember', async function (state) { return !!state.community && !state.pending; });
    reroute('chatSend', async function (state, { MSG, CHANNEL }) {
      const channel = await this._instanceChannel(state, CHANNEL);
      await this._instanceWrite(state, channel, instanceBody(MSG));
    });
    reroute('chatMessages', async function (state, { CHANNEL }) {
      const channel = await this._instanceChannel(state, CHANNEL);
      const data = await this._instanceRequest(state, `/channels/${encodeURIComponent(channel.cid)}/messages?limit=100`);
      for (const message of data.messages || []) this._instanceRemember(state, message);
      return JSON.stringify(data.messages || []);
    });
    reroute('bfSendReply', async function (state, { MSG, ID, ATTACHMENTS, CHANNEL }) {
      const channel = await this._instanceChannel(state, CHANNEL);
      const reply = bfString(ID).trim() ? bfString((await this._instanceMessage(state, channel, ID)).id) : null;
      await this._instanceWrite(state, channel, instanceBody(MSG), reply, null, instanceAttachments(ATTACHMENTS));
    });
    reroute('bfTypingState', async function (state, { STATE, CHANNEL }) {
      const channel = await this._instanceChannel(state, CHANNEL);
      if (bfString(STATE) === 'on' && state.ready && state.socket?.readyState === 1) state.socket.send(JSON.stringify({ type: 'chat_typing', channel: channel.cid }));
    });
    reroute('chatTypingUsers', async function (state, { CHANNEL }) {
      const channel = await this._instanceChannel(state, CHANNEL);
      const now = Date.now(), users = state.typing[channel.cid] || {};
      return JSON.stringify(Object.keys(users).filter(user => users[user] > now));
    });

    // hats: answered from the connected servers only (never any network)
    legacy.whenChatMessage = proto.whenChatMessage;
    proto.whenChatMessage = function ({ CHANNEL, SERVER }) {
      const state = this._bfHatTarget(SERVER);
      if (!state) return false;
      const channel = this._instanceChannelSync(state, CHANNEL);
      if (!channel || !state.chatEvt[channel.cid]) return false;
      state.chatEvt[channel.cid] = false;
      return true;
    };

    // game servers + CloudLink bridges, on Nookara communities (old) or Bonfire servers
    proto._gameChannel = async function (CHANNEL, SERVER) {
      this._requireScope(SCOPES.CHAT);
      const { c, d } = await this._chatChannel(CHANNEL, SERVER);
      if (c.type !== 'game') throw new Error('Choose a game server channel.');
      return { c, d };
    };
    proto.bfGameServers = async function ({ SERVER }) {
      const d = await this._chatServer(SERVER);
      return JSON.stringify((await this._bfApi(d, `/game/servers/${encodeURIComponent(d.server.sid)}/instances`)).instances || []);
    };
    proto._gameStatusOf = async function (CHANNEL, SERVER) {
      const { c, d } = await this._gameChannel(CHANNEL, SERVER);
      return this._bfApi(d, `/game/channels/${encodeURIComponent(c.cid)}/status`);
    };
    proto.bfGameConsole = async function ({ CHANNEL, SERVER }) {
      const { c, d } = await this._gameChannel(CHANNEL, SERVER);
      return JSON.stringify((await this._bfApi(d, `/game/channels/${encodeURIComponent(c.cid)}/console`)).lines || []);
    };
    proto.bfGameCommand = async function ({ COMMAND, CHANNEL, SERVER }) {
      const { c, d } = await this._gameChannel(CHANNEL, SERVER);
      this._gameOutput = '';
      try {
        const data = await this._bfApi(d, `/game/channels/${encodeURIComponent(c.cid)}/console`, 'POST', { command: bfString(COMMAND) });
        this._gameOutput = Array.isArray(data.output) ? data.output.join('\n') : bfString(data.output || '');
      } catch (error) {
        if (error.message === 'console_needs_bonfire') throw new Error('Console commands only work from the Nookara website or the Bonfire app, not from a project token.');
        throw error;
      }
    };
    proto._cloudlinkStatusOf = async function (CHANNEL, SERVER) {
      this._requireScope(SCOPES.CHAT);
      const { c, d } = await this._chatChannel(CHANNEL, SERVER);
      if (c.type !== 'logs' || c.config?.mode !== 'cloudlink') throw new Error('Choose a CloudLink bridge channel.');
      return (await this._bfApi(d, `/channels/${encodeURIComponent(c.cid)}/cloudlink`)).status || {};
    };
  }
  // v1.8: ID-based palette. The protocol hosts one community per instance, so validate
  // SERVER against that instance before delegating to the existing signed REST implementation.
  const idInstanceBlocks = [];
  let idSection = '';
  for (const entry of instanceBlocks) {
    if (typeof entry === 'string') { idSection = entry; continue; }
    const [old, type, text, defaults] = entry;
    if (old !== 'biVoiceInfo' && !['Bonfire communities', 'Bonfire invites', 'Bonfire channels', 'Bonfire messages', 'Bonfire media', 'Bonfire bots'].includes(idSection)) continue;
    if (['biWhenEvent', 'biEventJson', 'biLastText', 'biLastAuthor', 'biLastId', 'biLastChannel', 'biLastProp', 'biInviteLink', 'biInviteInfo', 'biJoinInvite', 'biChannelId'].includes(old)) continue;
    const opcode = old + 'Ids';
    const messageAction = ['biDelete', 'biReact', 'biUnreact', 'biPin', 'biUnpin'].includes(old);
    const args = { ...defaults, SERVER: 's1', ...(messageAction ? { CHANNEL: 'c1' } : {}) };
    if ('CHANNEL' in args) args.CHANNEL = 'c1';
    if ('EMOJI' in args) args.EMOJI = 'like';
    const label = text.replace(/\[URL\]/g, 'instance [URL] server ID [SERVER]').replace(/channel \[CHANNEL\]/g, 'channel ID [CHANNEL]') + (messageAction ? ' in channel ID [CHANNEL]' : '');
    idInstanceBlocks.push([opcode, type, label, args, old]);
    const implementation = NookaraExtension.prototype[old];
    NookaraExtension.prototype[opcode] = type === 'HAT' ? function (values) {
      const state = this._instanceEvent;
      return !!state && state.ready && state.origin === this._instanceOrigin(values.URL) &&
        bfString(state.community?.sid) === bfString(values.SERVER).trim() &&
        bfString(state.last?.channel) === bfString(values.CHANNEL).trim();
    } : async function (values) {
      const state = await (old === 'biJoin' ? this._instanceForJoin(values.URL) : this._instanceEnsure(values.URL));
      if (state.velora) this._requireScope(SCOPES.CHAT);
      if (!bfString(values.SERVER).trim() || bfString(state.community?.sid) !== bfString(values.SERVER).trim()) throw new Error('Server ID does not belong to this instance.');
      if ('CHANNEL' in args) {
        const detail = await this._instanceDetailCached(state);
        if (!(detail.channels || []).some(channel => bfString(channel.cid) === bfString(values.CHANNEL).trim())) throw new Error('Channel ID does not belong to this server; use the channel ID reporter.');
      }
      if (messageAction) await this._instanceMessage(state, await this._instanceChannel(state, values.CHANNEL), values.ID);
      return implementation.call(this, values);
    };
  }
  Object.assign(NookaraExtension.prototype, {
    _instanceTransition(state, status, error = '') {
      if (state.status === status && (state.error || '') === error) return;
      state.status = status;
      state.error = error;
      const event = { instance: state.origin, state: status, error };
      this._instanceStateEvent = event;
      try { this.runtime.startHats(EXT_ID + '_biWhenState', { STATE: status }); }
      finally { this._instanceStateEvent = null; }
    },
    biConnectInstance({ URL }) { return this._connectInstance(URL); },
    biDisconnectInstance(args) { return this.biDisconnect(args); },
    biConnectionState({ URL }) { return this._instanceLookup(URL)?.status || 'disconnected'; },
    biConnectionError({ URL }) { return this._instanceLookup(URL)?.error || ''; },
    biWhenState({ URL, STATE }) {
      const event = this._instanceStateEvent;
      return !!event && event.instance === this._instanceOrigin(URL) && event.state === bfString(STATE);
    },
    _communityEntry(origin, server, connected, joined, extra = {}) {
      return { ...server, instance: origin, sid: server.sid || null, name: server.name || '',
        description: server.description || '', icon: server.icon ?? server.icon_url ?? null,
        banner: server.banner ?? server.banner_url ?? null, member_count: server.member_count ?? null,
        role: server.role ?? server.roles ?? null, permissions: server.perms ?? server.permissions ?? null,
        unread: server.unread ?? server.unread_count ?? null, mentions: server.mentions ?? server.mention_count ?? null,
        connected, joined, legacy: false, ...extra };
    },
    async biServers({ URL }) {
      const state = await this._instanceEnsure(URL);
      const data = await this._instanceRequest(state, '/servers');
      return JSON.stringify((data.servers || []).map(server => this._communityEntry(state.origin, server, state.ready, true)));
    },
    async biServerChannels({ URL, SERVER }) {
      const state = await this._instanceEnsure(URL);
      if (bfString(state.community?.sid) !== bfString(SERVER).trim()) throw new Error('Server ID does not belong to this instance.');
      const data = await this._instanceDetail(state);
      return JSON.stringify((data.channels || []).map(channel => ({ ...channel, instance: state.origin, sid: state.community.sid })));
    },
    async biFindChannelId({ URL, SERVER, NAME }) {
      const channels = JSON.parse(await this.biServerChannels({ URL, SERVER }));
      const matches = channels.filter(channel => bfString(channel.name).toLowerCase() === bfString(NAME).trim().replace(/^#/, '').toLowerCase());
      if (matches.length !== 1) throw new Error(matches.length ? 'Ambiguous channel name; use a channel ID.' : 'channel_not_found');
      return matches[0].cid;
    },
  });
  NookaraExtension.prototype.chatChannelLocked = async function ({ CHANNEL, SERVER }) { return !!(await this._chatChannel(CHANNEL, SERVER)).c.locked; };
  NookaraExtension.prototype.chatCanPost = async function ({ CHANNEL, SERVER }) { return !!(await this._chatChannel(CHANNEL, SERVER)).c.can_post; };
  // Keep biConnect as a deprecated alias. No deserialization, reporter or hat may initiate login.
  NookaraExtension.prototype.biConnect = NookaraExtension.prototype.biConnectInstance;
  // v1.9: existing project opcodes are the decentralized API. Resolution never connects.
  const migrationError = detail => new Error(detail + ': use the connect block and the server ID / channel ID (or an instance-scoped block).');
  const uiRoute = path => /^\/chat\/(gifs|klipy|modmail|unfurl|notify|open|settings|emojis|sounds|hooks|bridge)(\/|$)/.test(path) ||
    /^\/chat\/media(\/|$)/.test(path) && !/^\/chat\/media\/(upload|external)$/.test(path) ||
    /\/(emojis|sounds|webhooks|cloudlink)(\/|$)/.test(path) || /\/layout$/.test(path);
  // Presence, identities, Instant Messages and global bot-gallery identity remain Nookara services.
  const identityRoute = path => /^\/chat\/(presence|users|dm|calls|personal-emojis)(\/|$)/.test(path) || /^\/chat\/bots\/[^/]+\/gallery(\/|$)/.test(path);
  const nativeSpecs = VELORA_ROUTES.filter(spec => spec.path.startsWith('/chat/') && !identityRoute(spec.path));
  const p19 = NookaraExtension.prototype;
  Object.assign(p19, {
    _connected19() { this._bfInit(); return [...this._instances.values()].filter(s => s.ready && s.session); },
    _choose19(matches, what) {
      if (matches.length !== 1) throw migrationError(matches.length ? 'Ambiguous ' + what : what + ' not connected or not found');
      return matches[0];
    },
    async _bfResolveTarget(ref) {
      const text = bfString(ref).trim();
      let origin = null;
      if (/#\/i\/[^/]+\/invite\//.test(text)) origin = this._instanceOrigin(instanceParseInvite(text, '').origin);
      else if (this._bfLooksLikeInstance(text)) origin = this._instanceOrigin(/^https?:/i.test(text) ? text : 'https://' + text);
      const states = this._connected19();
      const ids = states.filter(s => text && bfString(s.community?.sid) === text);
      return this._choose19(ids.length ? ids : states.filter(s => origin ? s.origin === origin : !text || this._bfMatchCommunity(s, text.toLowerCase())), 'server');
    },
    async _channel19(ref, server) {
      if (server) { const state = await this._bfResolveTarget(server); return { state, channel: await this._instanceChannel(state, ref) }; }
      const found = [];
      for (const state of this._connected19()) {
        const detail = await this._instanceDetailCached(state);
        const key = bfString(ref).trim(), name = key.replace(/^#/, '').toLowerCase();
        const exact = (detail.channels || []).find(c => bfString(c.cid) === key);
        for (const channel of exact ? [exact] : (detail.channels || []).filter(c => bfString(c.name).toLowerCase() === name)) found.push({ state, channel });
      }
      const ids = found.filter(target => bfString(target.channel.cid) === bfString(ref).trim());
      return this._choose19(ids.length ? ids : found, 'channel ID / name');
    },
    async _message19(id) {
      const found = [];
      for (const state of this._connected19()) {
        // IDs have no instance slot. Ask each visible channel, rather than trusting an ambiguous cache.
        const detail = await this._instanceDetailCached(state);
        for (const channel of detail.channels || []) {
          try { const message = await this._instanceMessage(state, channel, id); if (message) found.push({ state, channel, message }); }
          catch (error) { if (!/message_not_found|not.*channel|404/i.test(error.message)) throw error; }
        }
      }
      return this._choose19(found, 'message ID');
    },
    async _classic19(room) {
      if (room) return this._channel19(room);
      if (this._classicTarget19) {
        const { origin, cid } = this._classicTarget19;
        return this._channel19(cid, origin);
      }
      return this._channel19('general');
    },
    async sendGlobalMessage({ MSG }) { const { state, channel } = await this._classic19(); return this._instanceWrite(state, channel, instanceBody(MSG)); },
    async sendRoomMessage({ MSG, ROOM }) { const { state, channel } = await this._classic19(ROOM); return this._instanceWrite(state, channel, instanceBody(MSG)); },
    async getGlobalMessages() { const { state, channel } = await this._classic19(); return this.biMessages({ URL: state.origin, CHANNEL: channel.cid }); },
    async getRoomMessages({ ROOM }) { const { state, channel } = await this._classic19(ROOM); return this.biMessages({ URL: state.origin, CHANNEL: channel.cid }); },
    async joinRoom({ ROOM }) { const { state, channel } = await this._classic19(ROOM); this._classicTarget19 = { origin: state.origin, cid: channel.cid }; },
    async setTyping({ STATE }) { const { state, channel } = await this._classic19(); return this.bfTypingState({ SERVER: state.origin, CHANNEL: channel.cid, STATE }); },
    async typingUsers() { const { state, channel } = await this._classic19(); return this.chatTypingUsers({ SERVER: state.origin, CHANNEL: channel.cid }); },
    async chatJoinServer({ SERVER }) {
      const text = bfString(SERVER).trim();
      if (/#\/i\/[^/]+\/invite\//.test(text)) { const parsed = instanceParseInvite(text, ''); return this._instanceJoinInvite(parsed.origin, parsed.code); }
      if (this._bfLooksLikeInstance(text)) return this.biJoin({ URL: /^https?:/i.test(text) ? text : 'https://' + text });
      const state = await this._bfResolveTarget(SERVER);
      return this.biJoin({ URL: state.origin });
    },
    async chatTyping({ CHANNEL, SERVER }) { return this.bfTypingState({ CHANNEL, SERVER, STATE: 'on' }); },
    async bfTypingState({ CHANNEL, SERVER, STATE }) {
      const { state, channel } = await this._channel19(CHANNEL, SERVER);
      if (state.velora) this._requireScope(SCOPES.CHAT);
      state.socket.send(JSON.stringify({ type: 'chat_typing', channel: channel.cid, typing: bfString(STATE) === 'on' }));
    },
    whenChatMessage({ CHANNEL, SERVER }) {
      const state = this._instanceEvent;
      if (!state?.ready) return false;
      const target = this._channelSync19(CHANNEL, SERVER);
      return target?.state === state && bfString(state.last?.channel) === bfString(target.channel.cid);
    },
    whenAnyChatMessage() { return !!this._instanceEvent?.ready; },
    _classicHat19(room) {
      const event = this._instanceEvent;
      if (!event?.ready) return false;
      const ref = room || this._classicTarget19?.cid || 'general';
      const target = this._channelSync19(ref, !room ? this._classicTarget19?.origin : undefined);
      return target?.state === event && bfString(target.channel.cid) === bfString(event.last?.channel);
    },
    whenGlobalMessageReceived() { return this._classicHat19(); },
    whenRoomMessageReceived({ ROOM }) { return this._classicHat19(ROOM); },
    lastMessageUser() { return this._lastChatMsg?.author?.username || this._lastChatMsg?.author?.id || ''; },
    lastMessageContent() { return this._lastChatMsg?.body || ''; },
    lastMessageUserJson() { return JSON.stringify(this._lastChatMsg?.author || {}); },
  });
  // Every old raw community route uses the same Bonfire path/shape (PROTOCOL section 6).
  // Select the connected instance by sid, cid, invite origin or message ID; no implicit default with multiple instances.
  for (const spec of nativeSpecs) {
    p19[spec.opcode] = uiRoute(spec.path) ? function () { return spec.blockType === 'reporter' ? '{}' : undefined; } : async function (args = {}) {
      this._lastActionSuccess = false;
      try {
        const options = spec.body ? this._bfJson(args.OPTIONS || '{}') : null;
        let state, channel, message;
        const values = { ...args };
        if (args.SID) { state = await this._bfResolveTarget(args.SID); values.SID = state.community.sid; }
        if (args.CID || options?.cid || options?.channel) {
          const target = await this._channel19(args.CID || options.cid || options.channel, state?.origin);
          state = target.state; channel = target.channel; values.CID = channel.cid;
        }
        if (spec.path.startsWith('/chat/messages/')) { const target = await this._message19(args.ID); ({ state, channel, message } = target); }
        if (args.CODE && /#\/i\//.test(bfString(args.CODE))) { state = await this._bfResolveTarget(args.CODE); values.CODE = instanceParseInvite(args.CODE, '').code; }
        state ||= await this._bfResolveTarget(options?.sid || options?.server || '');
        if (state.velora) for (const scope of spec.scopes) this._requireScope(scope);
        if (values.USERNAME && /\/(members|bans)\//.test(spec.path)) values.USERNAME = await this._instanceMemberId(state, values.USERNAME);
        let path = spec.path.slice('/chat'.length).replace(/:(\w+)\??/g, (_, key) => encodeURIComponent(bfString(values[key.toUpperCase()]).trim()));
        if (path === '/discover') path = '/servers';
        if (spec.upload && /\/(upload|external)$/.test(path)) {
          channel ||= await this._instanceChannel(state, this._classicTarget19?.origin === state.origin ? this._classicTarget19.cid : 'general');
          if (!state.channels.has(bfString(channel.cid))) throw migrationError('Upload channel is not in the selected server');
          const attachment = await this._instanceUpload(state, channel, args.FILE, args.FILENAME);
          return JSON.stringify(attachment);
        }
        if (spec.upload) {
          if (state.velora) this._requireScope(SCOPES.MEDIA_UPLOAD);
          if (!/^(data:|blob:)/.test(bfString(args.FILE))) throw new Error('Choose a file or provide its data URI.');
          const source = await fetch(args.FILE);
          if (!source.ok) throw new Error('Could not read the file.');
          const form = new FormData(); form.append('file', await source.blob(), bfString(args.FILENAME) || 'file');
          for (const [key, value] of Object.entries(options || {})) form.append(key, typeof value === 'object' ? JSON.stringify(value) : bfString(value));
          return JSON.stringify(await this._instanceMultipart(state, path, form));
        }
        let data;
        if (spec.method === 'POST' && /\/channels\/[^/]+\/messages$/.test(path)) {
          data = await this._instanceWrite(state, channel, instanceBody(options.message ?? options.body ?? ''), options.reply_to || null, null, instanceAttachments(JSON.stringify(options.attachments || [])));
        } else if (spec.method === 'PATCH' && spec.path === '/chat/messages/:id') {
          data = await this._instanceWrite(state, channel, instanceBody(options.message ?? options.body ?? ''), message.reply_to || null, bfString(args.ID), options.attachments || message.attachments || []);
        } else {
          if (spec.query.length) { const query = this._bfJson(args.QUERY || '{}'), search = new URLSearchParams(); for (const key of spec.query) if (query[key] != null) search.set(key, bfString(query[key])); if (search.size) path += '?' + search; }
          data = await this._instanceRequest(state, path, spec.method, options);
          if (spec.method !== 'GET') { state.detailAt = 0; state.channels.clear(); }
        }
        this._lastActionSuccess = true; this._lastActionOutput = JSON.stringify(data || {});
        return this._lastActionOutput;
      } catch (error) { this._lastActionSuccess = false; this._lastActionOutput = JSON.stringify({ error: error.message }); throw error; }
    };
  }
  p19._chatServer = async function (ref) {
    const state = await this._bfResolveTarget(ref);
    if (state.velora) this._requireScope(SCOPES.CHAT);
    return { ...(await this._instanceDetailCached(state)), instance: state };
  };
  p19._bfResolveSync = function (ref) {
    try {
      const text = bfString(ref).trim(), states = this._connected19();
      let origin = null;
      if (/#\/i\/[^/]+\/invite\//.test(text)) origin = this._instanceOrigin(instanceParseInvite(text, '').origin);
      else if (this._bfLooksLikeInstance(text)) origin = this._instanceOrigin(/^https?:/i.test(text) ? text : 'https://' + text);
      const ids = states.filter(s => text && bfString(s.community?.sid) === text);
      const found = ids.length ? ids : states.filter(s => origin ? s.origin === origin : !text || this._bfMatchCommunity(s, text.toLowerCase()));
      return found.length === 1 ? found[0] : null;
    } catch { return null; }
  };
  p19._channelSync19 = function (ref, server) {
    const state = server ? this._bfResolveSync(server) : null;
    if (server && !state) return null;
    const key = bfString(ref).trim(), name = key.replace(/^#/, '').toLowerCase(), found = [];
    for (const s of state ? [state] : this._connected19()) for (const channel of s.channels.values()) {
      if (bfString(channel.cid) === key || bfString(channel.name).toLowerCase() === name) found.push({ state: s, channel });
    }
    const ids = found.filter(t => bfString(t.channel.cid) === key), matches = ids.length ? ids : found;
    return matches.length === 1 ? matches[0] : null;
  };
  p19.chatChannels = async function ({ SERVER }) { return JSON.stringify((await this._chatServer(SERVER)).channels || []); };
  p19.chatIsMember = async function ({ SERVER }) {
    const state = await this._bfResolveTarget(SERVER);
    const data = await this._instanceRequest(state, '/servers');
    return (data.servers || []).some(server => bfString(server.sid) === bfString(state.community?.sid));
  };
  p19._gameHat = function (kind, { SERVER, CHANNEL }) {
    const event = this._gameEvent19;
    if (!event || event.frame.type !== (kind === 'status' ? 'game_status' : 'game_console')) return false;
    const state = this._bfResolveSync(SERVER);
    const channel = state && this._instanceChannelSync(state, CHANNEL);
    return state === event.state && !!channel && bfString(channel.cid) === bfString(event.frame.channel);
  };
  // Nookara continues to carry identity/presence/IM/DM-call events, never community chat.
  const identityEvents19 = p19._handleWS;
  p19._handleWS = function (frame) {
    if (['globalMessage', 'roomMessage', 'globalMessages', 'roomMessages'].includes(frame.type)) return;
    if (frame.type?.startsWith('chat_') && !/^chat_(rtc_|call_|error$)/.test(frame.type)) return;
    return identityEvents19.call(this, frame);
  };
  for (const opcode of ['bfPlaySound', 'bfCloudlinkStatus', 'bfCloudlinkConnected']) p19[opcode] = function () { return opcode === 'bfCloudlinkStatus' ? '{}' : opcode === 'bfCloudlinkConnected' ? false : undefined; };
  const stop19 = p19._stopInstance;
  p19._stopInstance = function (state, ...args) {
    if (this._voiceInstance19 === state) { this._rtcLeave(); this._voiceInstance19 = null; }
    return stop19.call(this, state, ...args);
  };

  const veloraExt = new NookaraExtension(Scratch.vm.runtime);

  // the menus show plain words but keep their old values, a dropped reporter can say either
  const MENU_WORDS = { biInstanceProps: { icon: 'icon url', build: 'build id', 'build date': 'built at', accounts: 'accounts mode', 'who can join': 'join policy', 'server name': 'community name', 'server id': 'community id', plan: 'hosting plan', 'upload limit (MB)': 'max upload MB' }, bfPermissions: { 'send messages': 'SEND', 'manage channels': 'MANAGE_CHANNELS', 'manage server': 'MANAGE_SERVER', 'manage roles': 'MANAGE_ROLES', kick: 'KICK', ban: 'BAN', 'manage messages': 'MANAGE_MESSAGES', 'mention everyone': 'MENTION_EVERYONE', 'attach files': 'ATTACH', admin: 'ADMIN', view: 'VIEW' }, biLastProps: { 'bot name': 'alias name', 'bot avatar': 'alias avatar', 'bot name unmarked?': 'alias unmarked?', verified: 'server says verified' } };
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
