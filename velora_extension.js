// Nookara Scratch Extension v2.0.10 (Bonfire communities on Bonfire servers, Nookara identity + Instant Messages, status + rich presence, bot gallery)
// https://nookara.cc
(function () {
  'use strict';

  const SERVER_HTTP = 'https://nookara.cc';
  const SERVER_WS   = 'wss://nookara.cc';
  const EXT_ID      = 'velora';
  const EXTENSION_VERSION = '2.0.10';

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
  const SCOPE_NAMES = {
    1: 'View Basic Profile',
    2: 'View Sensitive Info',
    4: 'Project Auth',
    8: 'Modify Settings',
    16: 'Read Storage',
    32: 'Write Storage',
    64: 'Read Instant Messages',
    128: 'Send Instant Messages',
    256: 'View Friends',
    512: 'Manage Friends',
    1024: 'Spend Credits',
    2048: 'Chat Messaging',
    4096: 'Upload Media',
    8192: 'View Subscriptions',
    16384: 'Nookara Voice',
    32768: 'Sign Messages',
  };
  // "is [service] disabled by an admin?" - the scope bits behind each service
  const SERVICE_BITS = {
    'instant messages': 64 | 128, 'group chat': 2048, 'voice': 16384, 'storage': 16 | 32,
    'media uploads': 4096, 'friends': 256 | 512, 'credits': 1024 | 8192, 'profile editing': 8,
  };
  // Nookara Voice audio: raw 16-bit mono PCM @ 16 kHz, ~32 ms chunks (same as the voice server)
  const V_RATE = 16000;
  const V_CHUNK = 512;

  class VeloraExtension {
    constructor(runtime) {
      this.runtime = runtime;
      this._instances = new Map();
      this._instanceURLs = new Set();
      this._instanceEvent = null;
      this._instanceSigningKey = null;
      this._instanceSigningToken = null;
      runtime.on?.('PROJECT_LOADED', () => { this._restoreInstances(); });
      runtime.on?.('RUNTIME_DISPOSED', () => { this._disposeInstances(); });
      this._token = null;
      this._grantedScopes = 0;
      this._user = null;
      this._ws = null;
      this._wsReady = false;
      this._storageId = null;
      this._accountObj = {};
      this._friends = [];
      this._friendRequests = [];
      this._mail = [];
      // Instant Messages
      this._lastIM = null;           // last message that came in
      this._lastIMDelivered = false; // did our last sent message land live (recipient online)?
      this._imUnread = 0;
      this._imNonce = 0;
      this._imPending = new Map();   // nonce -> { resolve, reject } for im_send over the socket
      this._evtIMReceived = false;
      this._evtIMFromMap = {};
      this._wsAuthed = false;
      this._badges = [];
      this._callData = {};
      this._username = '';
      // services an admin switched off for this account (users.disabled_scopes)
      this._disabledScopes = 0;
      // achievements
      this._achievements = {};
      this._lastAchievement = null;
      this._evtAchievement = false;
      // Nookara Voice - voice rooms over the Nookara socket (see the Nookara Voice section)
      this._v = this._vFresh();
      this._rtc = null; // Cloudflare SFU state for Nookara bf_/bfc_ rooms
      this._vAudio = null;
      this._vMaster = null;
      this._vGains = new Map();
      this._vQueues = new Map();
      this._vSilence = new Map();
      this._vMicStream = null;
      this._vMicSrc = null;
      this._vProc = null;
      this._vMicOn = false;
      this._vMyVol = 0;
      this._vThreshold = 5;
      this._vGlobal = 100;
      this._vUserSettings = new Map(); // name -> { volume, muted }
      this._vVolTimer = null;
      this._vJoinQ = []; this._vLeaveQ = []; this._vJoinFlip = false; this._vLeaveFlip = false;
      this._vEventUser = '';
      // calls into voice rooms
      this._vCall = null;        // someone calling me: { callId, from, room }
      this._evtVoiceCalled = false;
      this._vOutCall = null;     // me calling someone: { callId, to }
      this._vCallResult = '';
      this._evtVoiceAnswered = false;

      this._authenticated = false;
      this._connected = false;
      this._intentionalDisconnect = false;
      this._loginInProgress = false;
      this._cancelPendingLogin = null;

      // Event queues for hat blocks
      this._evtConnected = false;
      this._evtDisconnected = false;
      this._evtAuthenticated = false;
      this._lastAuthResult = null;
      this._evtAccountUpdated = false;
      this._evtUserUpdated = false;
      this._lastUserUpdate = null;
      this._evtMailReceived = false;
      this._evtFriendRequest = false;
      this._evtFriendAccepted = false;
      this._evtUserJoined = false;
      this._evtUserLeft = false;
      this._evtCallIncoming = false;
      this._evtBalanceChanged = false;
      this._lastUserJoined = '';
      this._lastUserLeft = '';

      // Global chat / room state
      this._globalMessages = [];
      this._roomMessages   = {};
      this._typingUsers    = [];
      this._onlinePlayers  = [];
      this._status = 'online';

      // Message event tracking
      this._evtGlobalMsg = false;
      this._evtRoomMsgMap = {};
      // Bonfire: community state (communities live on Bonfire servers - see the Bonfire section at the end), presence
      this._chatServers = null;      // my servers (list), refreshed by myServers / join / leave
      this._chatDetail = {};         // server ref (lowercase) -> { server, channels }
      this._chatMsgs = {};           // cid -> newest 100 messages
      this._chatEvt = {};            // cid / 'server/channel' / '*' -> hat flag
      this._lastChatMsg = null;
      this._chatTyping = {};         // cid -> { username: until }
      this._presence = {};           // username (lowercase) -> presence
      this._presenceEvt = {};        // username (lowercase) / '*' -> hat flag
      this._lastPresenceUser = '';
      this._rich = null;             // my rich presence (sent again after reconnects)
      this._lastMsg = null;

      // Upload state
      this._uploadStatus = 'idle';
      this._lastUploadUrl = '';
      this._uploadProgress = 0;

      // Verbose state
      this._lastActionOutput = '';
      this._lastActionSuccess = false;

      // Login history
      this._loginHistory = [];
      this._evtNewLogin = false;
      this._knownLoginCount = -1;

      // Notifications
      this._notifications = [];
      this._evtNotification = false;
      this._lastNotifTitle = '';
      this._lastNotifBody = '';
      this._notifInterval = null;

      // File picker state
      this._selectedFile = null;
      this._selectedFileUrl = '';
      this._selectedFileName = '';
      this._selectedFileSize = 0;
      this._fileSelected = false;

      // User lookup
      this._lookedUpUser = {};
      this._lookedUpHF = {};
    }

    getInfo() {
      return {
        id: EXT_ID,
        name: 'Nookara',
        color1: '#7c3aed',
        color2: '#5b21b6',
        color3: '#4c1d95',
        blocks: [

          // connection stuff
          { blockType: Scratch.BlockType.LABEL, text: 'Connection' },
          { opcode: 'whenConnected',    blockType: Scratch.BlockType.HAT,     text: 'when connected to server' },
          { opcode: 'whenDisconnected', blockType: Scratch.BlockType.HAT,     text: 'when disconnected from server' },
          { opcode: 'serverOnline',     blockType: Scratch.BlockType.BOOLEAN, text: "Nookara service available?" },
          { opcode: 'isConnected',      blockType: Scratch.BlockType.BOOLEAN, text: "Nookara connection active?" },

          // the login popup dance. see openLoginPrompt below for the fun bit
          { blockType: Scratch.BlockType.LABEL, text: 'Authentication' },
          { func: 'openAppsPage', blockType: Scratch.BlockType.BUTTON, text: 'Create an App' },
          { func: 'openGuides', blockType: Scratch.BlockType.BUTTON, text: 'View Guides' },
          { opcode: 'openAppLogin', blockType: Scratch.BlockType.COMMAND, text: 'sign in to Nookara with app [APP_ID]', arguments: { APP_ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'app id' } } },
          { opcode: 'openLoginPrompt', hideFromPalette: true, blockType: Scratch.BlockType.COMMAND, text: 'sign in to Nookara for [PROJECT_NAME] with permissions [PERMISSIONS]', arguments: { PROJECT_NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'My Project' }, PERMISSIONS: { type: Scratch.ArgumentType.STRING, defaultValue: '5' } } },
          { opcode: 'loginWithToken',   blockType: Scratch.BlockType.COMMAND, text: 'login with token [TOKEN]', arguments: { TOKEN: { type: Scratch.ArgumentType.STRING, defaultValue: '' } } },
          { opcode: 'logout',           blockType: Scratch.BlockType.COMMAND, text: 'logout' },
          { opcode: 'currentToken',     blockType: Scratch.BlockType.REPORTER,text: "active session token" },
          { opcode: 'isLoginOpen',      blockType: Scratch.BlockType.BOOLEAN, text: "account approval window open?" },
          { opcode: 'serviceDisabled',  blockType: Scratch.BlockType.BOOLEAN, text: "administrator has paused [SERVICE]?", arguments: { SERVICE: { type: Scratch.ArgumentType.STRING, menu: 'serviceMenu', defaultValue: 'voice' } } },
          { opcode: 'authResult',       blockType: Scratch.BlockType.BOOLEAN, text: "authentication outcome is [RESULT]?",
            arguments: { RESULT: { type: Scratch.ArgumentType.STRING, menu: 'authResultMenu', defaultValue: 'successful' } } },
          { opcode: 'whenAuthenticated',blockType: Scratch.BlockType.HAT,     text: 'when authenticated' },

          // acc info
          { blockType: Scratch.BlockType.LABEL, text: 'Your Nookara Account' },
          { opcode: 'getAccountKey',    blockType: Scratch.BlockType.REPORTER,text: "account detail [KEY]",
            arguments: { KEY: { type: Scratch.ArgumentType.STRING, menu: 'accountKeys', defaultValue: 'username' } } },
          { opcode: 'keyExists',        blockType: Scratch.BlockType.BOOLEAN, text: "account detail [KEY] available?",
            arguments: { KEY: { type: Scratch.ArgumentType.STRING, menu: 'accountKeys', defaultValue: 'username' } } },
          { opcode: 'getAllKeys',        blockType: Scratch.BlockType.REPORTER,text: "available account details" },
          { opcode: 'getAllValues',      blockType: Scratch.BlockType.REPORTER,text: "account detail contents" },
          { opcode: 'getAccountObject', blockType: Scratch.BlockType.REPORTER,text: "complete account data as JSON" },
          { opcode: 'isUserBanned',     blockType: Scratch.BlockType.BOOLEAN, text: "account access suspended?" },
          { opcode: 'whenAccountUpdated',blockType: Scratch.BlockType.HAT,     text: 'when account updated' },
          { opcode: 'whenUserUpdated',   blockType: Scratch.BlockType.HAT,     text: 'when a user updates their profile' },
          { opcode: 'lastUserUpdate',    blockType: Scratch.BlockType.REPORTER,text: 'latest profile update as JSON' },

          // pfp n stuff
          { blockType: Scratch.BlockType.LABEL, text: 'Profile' },
          { opcode: 'uploadPfp',    blockType: Scratch.BlockType.COMMAND, text: 'upload image [DATA_URI] as profile picture and [MODE]', arguments: { DATA_URI: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, MODE: { type: Scratch.ArgumentType.STRING, menu: 'uploadModeMenu', defaultValue: 'wait' } } },
          { opcode: 'setChatColor', blockType: Scratch.BlockType.COMMAND, text: 'set chat color to [COLOR]', arguments: { COLOR: { type: Scratch.ArgumentType.STRING, defaultValue: '#c084fc' } } },
          { opcode: 'setPronouns', blockType: Scratch.BlockType.COMMAND, text: 'set my pronouns to [PRONOUNS]', arguments: { PRONOUNS: { type: Scratch.ArgumentType.STRING, defaultValue: 'she/her' } } },
          // display names: shown instead of the username (1-32 characters, empty clears it; mentions still use the username)
          { opcode: 'setDisplayName', blockType: Scratch.BlockType.COMMAND, text: 'set my display name to [NAME]', arguments: { NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'Nat' } } },

          // per-project save data, scoped to whoever's logged in so ppl cant mess with each others stuff
          { blockType: Scratch.BlockType.LABEL, text: 'Data Storage' },
          { opcode: 'setStorageId',     blockType: Scratch.BlockType.COMMAND, text: 'set storage ID to [ID]', arguments: { ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'myProject' } } },
          { opcode: 'storageIdSet',     blockType: Scratch.BlockType.BOOLEAN, text: "project storage selected?" },
          { opcode: 'getStorageId',     blockType: Scratch.BlockType.REPORTER,text: "selected storage name" },
          { opcode: 'getStorage',       blockType: Scratch.BlockType.REPORTER,text: "stored entry [KEY]", arguments: { KEY: { type: Scratch.ArgumentType.STRING, defaultValue: 'score' } } },
          { opcode: 'setStorage',       blockType: Scratch.BlockType.COMMAND, text: 'set key [KEY] to [VALUE] in storage', arguments: { KEY: { type: Scratch.ArgumentType.STRING, defaultValue: 'score' }, VALUE: { type: Scratch.ArgumentType.STRING, defaultValue: '0' } } },
          { opcode: 'storageKeyExists', blockType: Scratch.BlockType.BOOLEAN, text: "storage contains entry [KEY]?", arguments: { KEY: { type: Scratch.ArgumentType.STRING, defaultValue: 'score' } } },
          { opcode: 'deleteStorageKey', blockType: Scratch.BlockType.COMMAND, text: 'delete key [KEY] from storage', arguments: { KEY: { type: Scratch.ArgumentType.STRING, defaultValue: 'score' } } },
          { opcode: 'getAllStorageKeys',  blockType: Scratch.BlockType.REPORTER,text: "saved entry names" },
          { opcode: 'getAllStorageValues',blockType: Scratch.BlockType.REPORTER,text: "saved entry contents" },
          { opcode: 'clearStorage',     blockType: Scratch.BlockType.COMMAND, text: 'clear storage' },

          // how full ur storage is, if u care
          { blockType: Scratch.BlockType.LABEL, text: 'Storage Information' },
          { opcode: 'storageUsage',     blockType: Scratch.BlockType.REPORTER,text: "saved data size" },
          { opcode: 'storageLimit',     blockType: Scratch.BlockType.REPORTER,text: "account storage capacity" },
          { opcode: 'storageRemaining', blockType: Scratch.BlockType.REPORTER,text: "available storage space" },
          { opcode: 'storageBiggest',   blockType: Scratch.BlockType.REPORTER,text: "saved entries ranked by size" },

          // live chatroom stuff, sends over the websocket (only people online right now see it)
          { blockType: Scratch.BlockType.LABEL, text: 'Chatroom Messaging' },
          { opcode: 'sendGlobalMessage',blockType: Scratch.BlockType.COMMAND, text: 'send global message [MSG]', arguments: { MSG: { type: Scratch.ArgumentType.STRING, defaultValue: 'Hello!' } } },
          { opcode: 'getGlobalMessages',blockType: Scratch.BlockType.REPORTER,text: 'global messages' },
          { opcode: 'sendRoomMessage',  blockType: Scratch.BlockType.COMMAND, text: 'send [MSG] in room [ROOM]', arguments: { MSG: { type: Scratch.ArgumentType.STRING, defaultValue: 'Hello!' }, ROOM: { type: Scratch.ArgumentType.STRING, defaultValue: 'general' } } },
          { opcode: 'getRoomMessages',  blockType: Scratch.BlockType.REPORTER,text: 'messages in room [ROOM]', arguments: { ROOM: { type: Scratch.ArgumentType.STRING, defaultValue: 'general' } } },
          { opcode: 'joinRoom',         blockType: Scratch.BlockType.COMMAND, text: 'join room [ROOM]', arguments: { ROOM: { type: Scratch.ArgumentType.STRING, defaultValue: 'general' } } },
          { opcode: 'setTyping',        blockType: Scratch.BlockType.COMMAND, text: 'set typing [STATE]', arguments: { STATE: { type: Scratch.ArgumentType.STRING, menu: 'onOff', defaultValue: 'on' } } },
          { opcode: 'typingUsers',      blockType: Scratch.BlockType.REPORTER,text: 'typing users' },

          // hats that fire when chatroom messages come in
          { opcode: 'whenGlobalMessageReceived', blockType: Scratch.BlockType.HAT, text: 'when global chat message received' },
          { opcode: 'whenRoomMessageReceived',   blockType: Scratch.BlockType.HAT, text: 'when message in room [ROOM] received',
            arguments: { ROOM: { type: Scratch.ArgumentType.STRING, defaultValue: 'general' } } },
          { opcode: 'lastMessageUser',    blockType: Scratch.BlockType.REPORTER, text: 'last message user' },
          { opcode: 'lastMessageContent', blockType: Scratch.BlockType.REPORTER, text: 'last message content' },
          { opcode: 'lastMessageUserJson',blockType: Scratch.BlockType.REPORTER, text: 'last message user JSON' },

          // Bonfire (nookara.cc/chat): communities live on Bonfire servers (one community each). [SERVER] is a
          // server URL or the name / id of a community on a server you're connected to; channels go by name or id.
          { blockType: Scratch.BlockType.LABEL, text: 'Servers & Channels' },
          { opcode: 'chatMyServers',     blockType: Scratch.BlockType.REPORTER, text: "joined communities as JSON" },
          { opcode: 'chatJoinServer',    blockType: Scratch.BlockType.COMMAND,  text: 'join server [SERVER]', arguments: { SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 'invite code or server ID' } } },
          { opcode: 'chatLeaveServer',   blockType: Scratch.BlockType.COMMAND,  text: 'leave server [SERVER]', arguments: { SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 'server ID' } } },
          { opcode: 'chatChannels',      blockType: Scratch.BlockType.REPORTER, text: "channel directory for [SERVER] as JSON", arguments: { SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 'Velora' } } },
          { opcode: 'chatMembers',       blockType: Scratch.BlockType.REPORTER, text: "member directory for [SERVER] as JSON", arguments: { SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 'Velora' } } },
          { opcode: 'chatOnlineMembers', blockType: Scratch.BlockType.REPORTER, text: "active member directory for [SERVER] as JSON", arguments: { SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 'Velora' } } },
          { opcode: 'chatIsMember',      blockType: Scratch.BlockType.BOOLEAN,  text: "membership active in [SERVER]?", arguments: { SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 'Velora' } } },
          '---',
          { opcode: 'chatSend',          blockType: Scratch.BlockType.COMMAND,  text: 'send [MSG] in channel [CHANNEL] of server [SERVER]', arguments: { MSG: { type: Scratch.ArgumentType.STRING, defaultValue: 'Hello!' }, CHANNEL: { type: Scratch.ArgumentType.STRING, defaultValue: 'general' }, SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 'Velora' } } },
          { opcode: 'chatMessages',      blockType: Scratch.BlockType.REPORTER, text: "channel history for [CHANNEL] in [SERVER] as JSON", arguments: { CHANNEL: { type: Scratch.ArgumentType.STRING, defaultValue: 'general' }, SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 'Velora' } } },
          { opcode: 'chatChannelLocked', blockType: Scratch.BlockType.BOOLEAN,  text: "posting locked in [CHANNEL] of [SERVER]?", arguments: { CHANNEL: { type: Scratch.ArgumentType.STRING, defaultValue: 'announcements' }, SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 'Velora' } } },
          { opcode: 'chatCanPost',       blockType: Scratch.BlockType.BOOLEAN,  text: "posting allowed in [CHANNEL] of [SERVER]?", arguments: { CHANNEL: { type: Scratch.ArgumentType.STRING, defaultValue: 'general' }, SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 'Velora' } } },
          { opcode: 'whenChatMessage',   blockType: Scratch.BlockType.HAT,      text: 'when message received in channel [CHANNEL] of server [SERVER]', arguments: { CHANNEL: { type: Scratch.ArgumentType.STRING, defaultValue: 'general' }, SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 'Velora' } } },
          { opcode: 'whenAnyChatMessage',blockType: Scratch.BlockType.HAT,      text: 'when a message is received in any channel' },
          { opcode: 'chatLastMessage',   blockType: Scratch.BlockType.REPORTER, text: "latest channel post: [PROP]", arguments: { PROP: { type: Scratch.ArgumentType.STRING, menu: 'chatMsgProps', defaultValue: 'text' } } },
          { opcode: 'chatTyping',        blockType: Scratch.BlockType.COMMAND,  text: 'show me typing in channel [CHANNEL] of server [SERVER]', arguments: { CHANNEL: { type: Scratch.ArgumentType.STRING, defaultValue: 'general' }, SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 'Velora' } } },
          { opcode: 'chatTypingUsers',   blockType: Scratch.BlockType.REPORTER, text: "typing activity for [CHANNEL] in [SERVER] as JSON", arguments: { CHANNEL: { type: Scratch.ArgumentType.STRING, defaultValue: 'general' }, SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 'Velora' } } },

          // what you're doing, shown under your name in Nookara Chat + on your profile
          { blockType: Scratch.BlockType.LABEL, text: 'Status & Rich Presence' },
          { opcode: 'rpSet',             blockType: Scratch.BlockType.COMMAND,  text: 'set activity: [TYPE] [NAME] details [DETAILS] state [STATE]', arguments: { TYPE: { type: Scratch.ArgumentType.STRING, menu: 'activityTypes', defaultValue: 'playing' }, NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'my game' }, DETAILS: { type: Scratch.ArgumentType.STRING, defaultValue: 'Level 1' }, STATE: { type: Scratch.ArgumentType.STRING, defaultValue: 'In a match' } } },
          { opcode: 'rpImage',           blockType: Scratch.BlockType.COMMAND,  text: 'set activity picture to [URL]', arguments: { URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://' } } },
          { opcode: 'rpClear',           blockType: Scratch.BlockType.COMMAND,  text: 'clear activity' },
          { opcode: 'rpCustom',          blockType: Scratch.BlockType.COMMAND,  text: 'set custom status to [TEXT]', arguments: { TEXT: { type: Scratch.ArgumentType.STRING, defaultValue: 'making games' } } },
          { opcode: 'rpPresence',        blockType: Scratch.BlockType.REPORTER, text: "[USER] presence details as JSON", arguments: { USER: { type: Scratch.ArgumentType.STRING, defaultValue: 'username' } } },
          { opcode: 'rpIsMobile',        blockType: Scratch.BlockType.BOOLEAN,  text: "[USER] connected from a mobile device?", arguments: { USER: { type: Scratch.ArgumentType.STRING, defaultValue: 'username' } } },
          { opcode: 'rpIsConsole',       blockType: Scratch.BlockType.BOOLEAN,  text: "[USER] connected from a console?", arguments: { USER: { type: Scratch.ArgumentType.STRING, defaultValue: 'username' } } },
          { opcode: 'rpIsAutoIdle',      blockType: Scratch.BlockType.BOOLEAN,  text: "[USER] marked idle automatically?", arguments: { USER: { type: Scratch.ArgumentType.STRING, defaultValue: 'username' } } },
          { opcode: 'rpStatusOf',        blockType: Scratch.BlockType.REPORTER, text: "[USER] availability", arguments: { USER: { type: Scratch.ArgumentType.STRING, defaultValue: 'username' } } },
          { opcode: 'rpActivityOf',      blockType: Scratch.BlockType.REPORTER, text: "[USER] shared activity", arguments: { USER: { type: Scratch.ArgumentType.STRING, defaultValue: 'username' } } },
          { opcode: 'whenPresenceChanges', blockType: Scratch.BlockType.HAT,    text: 'when [USER] changes status or activity', arguments: { USER: { type: Scratch.ArgumentType.STRING, defaultValue: 'anyone' } } },
          { opcode: 'rpLastUser',        blockType: Scratch.BlockType.REPORTER, text: "account from latest presence update" },

          // info about ur own client, not the account
          { blockType: Scratch.BlockType.LABEL, text: 'Client Information' },
          { opcode: 'clientUsername',   blockType: Scratch.BlockType.REPORTER,text: "connected client name" },
          { opcode: 'myClientObject',   blockType: Scratch.BlockType.REPORTER,text: "connected client details" },

          // whos online rn
          { blockType: Scratch.BlockType.LABEL, text: 'Users' },
          { opcode: 'connectedUsers',   blockType: Scratch.BlockType.REPORTER,text: "active connection list" },
          { opcode: 'setStatus',        blockType: Scratch.BlockType.COMMAND, text: 'set status to [STATUS]', arguments: { STATUS: { type: Scratch.ArgumentType.STRING, menu: 'statusMenu', defaultValue: 'online' } } },
          { opcode: 'isUserConnected',  blockType: Scratch.BlockType.BOOLEAN, text: "connection active for [USER]?", arguments: { USER: { type: Scratch.ArgumentType.STRING, defaultValue: 'username' } } },
          { opcode: 'whenUserJoins',    blockType: Scratch.BlockType.HAT,     text: 'when a user connects' },
          { opcode: 'whenUserLeaves',   blockType: Scratch.BlockType.HAT,     text: 'when a user disconnects' },
          { opcode: 'lastUserJoined',   blockType: Scratch.BlockType.REPORTER,text: "most recent connection arrival" },
          { opcode: 'lastUserLeft',     blockType: Scratch.BlockType.REPORTER,text: "most recent connection departure" },

          // private DMs. goes over the websocket when the other person is online,
          // otherwise over https and it waits in the db until they come back
          { blockType: Scratch.BlockType.LABEL, text: 'DMs (Works offline)' },
          { opcode: 'sendIM',           blockType: Scratch.BlockType.COMMAND, text: 'send instant message to [TO] [MSG]', arguments: { TO: { type: Scratch.ArgumentType.STRING, defaultValue: 'username' }, MSG: { type: Scratch.ArgumentType.STRING, defaultValue: 'hii!' } } },
          { opcode: 'replyToStatus',    blockType: Scratch.BlockType.COMMAND, text: "reply to [TO]'s status with [MSG]", arguments: { TO: { type: Scratch.ArgumentType.STRING, defaultValue: 'username' }, MSG: { type: Scratch.ArgumentType.STRING, defaultValue: 'same!' } } },
          { opcode: 'canReplyToStatus', blockType: Scratch.BlockType.BOOLEAN, text: "status replies allowed for [USER]?", arguments: { USER: { type: Scratch.ArgumentType.STRING, defaultValue: 'username' } } },
          { opcode: 'whenIMReceived',   blockType: Scratch.BlockType.HAT,     text: 'when instant message received' },
          { opcode: 'whenIMReceivedFrom', blockType: Scratch.BlockType.HAT,   text: 'when instant message received from [USER]', arguments: { USER: { type: Scratch.ArgumentType.STRING, defaultValue: 'username' } } },
          { opcode: 'lastIMSender',     blockType: Scratch.BlockType.REPORTER,text: "sender of latest direct message" },
          { opcode: 'lastIMContent',    blockType: Scratch.BlockType.REPORTER,text: "text of latest direct message" },
          { opcode: 'lastIMJson',       blockType: Scratch.BlockType.REPORTER,text: "latest direct message data as JSON" },
          { opcode: 'lastIMStatusReply', blockType: Scratch.BlockType.REPORTER,text: "status referenced by latest direct message" },
          { opcode: 'lastIMDelivered',  blockType: Scratch.BlockType.BOOLEAN, text: "latest direct message delivered immediately?" },
          { opcode: 'getIMThread',      blockType: Scratch.BlockType.REPORTER,text: "direct message history with [USER] as JSON", arguments: { USER: { type: Scratch.ArgumentType.STRING, defaultValue: 'username' } } },
          { opcode: 'getIMConversations', blockType: Scratch.BlockType.REPORTER, text: "direct message threads as JSON" },
          { opcode: 'getIMUnread',      blockType: Scratch.BlockType.REPORTER,text: "unread direct message total" },
          { opcode: 'markIMRead',       blockType: Scratch.BlockType.COMMAND, text: 'mark messages from [USER] as read', arguments: { USER: { type: Scratch.ArgumentType.STRING, defaultValue: 'username' } } },
          { opcode: 'deleteIM',         blockType: Scratch.BlockType.COMMAND, text: 'delete instant message with id [ID]', arguments: { ID: { type: Scratch.ArgumentType.NUMBER, defaultValue: 0 } } },

          // old vMail blocks - hidden, but still here so existing projects load + run
          { opcode: 'whenMailReceived', blockType: Scratch.BlockType.HAT,     text: 'when vMail received', hideFromPalette: true },
          { opcode: 'sendMail',         blockType: Scratch.BlockType.COMMAND, text: 'send vMail to [TO] subject [SUBJECT] message [MSG]', hideFromPalette: true, arguments: { TO: { type: Scratch.ArgumentType.STRING, defaultValue: 'username' }, SUBJECT: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, MSG: { type: Scratch.ArgumentType.STRING, defaultValue: 'Message here' } } },
          { opcode: 'getMailList',      blockType: Scratch.BlockType.REPORTER,text: "legacy inbox entries", hideFromPalette: true },
          { opcode: 'getMailBody',      blockType: Scratch.BlockType.REPORTER,text: "legacy inbox entry [N] text", hideFromPalette: true, arguments: { N: { type: Scratch.ArgumentType.NUMBER, defaultValue: 1 } } },
          { opcode: 'deleteMail',       blockType: Scratch.BlockType.COMMAND, text: 'delete vMail at index [N]', hideFromPalette: true, arguments: { N: { type: Scratch.ArgumentType.NUMBER, defaultValue: 1 } } },
          { opcode: 'deleteAllMail',    blockType: Scratch.BlockType.COMMAND, text: 'delete all vMail', hideFromPalette: true },

          // friends list stuff
          { blockType: Scratch.BlockType.LABEL, text: 'Your Nookara Circle' },
          { opcode: 'getFriendsList',   blockType: Scratch.BlockType.REPORTER,text: "friend directory" },
          { opcode: 'sendFriendRequest',blockType: Scratch.BlockType.COMMAND, text: 'send friend request to [USER]', arguments: { USER: { type: Scratch.ArgumentType.STRING, defaultValue: 'username' } } },
          { opcode: 'acceptFriendReq',  blockType: Scratch.BlockType.COMMAND, text: 'approve [USER] as a Nookara friend', arguments: { USER: { type: Scratch.ArgumentType.STRING, defaultValue: 'username' } } },
          { opcode: 'declineFriendReq', blockType: Scratch.BlockType.COMMAND, text: 'decline friend request from [USER]', arguments: { USER: { type: Scratch.ArgumentType.STRING, defaultValue: 'username' } } },
          { opcode: 'removeFriend',     blockType: Scratch.BlockType.COMMAND, text: 'remove friend [USER]', arguments: { USER: { type: Scratch.ArgumentType.STRING, defaultValue: 'username' } } },
          { opcode: 'whenFriendRequest',blockType: Scratch.BlockType.HAT,     text: 'when friend request received' },
          { opcode: 'whenFriendAccepted',blockType: Scratch.BlockType.HAT,     text: 'when friend request accepted' },
          { opcode: 'cancelFriendRequest', blockType: Scratch.BlockType.COMMAND, text: 'cancel friend request to [USER]', arguments: { USER: { type: Scratch.ArgumentType.STRING, defaultValue: 'username' } } },
          { opcode: 'getFriendRequests',blockType: Scratch.BlockType.REPORTER,text: "pending friendship invitations" },
          { opcode: 'getFriendStatus',  blockType: Scratch.BlockType.REPORTER,text: "friendship state with [USER]", arguments: { USER: { type: Scratch.ArgumentType.STRING, defaultValue: 'username' } } },
          { opcode: 'getFriendCount',   blockType: Scratch.BlockType.REPORTER,text: "number of friends" },
          { opcode: 'blockUser',        blockType: Scratch.BlockType.COMMAND, text: 'block user [USER]', arguments: { USER: { type: Scratch.ArgumentType.STRING, defaultValue: 'username' } } },
          { opcode: 'unblockUser',      blockType: Scratch.BlockType.COMMAND, text: 'unblock user [USER]', arguments: { USER: { type: Scratch.ArgumentType.STRING, defaultValue: 'username' } } },
          { opcode: 'getBlockedUsers',  blockType: Scratch.BlockType.REPORTER,text: 'blocked users (JSON)' },
          { opcode: 'isUserBlocked',    blockType: Scratch.BlockType.BOOLEAN, text: 'is [USER] blocked?', arguments: { USER: { type: Scratch.ArgumentType.STRING, defaultValue: 'username' } } },
          { opcode: 'setDmPrivacy',     blockType: Scratch.BlockType.COMMAND, text: 'set who can DM me to [WHO]', arguments: { WHO: { type: Scratch.ArgumentType.STRING, menu: 'dmPrivacyOptions', defaultValue: 'everyone' } } },
          { opcode: 'getDmPrivacy',     blockType: Scratch.BlockType.REPORTER,text: 'who can DM me' },

          // Ember's Inbox: mentions across my servers, saved messages, translate
          { blockType: Scratch.BlockType.LABEL, text: 'Inbox, Saved Messages & Translate' },
          { opcode: 'inboxMentions',    blockType: Scratch.BlockType.REPORTER,text: "my recent mentions as JSON (limit [LIMIT] before message [BEFORE])", arguments: { LIMIT: { type: Scratch.ArgumentType.NUMBER, defaultValue: 30 }, BEFORE: { type: Scratch.ArgumentType.STRING, defaultValue: '' } } },
          { opcode: 'savedMessages',    blockType: Scratch.BlockType.REPORTER,text: "saved messages as JSON (limit [LIMIT] before saved id [BEFORE])", arguments: { LIMIT: { type: Scratch.ArgumentType.NUMBER, defaultValue: 50 }, BEFORE: { type: Scratch.ArgumentType.STRING, defaultValue: '' } } },
          { opcode: 'saveMessage',      blockType: Scratch.BlockType.COMMAND, text: 'save [KIND] message [ID]', arguments: { KIND: { type: Scratch.ArgumentType.STRING, menu: 'savedKinds', defaultValue: 'channel' }, ID: { type: Scratch.ArgumentType.STRING, defaultValue: '' } } },
          { opcode: 'saveGroupMessage', blockType: Scratch.BlockType.COMMAND, text: 'save group message from JSON [SNAPSHOT]', arguments: { SNAPSHOT: { type: Scratch.ArgumentType.STRING, defaultValue: '{"room":"grp_","room_name":"","user":"","message":"","created_at":0,"id":""}' } } },
          { opcode: 'unsaveMessage',    blockType: Scratch.BlockType.COMMAND, text: 'unsave saved message [SAVEDID]', arguments: { SAVEDID: { type: Scratch.ArgumentType.STRING, defaultValue: '' } } },
          { opcode: 'savedIdOfMessage', blockType: Scratch.BlockType.REPORTER,text: "saved id of [KIND] message [ID] (empty if not saved)", arguments: { KIND: { type: Scratch.ArgumentType.STRING, menu: 'savedKinds', defaultValue: 'channel' }, ID: { type: Scratch.ArgumentType.STRING, defaultValue: '' } } },
          { opcode: 'translateText',    blockType: Scratch.BlockType.REPORTER,text: "translate [TEXT] to [LANG]", arguments: { TEXT: { type: Scratch.ArgumentType.STRING, defaultValue: 'Bonjour!' }, LANG: { type: Scratch.ArgumentType.STRING, defaultValue: 'en' } } },

          // Ember Beta: early Ember versions are for people with a running Ember Beta membership
          { blockType: Scratch.BlockType.LABEL, text: 'Ember Beta' },
          { opcode: 'emberBetaStatus',  blockType: Scratch.BlockType.REPORTER,text: "Ember Beta status as JSON" },
          { opcode: 'hasEmberBeta',     blockType: Scratch.BlockType.BOOLEAN, text: "do I have Ember Beta?" },

          // money!!! 
          { blockType: Scratch.BlockType.LABEL, text: 'Currency' },
          { opcode: 'getBalance',       blockType: Scratch.BlockType.REPORTER,text: "available credits" },
          { opcode: 'transferCredits',  blockType: Scratch.BlockType.COMMAND, text: 'transfer [AMOUNT] credits to [USER]', arguments: { AMOUNT: { type: Scratch.ArgumentType.NUMBER, defaultValue: 10 }, USER: { type: Scratch.ArgumentType.STRING, defaultValue: 'username' } } },
          { opcode: 'whenBalanceChanged',blockType: Scratch.BlockType.HAT,     text: 'when balance changed' },
          { opcode: 'getTransactions',  blockType: Scratch.BlockType.REPORTER,text: "credit activity history" },
          { opcode: 'subscribe',        blockType: Scratch.BlockType.COMMAND, text: 'subscribe [AMOUNT] to [USER] every [PERIOD] with note [NOTE]', arguments: { AMOUNT: { type: Scratch.ArgumentType.NUMBER, defaultValue: 5 }, USER: { type: Scratch.ArgumentType.STRING, defaultValue: 'username' }, PERIOD: { type: Scratch.ArgumentType.STRING, menu: 'periodMenu', defaultValue: 'monthly' }, NOTE: { type: Scratch.ArgumentType.STRING, defaultValue: '' } } },
          { opcode: 'cancelSubscription',blockType: Scratch.BlockType.COMMAND, text: 'cancel subscription to [USER]', arguments: { USER: { type: Scratch.ArgumentType.STRING, defaultValue: 'username' } } },
          { opcode: 'getOutgoingSubs',  blockType: Scratch.BlockType.REPORTER,text: "recurring credits sent" },
          { opcode: 'getIncomingSubs',  blockType: Scratch.BlockType.REPORTER,text: "recurring credits received" },

          { blockType: Scratch.BlockType.LABEL, text: 'Products and checkout' },
          { opcode: 'addProductToCart', blockType: Scratch.BlockType.COMMAND, text: 'add [QUANTITY] of product [ID] to cart', arguments: { QUANTITY: { type: Scratch.ArgumentType.NUMBER, defaultValue: 1 }, ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'prod_...' } } },
          { opcode: 'addMembershipToCart', blockType: Scratch.BlockType.COMMAND, text: 'add membership [ID] to cart on [PLAN] plan', arguments: { ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'prod_...' }, PLAN: { type: Scratch.ArgumentType.STRING, menu: 'productPlan', defaultValue: 'regular' } } },
          { opcode: 'addPaymentToCart', blockType: Scratch.BlockType.COMMAND, text: 'add payment of [AMOUNT] credits to [USER] to cart with note [NOTE]', arguments: { AMOUNT: { type: Scratch.ArgumentType.NUMBER, defaultValue: 10 }, USER: { type: Scratch.ArgumentType.STRING, defaultValue: 'username' }, NOTE: { type: Scratch.ArgumentType.STRING, defaultValue: '' } } },
          { opcode: 'openCheckout', blockType: Scratch.BlockType.COMMAND, text: 'open checkout and wait' },
          { opcode: 'buyProductDirect', blockType: Scratch.BlockType.COMMAND, text: 'buy [QUANTITY] of product [ID] without checkout', arguments: { QUANTITY: { type: Scratch.ArgumentType.NUMBER, defaultValue: 1 }, ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'prod_...' } } },
          { opcode: 'payUserDirect', blockType: Scratch.BlockType.COMMAND, text: 'pay [AMOUNT] credits to [USER] with note [NOTE] without checkout', arguments: { AMOUNT: { type: Scratch.ArgumentType.NUMBER, defaultValue: 10 }, USER: { type: Scratch.ArgumentType.STRING, defaultValue: 'username' }, NOTE: { type: Scratch.ArgumentType.STRING, defaultValue: '' } } },
          { opcode: 'ownsProduct', blockType: Scratch.BlockType.BOOLEAN, text: 'has product [ID]?', arguments: { ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'prod_...' } } },
          { opcode: 'productBoughtCount', blockType: Scratch.BlockType.REPORTER, text: 'times bought of product [ID]', arguments: { ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'prod_...' } } },
          { opcode: 'membershipStatus', blockType: Scratch.BlockType.REPORTER, text: 'membership status of product [ID]', arguments: { ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'prod_...' } } },
          { opcode: 'productInfo', blockType: Scratch.BlockType.REPORTER, text: 'info of product [ID]', arguments: { ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'prod_...' } } },

          // uploading pics/audio/video. big files get chunked, see uploadImage below for why
          { blockType: Scratch.BlockType.LABEL, text: 'Media Upload' },
          { opcode: 'uploadImage', blockType: Scratch.BlockType.COMMAND, text: 'upload image [DATA_URI] and [MODE]', arguments: { DATA_URI: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, MODE: { type: Scratch.ArgumentType.STRING, menu: 'uploadModeMenu', defaultValue: 'wait' } } },
          { opcode: 'uploadAudio', blockType: Scratch.BlockType.COMMAND, text: 'upload audio [DATA_URI] and [MODE]', arguments: { DATA_URI: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, MODE: { type: Scratch.ArgumentType.STRING, menu: 'uploadModeMenu', defaultValue: 'wait' } } },
          { opcode: 'uploadVideo', blockType: Scratch.BlockType.COMMAND, text: 'upload video [DATA_URI] and [MODE]', arguments: { DATA_URI: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, MODE: { type: Scratch.ArgumentType.STRING, menu: 'uploadModeMenu', defaultValue: 'wait' } } },
          { opcode: 'uploadStatus',   blockType: Scratch.BlockType.REPORTER, text: "file transfer state" },
          { opcode: 'lastUploadUrl',  blockType: Scratch.BlockType.REPORTER, text: "latest uploaded file link" },
          { opcode: 'uploadProgress', blockType: Scratch.BlockType.REPORTER, text: "file transfer percentage" },

          // lets ppl pick a file off their computer, handles big files fine unlike some other extensions i wont name
          { blockType: Scratch.BlockType.LABEL, text: 'File Picker' },
          { opcode: 'openFilePicker', blockType: Scratch.BlockType.COMMAND, text: 'open file selector for [TYPE]', arguments: { TYPE: { type: Scratch.ArgumentType.STRING, menu: 'fileTypeMenu', defaultValue: 'videos' } } },
          { opcode: 'fileWasSelected',     blockType: Scratch.BlockType.BOOLEAN,   text: "file picker has a selection?" },
          { opcode: 'selectedFileUri',     blockType: Scratch.BlockType.REPORTER,  text: "chosen file as data URI" },
          { opcode: 'selectedFileName',    blockType: Scratch.BlockType.REPORTER,  text: "chosen file name" },
          { opcode: 'selectedFileSize',    blockType: Scratch.BlockType.REPORTER,  text: "chosen file size in bytes" },

          // who's been logging into the account n from where (needs the sus scope for a reason)
          { blockType: Scratch.BlockType.LABEL, text: 'Login History' },
          { opcode: 'whenNewLoginDetected', blockType: Scratch.BlockType.HAT,     text: 'when new login detected' },
          { opcode: 'fetchLoginHistory',    blockType: Scratch.BlockType.COMMAND,  text: 'fetch login history' },
          { opcode: 'loginHistoryCount',    blockType: Scratch.BlockType.REPORTER, text: "recorded sign-in total" },
          { opcode: 'loginHistoryJSON',     blockType: Scratch.BlockType.REPORTER, text: "recorded sign-in data as JSON" },
          { opcode: 'lastLoginDevice',      blockType: Scratch.BlockType.REPORTER, text: "device from latest sign-in" },
          { opcode: 'lastLoginIP',          blockType: Scratch.BlockType.REPORTER, text: "IP address from latest sign-in" },

          // stalk other ppl's public info, don't be weird about it
          { blockType: Scratch.BlockType.LABEL, text: 'User Lookup' },
          { opcode: 'lookupUser',         blockType: Scratch.BlockType.COMMAND,  text: 'look up user [USER]', arguments: { USER: { type: Scratch.ArgumentType.STRING, defaultValue: 'username' } } },
          { opcode: 'lookedUpUsername',   blockType: Scratch.BlockType.REPORTER, text: "lookup result: account name" },
          { opcode: 'lookedUpDisplayName', blockType: Scratch.BlockType.REPORTER, text: "lookup result: display name" },
          { opcode: 'lookedUpRank',       blockType: Scratch.BlockType.REPORTER, text: "lookup result: rank" },
          { opcode: 'lookedUpBio',        blockType: Scratch.BlockType.REPORTER, text: "lookup result: biography" },
          { opcode: 'lookedUpPronouns',   blockType: Scratch.BlockType.REPORTER, text: "lookup result: pronouns" },
          { opcode: 'lookedUpPfp',        blockType: Scratch.BlockType.REPORTER, text: "lookup result: profile image link" },
          { opcode: 'lookedUpCountry',    blockType: Scratch.BlockType.REPORTER, text: "lookup result: country" },
          { opcode: 'lookedUpJSON',       blockType: Scratch.BlockType.REPORTER, text: "complete lookup result as JSON" },
          { opcode: 'lookedUpGame',       blockType: Scratch.BlockType.REPORTER, text: "lookup result: active game" },
          { opcode: 'lookedUpGameIcon',   blockType: Scratch.BlockType.REPORTER, text: "lookup result: active game image" },
          { opcode: 'lookedUpIsPlaying',  blockType: Scratch.BlockType.BOOLEAN,  text: "lookup result includes an active game?" },
          { opcode: 'lookedUpPlaytime',   blockType: Scratch.BlockType.REPORTER, text: "lookup result: hours recorded for [GAME]", arguments: { GAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'Five Nights at JARVIS' } } },
          { opcode: 'lookedUpGames',      blockType: Scratch.BlockType.REPORTER, text: "lookup result: game library as JSON" },

          // Nookara Badge Arcade: badges they've caught + the ones placed on their profile.
          // (these are NOT the Nookara system badges in the Badges section below)
          { blockType: Scratch.BlockType.LABEL, text: 'Badge Arcade' },
          { opcode: 'lookedUpUnlockedBadges',     blockType: Scratch.BlockType.REPORTER, text: "lookup result: earned arcade badges as JSON" },
          { opcode: 'lookedUpUnlockedCount',      blockType: Scratch.BlockType.REPORTER, text: "lookup result: earned arcade badge total" },
          { opcode: 'lookedUpHasUnlocked',        blockType: Scratch.BlockType.BOOLEAN,  text: "lookup result includes earned badge [NAME]?", arguments: { NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'Lucky Star' } } },
          { opcode: 'lookedUpUnlockedImage',      blockType: Scratch.BlockType.REPORTER, text: "earned badge [NAME] image link", arguments: { NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'Lucky Star' } } },
          { opcode: 'lookedUpProfileBadges',      blockType: Scratch.BlockType.REPORTER, text: "lookup result: displayed arcade badges as JSON" },
          { opcode: 'lookedUpProfileBadgeCount',  blockType: Scratch.BlockType.REPORTER, text: "lookup result: displayed arcade badge total" },
          { opcode: 'lookedUpProfileBadge',       blockType: Scratch.BlockType.REPORTER, text: "displayed arcade badge [N] detail [PROP]", arguments: { PROP: { type: Scratch.ArgumentType.STRING, menu: 'arcadeBadgeProps', defaultValue: 'image URL' }, N: { type: Scratch.ArgumentType.NUMBER, defaultValue: 1 } } },

          // the launcher - ikelene.net/launcher
          { blockType: Scratch.BlockType.LABEL, text: 'Hyperfocus' },
          { opcode: 'hyperfocusDownload', blockType: Scratch.BlockType.REPORTER, text: "Hyperfocus installer address" },
          { opcode: 'hyperfocusPlayLink', blockType: Scratch.BlockType.REPORTER, text: "Hyperfocus launch address for [GAME]", arguments: { GAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'fnaj' } } },

          // achievements: defined per game (apps.json / the community site's Achievements
          // tab), each with a unique ID - that's what these blocks use
          { blockType: Scratch.BlockType.LABEL, text: 'Achievements' },
          { opcode: 'grantAchievement',  blockType: Scratch.BlockType.COMMAND, text: 'grant achievement [ID]', arguments: { ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'achievement-id' } } },
          { opcode: 'revokeAchievement', blockType: Scratch.BlockType.COMMAND, text: 'revoke achievement [ID]', arguments: { ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'achievement-id' } } },
          { opcode: 'getAchievements',   blockType: Scratch.BlockType.REPORTER,text: "earned achievement data as JSON" },
          { opcode: 'hasAchievement',    blockType: Scratch.BlockType.BOOLEAN, text: "achievement [ID] unlocked?", arguments: { ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'achievement-id' } } },
          { opcode: 'whenAchievementUnlocked', blockType: Scratch.BlockType.HAT, text: 'when an achievement is unlocked' },
          { opcode: 'lastAchievement',   blockType: Scratch.BlockType.REPORTER,text: "latest achievement unlock data as JSON" },

          // not system notis, ur app notis
          { blockType: Scratch.BlockType.LABEL, text: 'Nookara App Alerts' },
          { opcode: 'whenNotificationReceived', blockType: Scratch.BlockType.HAT,     text: 'when notification received' },
          { opcode: 'notificationCount',        blockType: Scratch.BlockType.REPORTER,text: "number of notifications" },
          { opcode: 'unreadNotificationCount',  blockType: Scratch.BlockType.REPORTER,text: "unread notification count" },
          { opcode: 'getNotifications',         blockType: Scratch.BlockType.REPORTER,text: "notification feed as JSON" },
          { opcode: 'clearNotifications',       blockType: Scratch.BlockType.COMMAND, text: 'clear all notifications' },
          { opcode: 'lastNotificationTitle',    blockType: Scratch.BlockType.REPORTER,text: "heading of latest notification" },
          { opcode: 'lastNotificationBody',     blockType: Scratch.BlockType.REPORTER,text: "text of latest notification" },
          { opcode: 'sendNotificationToMe',     blockType: Scratch.BlockType.COMMAND, text: 'send me a notification [TITLE] saying [BODY]', arguments: { TITLE: { type: Scratch.ArgumentType.STRING, defaultValue: 'Your toast is ready' }, BODY: { type: Scratch.ArgumentType.STRING, defaultValue: 'Come back and eat it.' } } },

          // shiny lil achievement icons
          { blockType: Scratch.BlockType.LABEL, text: 'Badges' },
          { opcode: 'badgesLoaded',     blockType: Scratch.BlockType.BOOLEAN, text: "account badges ready?" },
          { opcode: 'allBadges',        blockType: Scratch.BlockType.REPORTER,text: "account badge collection" },
          { opcode: 'badgeCount',       blockType: Scratch.BlockType.REPORTER,text: "number of account badges" },
          { opcode: 'hasBadge',         blockType: Scratch.BlockType.BOOLEAN, text: "account owns badge [BADGE]?", arguments: { BADGE: { type: Scratch.ArgumentType.STRING, defaultValue: 'Community Developer' } } },
          { opcode: 'badgeInfo',        blockType: Scratch.BlockType.REPORTER,text: "details for account badge [BADGE]", arguments: { BADGE: { type: Scratch.ArgumentType.STRING, defaultValue: 'Community Developer' } } },

          // the old peer-to-peer call blocks - replaced by Nookara Voice below, hidden
          // so they stop showing up but projects that already use them still load
          { opcode: 'callUser',         blockType: Scratch.BlockType.COMMAND, text: 'call user [USER]', arguments: { USER: { type: Scratch.ArgumentType.STRING, defaultValue: 'username' } }, hideFromPalette: true },
          { opcode: 'whenCallReceived', blockType: Scratch.BlockType.HAT,     text: 'when call received', hideFromPalette: true },
          { opcode: 'callData',         blockType: Scratch.BlockType.REPORTER,text: "call invitation details", hideFromPalette: true },
          { opcode: 'acceptCall',       blockType: Scratch.BlockType.COMMAND, text: 'accept call', hideFromPalette: true },
          { opcode: 'setMic',           blockType: Scratch.BlockType.COMMAND, text: 'set mic to [STATE]', arguments: { STATE: { type: Scratch.ArgumentType.STRING, menu: 'onOff', defaultValue: 'on' } }, hideFromPalette: true },
          { opcode: 'stopCall',         blockType: Scratch.BlockType.COMMAND, text: 'stop call', hideFromPalette: true },

          // Nookara Voice - replaces the separate "Voice Chat" extension. Needs the
          // Nookara Voice permission; your voice name is your Nookara username.
          { blockType: Scratch.BlockType.LABEL, text: 'Nookara Voice' },
          { opcode: 'joinVoice',        blockType: Scratch.BlockType.COMMAND, text: 'join voice room [ROOM]', arguments: { ROOM: { type: Scratch.ArgumentType.STRING, defaultValue: 'my-room' } } },
          { opcode: 'leaveVoice',       blockType: Scratch.BlockType.COMMAND, text: 'leave voice room' },
          { opcode: 'voiceMic',         blockType: Scratch.BlockType.COMMAND, text: 'turn microphone [STATE]', arguments: { STATE: { type: Scratch.ArgumentType.STRING, menu: 'onOff', defaultValue: 'on' } } },
          { opcode: 'voiceThreshold',   blockType: Scratch.BlockType.COMMAND, text: 'set speaking threshold to [T]', arguments: { T: { type: Scratch.ArgumentType.NUMBER, defaultValue: 5 } } },
          { opcode: 'inVoice',          blockType: Scratch.BlockType.BOOLEAN, text: "voice connection active?" },
          { opcode: 'voiceMicOn',       blockType: Scratch.BlockType.BOOLEAN, text: "microphone enabled?" },
          { opcode: 'voiceRoom',        blockType: Scratch.BlockType.REPORTER,text: "joined voice room" },
          { opcode: 'voiceMyVolume',    blockType: Scratch.BlockType.REPORTER,text: "local microphone level" },
          { opcode: 'voicePeople',      blockType: Scratch.BlockType.REPORTER,text: "voice participant list as JSON" },
          { opcode: 'voiceSpeaking',    blockType: Scratch.BlockType.REPORTER,text: "active speaker list as JSON" },
          { opcode: 'voiceUserVolume',  blockType: Scratch.BlockType.REPORTER,text: "audio level for [USER]", arguments: { USER: { type: Scratch.ArgumentType.STRING, defaultValue: 'username' } } },
          { opcode: 'voiceUserSpeaking',blockType: Scratch.BlockType.BOOLEAN, text: "voice activity detected for [USER]?", arguments: { USER: { type: Scratch.ArgumentType.STRING, defaultValue: 'username' } } },
          { opcode: 'voiceSetVolume',   blockType: Scratch.BlockType.COMMAND, text: 'set voice volume to [V] %', arguments: { V: { type: Scratch.ArgumentType.NUMBER, defaultValue: 100 } } },
          { opcode: 'voiceSetUserVolume', blockType: Scratch.BlockType.COMMAND, text: 'set [USER] voice volume to [V] %', arguments: { USER: { type: Scratch.ArgumentType.STRING, defaultValue: 'username' }, V: { type: Scratch.ArgumentType.NUMBER, defaultValue: 100 } } },
          { opcode: 'voiceMuteUser',    blockType: Scratch.BlockType.COMMAND, text: 'mute [USER] [STATE]', arguments: { USER: { type: Scratch.ArgumentType.STRING, defaultValue: 'username' }, STATE: { type: Scratch.ArgumentType.STRING, menu: 'onOff', defaultValue: 'on' } } },
          { opcode: 'whenVoiceJoin',    blockType: Scratch.BlockType.HAT,     text: 'when someone joins voice' },
          { opcode: 'whenVoiceLeave',   blockType: Scratch.BlockType.HAT,     text: 'when someone leaves voice' },
          { opcode: 'voiceEventUser',   blockType: Scratch.BlockType.REPORTER,text: "account from latest voice event" },
          '---',
          // calls: ring an online Nookara user into the room you're in. How a call
          // shows up is up to your project - these hats tell you it's happening.
          { opcode: 'voiceCallUser',    blockType: Scratch.BlockType.COMMAND, text: 'call [USER] into my voice room', arguments: { USER: { type: Scratch.ArgumentType.STRING, defaultValue: 'username' } } },
          { opcode: 'cancelVoiceCall',  blockType: Scratch.BlockType.COMMAND, text: 'cancel my call' },
          { opcode: 'whenVoiceAnswered',blockType: Scratch.BlockType.HAT,     text: 'when my call is answered' },
          { opcode: 'voiceCallResult',  blockType: Scratch.BlockType.REPORTER,text: "latest call outcome" },
          { opcode: 'whenVoiceCalled',  blockType: Scratch.BlockType.HAT,     text: 'when someone calls me' },
          { opcode: 'beingCalled',      blockType: Scratch.BlockType.BOOLEAN, text: "incoming call pending?" },
          { opcode: 'voiceCaller',      blockType: Scratch.BlockType.REPORTER,text: "incoming caller account" },
          { opcode: 'answerVoiceCall',  blockType: Scratch.BlockType.COMMAND, text: '[ANSWER] the call', arguments: { ANSWER: { type: Scratch.ArgumentType.STRING, menu: 'callAnswer', defaultValue: 'accept' } } },

          // for debugging, see what the last command actually did
          { blockType: Scratch.BlockType.LABEL, text: 'Verbose' },
          { opcode: 'lastActionOutput',  blockType: Scratch.BlockType.REPORTER,text: "latest operation response as JSON" },
          { opcode: 'lastActionSuccess', blockType: Scratch.BlockType.BOOLEAN, text: "latest operation completed successfully?" },
        ],
        menus: {
          productPlan: { acceptReporters: true, items: [{ text: 'regular', value: 'period' }, { text: 'yearly', value: 'yearly' }] },
          arcadeBadgeProps: { acceptReporters: true, items: ['name', 'image URL', 'x', 'y', 'size', 'badge id', 'rarity'] },
          authResultMenu: {
            acceptReporters: false,
            items: ['successful', 'failed'],
          },
          accountKeys: {
            acceptReporters: true,
            items: ['account_id', 'username', 'display_name', 'membership', 'staff_role', 'account_status',
                    'moderation_level', 'credits', 'badges', 'joined_at',
                    'last_signed_in_at', 'sign_in_count', 'sessions',
                    'terms_accepted', 'terms_accepted_at', 'email_verified',
                    'email', 'avatar_url', 'banner_url', 'biography',
                    'pronouns', 'timezone', 'country'],
          },
          onOff: { acceptReporters: false, items: ['on', 'off'] },
          callAnswer: { acceptReporters: false, items: ['accept', 'decline'] },
          serviceMenu: { acceptReporters: true, items: Object.keys(SERVICE_BITS) },
          statusMenu: { acceptReporters: false, items: ['online', 'idle', 'dnd', 'invisible'] },
          dmPrivacyOptions: { acceptReporters: true, items: ['everyone', 'friends only', 'members in my servers'] },
          savedKinds: { acceptReporters: false, items: ['channel', 'dm'] },
          activityTypes: { acceptReporters: true, items: ['playing', 'listening', 'watching', 'competing', 'streaming', 'custom'] },
          chatMsgProps: { acceptReporters: false, items: ['text', 'author', 'channel', 'server', 'id', 'JSON'] },
          periodMenu: { acceptReporters: false, items: ['weekly','biweekly','monthly','bimonthly','yearly'] },
          uploadModeMenu: { acceptReporters: false, items: ['wait', 'continue'] },
          fileTypeMenu: { acceptReporters: false, items: ['videos', 'images', 'audio files'] },
        },
      };
    }

    _connectWS() {
      if (this._ws && this._ws.readyState < 2) return;
      this._wsReady = false;
      this._ws = new WebSocket(SERVER_WS);
      this._ws.binaryType = 'arraybuffer'; // Nookara Voice audio comes in as binary frames

      this._ws.onopen = () => {
        this._wsReady = true;
        this._connected = true;
        this._evtConnected = true;
        this._evtDisconnected = false;
        if (this._token) this._wsAuth();
        this._getOnlinePlayers();
        // joins / leaves only come for friends + people you share a server or chat with now, so the whole
        // online list is asked for again every 30 s (the "connected users" / "is user connected" blocks)
        if (!this._onlineTimer) this._onlineTimer = setInterval(() => { if (this._ws?.readyState === 1) this._getOnlinePlayers(); }, 30000);
      };

      this._ws.onmessage = (e) => {
        if (e.data instanceof ArrayBuffer) { this._vIncoming(e.data); return; }
        let msg; try { msg = JSON.parse(e.data); } catch { return; }
        this._handleWS(msg);
      };

      this._ws.onclose = () => {
        this._wsReady = false;
        this._wsAuthed = false;
        // fail in-flight socket sends so sendIM falls back to https instead of hanging
        this._imPending.forEach(p => p.reject(new Error('disconnected')));
        this._imPending.clear();
        this._connected = false;
        this._authenticated = false;
        this._evtDisconnected = true;
        this._intentionalDisconnect = false;
        this._vReset('disconnected');
        this._vCall = null;
      };

      this._ws.onerror = () => {};
    }

    _wsSend(obj) {
      if (this._ws && this._ws.readyState === 1) {
        this._ws.send(JSON.stringify(obj));
      }
    }

    _wsAuth() {
      if (!this._token) return;
      // no fingerprint here on purpose, the token was made on nookara.cc
      // but this code's actually running on scratch.mit.edu so the fingerprint
      // would just be wrong lol
      this._wsSend({ type: 'auth_token', token: this._token });
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
        case 'auth_success':
          this._wsAuthed = true;

          if (this._rich) this._wsSend({ type: 'set_rich_presence', activity: this._rich });
          this._disabledScopes = Number(msg.disabled_scopes) || 0;
          this._user = msg.user;
          this._username = msg.user?.username || '';
          this._authenticated = true;
          this._evtAuthenticated = true;
          this._fetchAccount();
          this._fetchFriends();
          this._fetchMail();
          this._fetchBadges();
          this._pollLoginHistory();
          this._fetchNotifications();
          if (!this._notifInterval) {
            this._notifInterval = setInterval(() => {
              if (this._token) { this._pollLoginHistory(); this._fetchNotifications(); }
            }, 30000);
          }
          break;
        case 'auth_error':
          this._authenticated = false;
          this._token = null;
          break;
        case 'kicked':
          this._authenticated = false;
          this._wsReady = false;
          this._connected = false;
          this._evtDisconnected = true;
          break;
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
        case 'onlinePlayers':
          this._onlinePlayers = msg.players;
          break;
        case 'typing':
          if (!this._typingUsers.includes(msg.user)) this._typingUsers.push(msg.user);
          break;
        case 'stopTyping':
          this._typingUsers = this._typingUsers.filter(u => u !== msg.user);
          break;
        case 'user_update': // someone I can see changed their picture / name / colour / bio ... (profile-live.js)
          this._lastUserUpdate = { ...(msg.user || {}), changed: msg.changed || [], previous_username: msg.previous_username || null };
          this._evtUserUpdated = true;
          break;
        case 'account_updated':
          this._evtAccountUpdated = true;
          this._fetchAccount();
          break;
        // Instant Messages
        case 'im_received': {
          const m = msg.message || {};
          this._lastIM = m;
          this._imUnread++;
          this._evtMailReceived = true; // old 'when vMail received' hat
          this._evtIMReceived = true;
          this._evtIMFromMap[Scratch.Cast.toString(m.from || '').toLowerCase()] = true;
          if (Array.isArray(this._mail)) this._mail.unshift({ ...m, from_username: m.from, subject: '' });
          break;
        }
        case 'im_unread':
          // messages that came in while we were offline - they're in the db, go get them
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
          // legacy duplicate of im_received, server still sends it for old clients
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
        case 'balance_changed':
          this._evtBalanceChanged = true;
          if (this._accountObj.account) this._accountObj.account.credits = (this._accountObj.account.credits || 0) + (msg.delta || 0);
          break;
        // an admin changed which services this account can use (applies right away)
        // achievements (granted from any of your apps - the launcher pops them up)
        case 'achievement_unlocked':
          if (msg.achievement?.id) {
            this._achievements[msg.achievement.id] = { ...(this._achievements[msg.achievement.id] || {}), ...msg.achievement, unlocked: true };
            delete this._achievements[msg.achievement.id].id;
            this._lastAchievement = msg.achievement;
            this._evtAchievement = true;
          }
          break;
        case 'achievement_revoked':
          if (this._achievements[msg.id]) this._achievements[msg.id] = { ...this._achievements[msg.id], unlocked: false, unlockedAt: null };
          break;
        case 'restrictions':
          this._disabledScopes = Number(msg.disabled_scopes) || 0;
          if (msg.scopes !== undefined) this._grantedScopes = Number(msg.scopes);
          break;
        case 'error':
          if (msg.required_scope === SCOPES.VOICE && this._v.opening) {
            const o = this._v.opening; this._v.opening = null;
            o.reject(new Error(msg.error === 'scope_disabled' ? 'Nookara Voice was disabled for your account by an administrator.' : "Missing permission: this needs the 'Nookara Voice' scope."));
          }
          break;
        case 'chat_error':
          this._rtcMessage(msg, true);
          break;
        // ── Nookara Voice ──
        case 'voice_open':
          this._v.open = true;
          if (this._v.opening) { const o = this._v.opening; this._v.opening = null; o.resolve(); }
          break;
        case 'voice_closed':
          this._vReset(msg.reason || 'closed');
          break;
        case 'voice':
          this._vMessage(msg.msg || {});
          break;
        case 'voice_call_incoming':
          this._vCall = { callId: msg.callId, from: msg.from, room: msg.room };
          this._evtVoiceCalled = true;
          break;
        case 'voice_call_accepted': // I said yes - hop into their room
          this._joinVoiceRoom(msg.room).catch(() => {});
          break;
        case 'voice_call_ringing':
          this._vOutCall = { callId: msg.callId, to: msg.to };
          this._vCallResult = 'ringing';
          break;
        case 'voice_call_answered':
          this._vOutCall = null;
          this._vCallResult = msg.accepted ? 'accepted' : 'declined';
          this._evtVoiceAnswered = true;
          break;
        case 'voice_call_ended':
          if (this._vCall?.callId === msg.callId) this._vCall = null;
          if (this._vOutCall?.callId === msg.callId) {
            this._vOutCall = null;
            this._vCallResult = msg.reason === 'no_answer' ? 'no answer' : msg.reason;
            this._evtVoiceAnswered = true;
          }
          break;
        case 'voice_call_failed':
          this._vOutCall = null;
          this._vCallResult = `failed: ${Scratch.Cast.toString(msg.reason || 'error').replace(/_/g, ' ')}`;
          this._evtVoiceAnswered = true;
          break;
        case 'chat_rtc_joined': case 'chat_rtc_published': case 'chat_rtc_offer': case 'chat_rtc_ready': case 'chat_rtc_room':
          this._rtcMessage(msg);
          break;
        case 'call_incoming':
          this._evtCallIncoming = true;
          this._callData = msg;
          break;
        case 'pong':
          break;
      }
    }

    _getOnlinePlayers() {
      this._wsSend({ type: 'getOnlinePlayers' });
    }

    async _http(path, method = 'GET', body = null) {
      const headers = { 'Content-Type': 'application/json' };
      if (this._token) headers['Authorization'] = `Bearer ${this._token}`;
      // skipping the fingerprint header here too, same reason as _wsAuth above
      const opts = { method, headers };
      if (body) opts.body = JSON.stringify(body);
      const res = await fetch(SERVER_HTTP + path, opts);
      return res.json().catch(() => ({}));
    }

    // checks scopes on OUR end first so the block goes red instantly instead of
    // waiting on a network round trip. server double checks everything anyway
    // so this is just for a snappier error message, not actual security
    _requireScope(bit) {
      if (!this._authenticated) throw new Error('Not logged in');
      if ((this._disabledScopes & bit) !== 0) {
        throw new Error(`'${SCOPE_NAMES[bit] || 'This feature'}' was disabled for your account by an administrator.`);
      }
      if ((this._grantedScopes & bit) !== bit) {
        const name = SCOPE_NAMES[bit] || `scope ${bit}`;
        throw new Error(this._missingScopeText(bit, name));
      }
    }

    // Scopes can't be forced any more: a project only REQUESTS them and the person logging in can untick any of them.
    // So "missing" means one of two things, and the message says which when we know it.
    _missingScopeText(bit, name) {
      const asked = this._requestedScopes;
      if (asked && (asked & bit) !== bit) {
        return `Missing permission: this block needs the '${name}' scope, but this project never asked for it. The project's creator needs to add it to the Permission Integer (generate one at nookara.cc/permissions).`;
      }
      if (asked) {
        return `Missing permission: this block needs the '${name}' scope, which you chose not to allow when you logged in. Log in again and keep '${name}' ticked to use it.`;
      }
      return `Missing permission: this block needs the '${name}' scope. Either the project never requested it (add it to the Permission Integer from nookara.cc/permissions) or you didn't allow it when logging in (log in again and keep it ticked).`;
    }

    _scopeErrorFromData(data) {
      if (data && data.error === 'server_read_only') {
        return new Error(`That Nookara community is read-only now${data.moved_to ? ' and has moved to ' + data.moved_to : ''}. Communities live on Bonfire servers: use the server's URL (like https://chat.ikelene.net) instead.`);
      }
      if (data && (data.error === 'scope_disabled' || data.disabled_by_admin)) {
        const name = SCOPE_NAMES[data.required_scope] || 'This feature';
        return new Error(`'${name}' was disabled for your account by an administrator.`);
      }
      if (data && data.error === 'insufficient_scope') {
        const name = SCOPE_NAMES[data.required_scope] || `scope ${data.required_scope}`;
        return new Error(this._missingScopeText(data.required_scope, name));
      }
      return null;
    }

    async _cmd(path, method = 'GET', body = null) {
      const data = await this._http(path, method, body);
      this._lastActionOutput = JSON.stringify(data);
      this._lastActionSuccess = !!data.success;
      if (data.error) throw (this._scopeErrorFromData(data) || new Error(data.error === 'user_blocked' ? (data.message || "You can't do that with this user (one of you blocked the other)") : data.error === 'dm_privacy' ? (data.message || 'Failed to send this message due to the users privacy settings') : data.error));
      return data;
    }

    async _validateSavedToken() {
      const data = await this._http('/auth/validate', 'POST', { token: this._token }).catch(() => ({}));
      if (data.valid) {
        this._user = data.user;
        this._grantedScopes = Number(data.user?.scopes ?? 0);
        this._disabledScopes = Number(data.user?.disabled_scopes) || 0;
        this._username = data.user?.username || '';
        this._authenticated = true;
        this._wsAuth();
        await this._fetchAccount();
        this._evtAuthenticated = true;
        this._lastAuthResult = 'successful';
        this._fetchFriends();
        this._fetchMail();
        this._fetchBadges();
        this._pollLoginHistory();
        this._fetchNotifications();
        if (!this._notifInterval) {
          this._notifInterval = setInterval(() => {
            if (this._token) { this._pollLoginHistory(); this._fetchNotifications(); }
          }, 30000);
        }
      } else {
        this._authenticated = false;
        this._lastAuthResult = 'failed';
        this._token = null;
        this._grantedScopes = 0;
        this._username = '';
      }
    }

    async _fetchAccount() {
      if (!this._token) return;
      const requestedToken = this._token;
      const data = await this._http('/account/me').catch(() => ({}));
      if (this._token !== requestedToken || !this._authenticated) return;
      if (data.account) {
        this._accountObj = data;
        this._badges = data.account.badges || [];
        if (data.account.username) this._username = data.account.username;
      }
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

    async _fetchMail() {
      if (!this._token) return;
      try {
        const data = await this._http('/im');
        if (data.mail) this._mail = data.mail;
        if (Array.isArray(data.messages)) this._imUnread = data.messages.filter(m => !m.read).length;
      } catch(e) {
        if (e.message === 'insufficient_scope') this._mail = 'Permission Denied';
      }
    }

    async _fetchBadges() {
      if (!this._token) return;
      const data = await this._http('/account/me').catch(() => ({}));
      if (data.account?.badges) this._badges = data.account.badges;
    }

    // Returns a Promise on purpose - scratch-vm/TurboWarp treat a command
    // block whose implementation returns a Promise as blocking: the block
    // stays lit and the script's execution just parks right there until it
    // resolves. That's the whole fix here - the block itself now holds the
    // script until login succeeds or the popup goes away, so there's no
    // more need to build "wait until not <is login window open?>" around it,
    // and no more guessing about popup state from the outside.
    //
    // Closing detection used to poll window.closed on the popup reference,
    // but that reads unreliably from inside TurboWarp's extension sandbox -
    // sometimes true almost immediately, sometimes stuck false well past
    // when the window actually closed. Replaced with an explicit signal:
    // the login page itself (public/login/index.html) posts a message here
    // right before it unloads, if the ext-code flow never completed. That's
    // just window messaging, not dependent on the .closed property at all.
    _openLoginPopup(args) {
      if (this._loginInProgress) return Promise.resolve(); // already waiting on one

      let projName = Scratch.Cast.toString(args?.PROJECT_NAME || args?.project_name || 'My Project').trim();
      let rawPerm = args?.PERMISSIONS !== undefined && args?.PERMISSIONS !== null ? args.PERMISSIONS : (args?.permissions !== undefined ? args.permissions : '');

      let cleanPerm = Scratch.Cast.toString(rawPerm).replace(/[^0-9]/g, '');
      let permInt = parseInt(cleanPerm, 10);

      // NOT defaulting to full access if this is empty/broken!! used to secretly
      // fall back to 65535 (literally every scope) which is baaaad. now it just
      // asks you to build a real permission integer at nookara.cc/permissions instead
      if (isNaN(permInt) || permInt <= 0) {
        this._lastAuthResult = 'failed';
        throw new Error('Invalid Permissions Integer. Pick the permissions your project asks for at https://nookara.cc/permissions (people signing in can still untick any of them).');
      }

      this._loginInProgress = true;
      // a permission integer lists the permissions the project ASKS for. Nothing is mandatory: the person signing in can untick any of them.
      // (older integers kept some in the low 16 bits and the rest in the high 16 - both halves simply mean 'asked for')
      this._requestedScopes = (permInt & 0xFFFF) | ((permInt >>> 16) & 0xFFFF);

      return new Promise((resolve) => {
        let settled = false;
        let popup = null;
        let pollInterval = null;
        let code = null;

        const finish = () => {
          if (settled) return;
          settled = true;
          if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
          window.removeEventListener('message', onMessage);
          this._loginInProgress = false;
          this._cancelPendingLogin = null;
          resolve();
        };

        // Exposed so logout() can bail a login that's still waiting.
        this._cancelPendingLogin = () => {
          try { popup?.close(); } catch (_) {}
          this._lastAuthResult = 'failed';
          finish();
        };

        const doPoll = async (code) => {
          try {
            const r = await fetch(`${SERVER_HTTP}/auth/ext-code/status?code=${encodeURIComponent(code)}`);
            if (r.status === 404) { this._lastAuthResult = 'failed'; return true; }
            const d = await r.json();
            if (d.ready && d.token) {
              try { popup?.close(); } catch (_) {}
              this._token = d.token;
              await this._validateSavedToken();
              if (this._authenticated) this._connectWS();
              this._lastAuthResult = this._authenticated ? 'successful' : 'failed';
              return true;
            }
            // Server-side truth for "is the popup even still open": it's
            // been pinging a heartbeat every ~2s the whole time it's been
            // up, so silence there means it's gone, full stop - no guessing
            // from window.closed or postMessage needed.
            if (d.alive === false) {
              try { popup?.close(); } catch (_) {}
              this._lastAuthResult = 'failed';
              return true;
            }
          } catch (_) {}
          return false;
        };

        const onMessage = (e) => {
          if (e.data?.type !== 'velora_ext_closed' || e.data.code !== code) return;
          // Popup says it's going away without finishing - one last status
          // check first, in case success landed on the server right as it
          // closed itself (same race guard the old debounced version had).
          doPoll(code).then(success => { if (!success) this._lastAuthResult = 'failed'; finish(); });
        };

        fetch(`${SERVER_HTTP}/auth/ext-code`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ permissions_integer: permInt, project_name: projName })
        })
          .then(r => r.json())
          .then(data => {
            code = data.code;
            if (!code) { finish(); return; }

            popup = window.open(
              `${SERVER_HTTP}/login?code=${encodeURIComponent(code)}&project=${encodeURIComponent(projName)}&permissions=${permInt}`,
              'velora_login',
              `popup,width=900,height=${Math.max(320, Math.min(800, (window.screen?.availHeight || 900) - 80))},toolbar=no,menubar=no,location=no,scrollbars=yes,resizable=yes`
            );

            if (!popup) { this._lastAuthResult = 'failed'; this._lastActionSuccess = false; this._lastActionOutput = JSON.stringify({ error: 'Popup blocked. Allow popups to sign in to Nookara.' }); finish(); return; }
            window.addEventListener('message', onMessage);

            // Keeps asking the server every 1.5s until it's either done or
            // dead (404 after 5 min, see routes/auth.js) - the message
            // listener above covers a manual close well before that.
            pollInterval = setInterval(async () => {
              if (await doPoll(code)) finish();
            }, 1500);
          })
          .catch(() => finish());
      });
    }

    openPermissionsCalc() {
      if (window.open) {
        window.open('https://nookara.cc/permissions', '_blank');
      }
    }

    openGuides() {
      if (window.open) {
        window.open('https://nookara.cc/guides', '_blank');
      }
    }

    // sign in with a registered app (nookara.cc/me#apps): the app decides the name and permissions, its id is all the project needs.
    // the token never comes from the status poll: the login window posts a one-time grant to this page (the browser only delivers it
    // to the address the sign-in started from), and that swaps for the token
    _openAppLogin(args) {
      if (this._loginInProgress) return Promise.resolve(); // already waiting on one
      const appId = Scratch.Cast.toString(args?.APP_ID ?? '').trim();
      if (!/^app_[0-9a-f]{20}$/.test(appId)) {
        this._lastAuthResult = 'failed';
        throw new Error('Put your app ID in this block. Create an app at https://nookara.cc/me#apps');
      }
      this._loginInProgress = true;
      const serverOrigin = new URL(SERVER_HTTP).origin;
      return new Promise((resolve) => {
        let settled = false, popup = null, pollInterval = null, code = null;
        const finish = () => {
          if (settled) return;
          settled = true;
          if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
          window.removeEventListener('message', onMessage);
          this._loginInProgress = false;
          this._cancelPendingLogin = null;
          resolve();
        };
        const fail = (error) => {
          this._lastAuthResult = 'failed';
          if (error) { this._lastActionSuccess = false; this._lastActionOutput = JSON.stringify({ error }); }
          finish();
        };
        this._cancelPendingLogin = () => { try { popup?.close(); } catch (_) {} fail(); };
        const onMessage = async (e) => {
          if (e.origin !== serverOrigin || !code || e.data?.code !== code) return;
          if (e.data.type === 'velora_ext_closed') { fail(); return; }
          if (e.data.type !== 'nookara_app_grant' || pollInterval === null) return;
          clearInterval(pollInterval); pollInterval = null;
          try { popup?.close(); } catch (_) {}
          try {
            const r = await fetch(`${SERVER_HTTP}/auth/ext-code/exchange`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ code, grant: e.data.grant }),
            });
            const d = await r.json();
            if (!d.token) { fail(d.error || 'sign_in_failed'); return; }
            this._token = d.token;
            this._requestedScopes = Number(d.scopes) || 0;
            await this._validateSavedToken();
            if (this._authenticated) this._connectWS();
            this._lastAuthResult = this._authenticated ? 'successful' : 'failed';
          } catch (_) { this._lastAuthResult = 'failed'; }
          finish();
        };
        fetch(`${SERVER_HTTP}/auth/ext-code`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ app_id: appId }),
        })
          .then(r => r.json())
          .then(data => {
            code = data.code;
            if (!code) { fail(data.error || 'sign_in_failed'); return; }
            window.addEventListener('message', onMessage);
            popup = window.open(
              `${SERVER_HTTP}/login?code=${encodeURIComponent(code)}`,
              'velora_login',
              `popup,width=900,height=${Math.max(320, Math.min(800, (window.screen?.availHeight || 900) - 80))},toolbar=no,menubar=no,location=no,scrollbars=yes,resizable=yes`
            );
            if (!popup) { fail('Popup blocked. Allow popups to sign in.'); return; }
            pollInterval = setInterval(async () => {
              try {
                const r = await fetch(`${SERVER_HTTP}/auth/ext-code/status?code=${encodeURIComponent(code)}`);
                if (r.status === 404) { fail(); return; }
                const d = await r.json();
                if (d.alive === false && !d.approved) { try { popup?.close(); } catch (_) {} fail(); }
              } catch (_) {}
            }, 1500);
          })
          .catch(() => fail());
      });
    }

    openAppsPage() {
      if (window.open) {
        window.open('https://nookara.cc/me#apps', '_blank');
      }
    }

    openAppLogin(args) {
      return this._openAppLogin(args);
    }

    openLoginPrompt(args) {
      return this._openLoginPopup(args);
    }

    whenConnected()           { const v = this._evtConnected;      this._evtConnected = false;      return v; }
    whenDisconnected()        { const v = this._evtDisconnected;   this._evtDisconnected = false;   return v; }
    whenAuthenticated()       { const v = this._evtAuthenticated;  this._evtAuthenticated = false;  return v; }
    whenAccountUpdated()      { const v = this._evtAccountUpdated; this._evtAccountUpdated = false; return v; }
    whenUserUpdated()         { const v = this._evtUserUpdated;    this._evtUserUpdated = false;    return v; }
    lastUserUpdate()          { return JSON.stringify(this._lastUserUpdate || {}); }
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
    whenCallReceived()        { const v = this._evtCallIncoming;   this._evtCallIncoming = false;   return v; }
    whenBalanceChanged()      { const v = this._evtBalanceChanged; this._evtBalanceChanged = false; return v; }
    whenNewLoginDetected()    { const v = this._evtNewLogin;       this._evtNewLogin = false;       return v; }
    whenNotificationReceived(){ const v = this._evtNotification;   this._evtNotification = false;   return v; }
    whenGlobalMessageReceived() { const v = this._evtGlobalMsg; this._evtGlobalMsg = false; return v; }
    whenRoomMessageReceived({ ROOM }) { const v = !!this._evtRoomMsgMap[ROOM]; this._evtRoomMsgMap[ROOM] = false; return v; }

    // Kept for existing projects that poll it (e.g. to show a "logging
    // in..." sprite), but nothing internal needs this anymore - the sign in
    // block now blocks the script itself for as long as this would be true.
    isLoginOpen()          { return !!this._loginInProgress; }
    authResult({ RESULT }) { return this._lastAuthResult === RESULT; }

    async serverOnline() {
      try {
        const r = await fetch(`${SERVER_HTTP}/health`, { signal: AbortSignal.timeout(4000) });
        return r.ok;
      } catch { return false; }
    }

    isConnected() { return this._ws?.readyState === 1; }

    isUserBanned()  { return (this._accountObj?.account?.rank || '') === 'banned'; }
    storageIdSet()  { return this._storageId !== null; }
    badgesLoaded()  { return this._badges.length > 0; }

    isUserConnected({ USER }) {
      return this._onlinePlayers.some(p => p.username === USER);
    }

    hasBadge({ BADGE }) {
      return this._badges.some(b => b.name === BADGE);
    }

    keyExists({ KEY }) {
      return this._authenticated && Object.hasOwn(this._flatAccount(), KEY);
    }

    storageKeyExists({ KEY }) {
      if (!this._storageId) throw new Error("No storage ID set. Use the 'set storage ID to' block first.");
      this._requireScope(SCOPES.STORAGE_READ);
      return this._http(`/storage/${encodeURIComponent(this._storageId)}/${encodeURIComponent(KEY)}`).then(d => !d.error);
    }

    currentToken()      { if (!this._token) throw new Error('Not logged in'); return this._token; }
    clientUsername()    { if (!this._authenticated) throw new Error('Not logged in'); return this._username || this._user?.username || this._accountObj?.account?.username || ''; }
    getStorageId()      { return this._storageId || ''; }
    lastUserJoined()    { return this._lastUserJoined; }
    lastUserLeft()      { return this._lastUserLeft; }
    callData()          { return JSON.stringify(this._callData); }
    typingUsers()       { return JSON.stringify(this._typingUsers); }
    getFriendCount()    { if (!this._authenticated) throw new Error('Not logged in'); this._requireScope(SCOPES.FRIENDS_READ); return this._friends.length; }
    getFriendsList()    { if (!this._authenticated) throw new Error('Not logged in'); this._requireScope(SCOPES.FRIENDS_READ); return JSON.stringify(this._friends); }
    getFriendRequests() { if (!this._authenticated) throw new Error('Not logged in'); this._requireScope(SCOPES.FRIENDS_READ); return JSON.stringify(this._friendRequests); }
    allBadges()         { if (!this._authenticated) throw new Error('Not logged in'); return JSON.stringify(this._badges); }
    badgeCount()        { if (!this._authenticated) throw new Error('Not logged in'); return this._badges.length; }
    getMailList()       { if (!this._authenticated) throw new Error('Not logged in'); this._requireScope(SCOPES.VMAIL_READ); return JSON.stringify(this._mail); }
    connectedUsers() {
      if (!this._connected) return 'Not connected';
      const obj = {};
      for (const p of this._onlinePlayers) obj[p.username] = { status: p.status || 'online', rank: p.rank || '' };
      return JSON.stringify(obj);
    }
    getAccountObject()  { if (!this._authenticated) throw new Error('Not logged in'); return JSON.stringify(this._accountObj); }
    getAllKeys()         { if (!this._authenticated) throw new Error('Not logged in'); return JSON.stringify(Object.keys(this._flatAccount())); }
    getAllValues()       { if (!this._authenticated) throw new Error('Not logged in'); return JSON.stringify(Object.values(this._flatAccount())); }

    lastMessageUser()     { return this._lastMsg?.user || ''; }
    lastMessageContent()  { return this._lastMsg?.message || ''; }
    lastMessageUserJson() {
      const m = this._lastMsg;
      if (!m) return '{}';
      return JSON.stringify({ username: m.user, rank: m.rank, color: m.color });
    }

    uploadStatus()    { return this._uploadStatus; }
    lastUploadUrl()   { return this._lastUploadUrl; }
    lastActionOutput()  { return this._lastActionOutput; }
    lastActionSuccess() { return this._lastActionSuccess; }
    notificationCount()     { return this._notifications.length; }
    // the number on the bell, asked fresh each time (GET /account/notifications/unread-count)
    async unreadNotificationCount() {
      if (!this._token) return 0;
      const data = await this._http('/account/notifications/unread-count').catch(() => ({}));
      return data.unread ?? 0;
    }
    getNotifications()      { return JSON.stringify(this._notifications); }
    lastNotificationTitle() { return this._lastNotifTitle; }
    lastNotificationBody()  { return this._lastNotifBody; }

    myClientObject() {
      if (!this._authenticated) throw new Error('Not logged in');
      return JSON.stringify({
        username: this.clientUsername(),
        rank: this._accountObj?.account?.rank || this._user?.rank || '',
        pfp: this._accountObj?.profile?.pfp || '',
        status: this._status,
      });
    }

    // One typed field catalogue powers all account reporters and menus.
    _flatAccount() {
      const { account, profile = {} } = this._accountObj;
      if (!account) {
        if (!this._authenticated || !this._username) return {};
        return { username: this._username, account_id: this._user?.id ?? '', membership: this._user?.membership ?? this._user?.rank ?? '', staff_role: this._user?.staff_role ?? '' };
      }
      return {
        account_id: account.id ?? '',
        username: account.username ?? '',
        membership: account.membership ?? account.rank ?? '',
        staff_role: account.staff_role ?? '',
        account_status: account.account_status ?? '',
        moderation_level: account.moderation_level ?? '',
        credits: account.credits ?? '',
        badges: account.badges ?? [],
        joined_at: account.joined_at ?? '',
        last_signed_in_at: account.last_signed_in_at ?? '',
        sign_in_count: account.sign_in_count ?? 0,
        sessions: account.sessions ?? [],
        terms_accepted: account.terms_accepted ?? false,
        terms_accepted_at: account.terms_accepted_at ?? '',
        email_verified: account.email_verified ?? false,
        email: profile.email ?? '',
        avatar_url: profile.pfp ?? '',
        banner_url: profile.banner ?? '',
        biography: profile.bio ?? '',
        pronouns: profile.pronouns ?? '',
        display_name: account.display_name ?? '',
        timezone: profile.timezone ?? '',
        country: profile.country ?? '',
      };
    }

    _resolveAccountKey(key) {
      const flat = this._flatAccount();
      if (!Object.hasOwn(flat, key)) return '';
      const val = flat[key];
      if (val === undefined) return '';
      if (typeof val === 'object') return JSON.stringify(val);
      return Scratch.Cast.toString(val);
    }

    getAccountKey({ KEY }) { if (!this._authenticated) throw new Error('Not logged in'); return this._resolveAccountKey(KEY); }

    _waitForWS(ms = 5000) {
      if (this._wsReady) return Promise.resolve();
      return new Promise(resolve => {
        const deadline = Date.now() + ms;
        const id = setInterval(() => {
          if (this._wsReady || Date.now() > deadline) { clearInterval(id); resolve(); }
        }, 50);
      });
    }

    async loginWithToken({ TOKEN }) {
      this._token = Scratch.Cast.toString(TOKEN);
      await this._validateSavedToken();
      if (!this._authenticated) throw new Error('invalid_token');
      this._connectWS();
      await this._waitForWS();
    }

    async logout() {
      if (this._cancelPendingLogin) this._cancelPendingLogin();
      if (this._notifInterval) { clearInterval(this._notifInterval); this._notifInterval = null; }
      if (this._token) await this._http('/auth/logout', 'POST').catch(() => {});
      this._token = null;
      this._grantedScopes = 0;
      this._user = null;
      this._authenticated = false;
      this._accountObj = {};
      this._username = '';
      if (this._ws) {
        this._intentionalDisconnect = true;
        this._ws.close();
        this._ws = null;
      }
      this._wsReady = false;
      this._connected = false;
    }

    setStorageId({ ID }) { this._storageId = Scratch.Cast.toString(ID); }

    // ── Nookara Chat ──
    async _chatServer(ref) {
      this._requireScope(SCOPES.CHAT);
      const k = Scratch.Cast.toString(ref).trim().toLowerCase();
      if (!k) throw new Error('server_required');
      if (this._chatDetail[k]) return this._chatDetail[k];
      const d = await this._http(`/chat/servers/${encodeURIComponent(Scratch.Cast.toString(ref).trim())}`);
      if (d.error) throw (this._scopeErrorFromData(d) || new Error(d.error));
      this._chatDetail[k] = d;
      return d;
    }
    async _chatChannel(chRef, srvRef) {
      const d = await this._chatServer(srvRef);
      const r = Scratch.Cast.toString(chRef).trim().replace(/^#/, '').toLowerCase();
      const c = d.channels.find(x => x.cid === Scratch.Cast.toString(chRef).trim() || x.name === r);
      if (!c) throw new Error('channel_not_found');
      return { d, c };
    }
    async chatMyServers() {
      if (!this._authenticated) throw new Error('Not logged in');
      this._requireScope(SCOPES.CHAT);
      const d = await this._http('/chat/servers');
      if (d.error) throw (this._scopeErrorFromData(d) || new Error(d.error));
      this._chatServers = d.servers;
      return JSON.stringify(d.servers);
    }
    async chatJoinServer({ SERVER }) {
      this._requireScope(SCOPES.CHAT);
      const ref = Scratch.Cast.toString(SERVER).trim().split('/').pop();
      // a server ID (s...) / one listed in Discover, or an invite code
      let d = await this._http(`/chat/servers/${encodeURIComponent(ref)}/join`, 'POST');
      if (d.error === 'server_not_found') d = await this._http(`/chat/join/${encodeURIComponent(ref)}`, 'POST');
      this._lastActionOutput = JSON.stringify(d); this._lastActionSuccess = !d.error;
      if (d.error) throw (this._scopeErrorFromData(d) || new Error(d.error));
      this._chatServers = null;
    }
    async chatLeaveServer({ SERVER }) {
      this._requireScope(SCOPES.CHAT);
      await this._cmd(`/chat/servers/${encodeURIComponent(Scratch.Cast.toString(SERVER).trim())}/leave`, 'POST');
      this._chatServers = null; this._chatDetail = {};
    }
    async chatChannels({ SERVER }) {
      if (!this._authenticated) throw new Error('Not logged in');
      const d = await this._chatServer(SERVER);
      return JSON.stringify(d.channels);
    }
    async chatMembers({ SERVER }) {
      if (!this._authenticated) throw new Error('Not logged in');
      this._requireScope(SCOPES.CHAT);
      const d = await this._http(`/chat/servers/${encodeURIComponent(Scratch.Cast.toString(SERVER).trim())}/members`);
      if (d.error) throw (this._scopeErrorFromData(d) || new Error(d.error));
      d.members.forEach(m => { this._presence[m.username.toLowerCase()] = m.presence; });
      return JSON.stringify(d.members);
    }
    async chatOnlineMembers({ SERVER }) {
      const all = await this.chatMembers({ SERVER });
      if (all === 'Not logged in') return all;
      return JSON.stringify(JSON.parse(all).filter(m => m.presence && m.presence.status !== 'offline'));
    }
    async chatIsMember({ SERVER }) {
      if (!this._authenticated) return false;
      if (!this._chatServers) await this.chatMyServers().catch(() => null);
      const k = Scratch.Cast.toString(SERVER).trim().toLowerCase();
      return !!(this._chatServers || []).some(s => s.sid.toLowerCase() === k || s.name.toLowerCase() === k);
    }
    async chatSend({ MSG, CHANNEL, SERVER }) {
      const { c } = await this._chatChannel(CHANNEL, SERVER);
      const d = await this._http(`/chat/channels/${c.cid}/messages`, 'POST', { message: Scratch.Cast.toString(MSG) });
      this._lastActionOutput = JSON.stringify(d); this._lastActionSuccess = !d.error;
      if (d.error) throw (this._scopeErrorFromData(d) || new Error(d.error));
    }
    async chatMessages({ CHANNEL, SERVER }) {
      if (!this._authenticated) throw new Error('Not logged in');
      const { c } = await this._chatChannel(CHANNEL, SERVER);
      const d = await this._http(`/chat/channels/${c.cid}/messages?limit=100`);
      if (d.error) throw (this._scopeErrorFromData(d) || new Error(d.error));
      this._chatMsgs[c.cid] = d.messages;
      return JSON.stringify(d.messages);
    }
    async chatChannelLocked({ CHANNEL, SERVER }) {
      if (!this._authenticated) return false;
      const { c } = await this._chatChannel(CHANNEL, SERVER).catch(() => ({ c: null }));
      return !!c?.locked;
    }
    async chatCanPost({ CHANNEL, SERVER }) {
      if (!this._authenticated) return false;
      const { c } = await this._chatChannel(CHANNEL, SERVER).catch(() => ({ c: null }));
      return !!c?.can_post;
    }
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
    }
    whenAnyChatMessage() { const v = !!this._chatEvt['*']; this._chatEvt['*'] = false; return v; }
    chatLastMessage({ PROP }) {
      const m = this._lastChatMsg;
      if (!m) return '';
      if (PROP === 'JSON') return JSON.stringify(m);
      if (PROP === 'author') return m.author ? m.author.username : 'Nookara';
      if (PROP === 'channel') return m.channel;
      if (PROP === 'server') return m.server;
      if (PROP === 'id') return m.id;
      return m.body;
    }
    async chatTyping({ CHANNEL, SERVER }) {
      const { c } = await this._chatChannel(CHANNEL, SERVER);
      this._wsSend({ type: 'chat_typing', channel: c.cid });
    }
    async chatTypingUsers({ CHANNEL, SERVER }) {
      const { c } = await this._chatChannel(CHANNEL, SERVER).catch(() => ({ c: null }));
      const now = Date.now();
      return JSON.stringify(c ? Object.keys(this._chatTyping[c.cid] || {}).filter(u => this._chatTyping[c.cid][u] > now) : []);
    }

    // ── status + rich presence ──
    rpSet({ TYPE, NAME, DETAILS, STATE }) {
      if (!this._authenticated) throw new Error('Not logged in');
      const prev = this._rich || {};
      this._rich = { type: Scratch.Cast.toString(TYPE).trim().toLowerCase(), name: Scratch.Cast.toString(NAME), details: Scratch.Cast.toString(DETAILS), state: Scratch.Cast.toString(STATE),
        image: prev.image, since: prev.name === Scratch.Cast.toString(NAME) ? prev.since : Date.now() };
      this._wsSend({ type: 'set_rich_presence', activity: this._rich });
    }
    rpImage({ URL }) {
      const u = Scratch.Cast.toString(URL).trim();
      if (!this._rich) this._rich = { type: 'playing', name: this._projectName || 'a Nookara project', since: Date.now() };
      this._rich.image = /^https:\/\//i.test(u) ? u : undefined;
      this._wsSend({ type: 'set_rich_presence', activity: this._rich });
    }
    rpClear() { this._rich = null; this._wsSend({ type: 'clear_rich_presence' }); }
    async rpCustom({ TEXT }) {
      this._requireScope(SCOPES.CHAT);
      await this._cmd('/chat/presence/custom', 'POST', { text: Scratch.Cast.toString(TEXT) });
    }
    async _presenceOf(user) {
      const k = Scratch.Cast.toString(user).trim().toLowerCase();
      if (!k) return null;
      if (!this._presence[k]) {
        const d = await this._http(`/chat/presence/${encodeURIComponent(Scratch.Cast.toString(user).trim())}`).catch(() => ({}));
        if (!d.error && d.status) this._presence[k] = d;
      }
      return this._presence[k] || null;
    }
    async rpPresence({ USER }) {
      if (!this._authenticated) throw new Error('Not logged in');
      const p = await this._presenceOf(USER);
      return p ? JSON.stringify(p) : '';
    }
    async rpStatusOf({ USER }) {
      if (!this._authenticated) throw new Error('Not logged in');
      const p = await this._presenceOf(USER);
      return p ? p.status : 'offline';
    }
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
    async rpActivityOf({ USER }) {
      if (!this._authenticated) throw new Error('Not logged in');
      const p = await this._presenceOf(USER);
      const a = p?.activities?.[0];
      const verb = { playing: 'Playing', listening: 'Listening to', watching: 'Watching', competing: 'Competing in', streaming: 'Streaming' };
      if (a && a.platform === '3ds') return 'Playing on 3DS';
      if (a) return a.type === 'custom' ? a.name : `${verb[a.type] || 'Playing'} ${a.name}`;
      return p?.custom || '';
    }
    whenPresenceChanges({ USER }) {
      const u = Scratch.Cast.toString(USER).trim().toLowerCase();
      const k = !u || u === 'anyone' ? '*' : u;
      const v = !!this._presenceEvt[k];
      this._presenceEvt[k] = false;
      return v;
    }
    rpLastUser() { return this._lastPresenceUser || ''; }

    setStatus({ STATUS }) {
      this._status = STATUS;
      this._wsSend({ type: 'set_status', status: STATUS });
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

    async getStorage({ KEY }) {
      if (!this._storageId) throw new Error("No storage ID set. Use the 'set storage ID to' block first.");
      this._requireScope(SCOPES.STORAGE_READ);
      const data = await this._http(`/storage/${encodeURIComponent(this._storageId)}/${encodeURIComponent(KEY)}`).catch(() => ({}));
      return data.value ?? '';
    }

    async setStorage({ KEY, VALUE }) {
      if (!this._storageId) throw new Error("No storage ID set. Use the 'set storage ID to' block first.");
      this._requireScope(SCOPES.STORAGE_WRITE);
      await this._cmd(`/storage/${encodeURIComponent(this._storageId)}/${encodeURIComponent(KEY)}`, 'PUT', { value: VALUE });
    }

    async deleteStorageKey({ KEY }) {
      if (!this._storageId) throw new Error("No storage ID set. Use the 'set storage ID to' block first.");
      this._requireScope(SCOPES.STORAGE_WRITE);
      await this._cmd(`/storage/${encodeURIComponent(this._storageId)}/${encodeURIComponent(KEY)}`, 'DELETE');
    }

    async getAllStorageKeys() {
      if (!this._storageId) throw new Error("No storage ID set. Use the 'set storage ID to' block first.");
      this._requireScope(SCOPES.STORAGE_READ);
      const data = await this._http(`/storage/${encodeURIComponent(this._storageId)}/keys`).catch(() => ({}));
      return JSON.stringify(data.keys || []);
    }

    async getAllStorageValues() {
      if (!this._storageId) throw new Error("No storage ID set. Use the 'set storage ID to' block first.");
      this._requireScope(SCOPES.STORAGE_READ);
      const data = await this._http(`/storage/${encodeURIComponent(this._storageId)}/values`).catch(() => ({}));
      return JSON.stringify(data.values || []);
    }

    async clearStorage() {
      if (!this._storageId) throw new Error("No storage ID set. Use the 'set storage ID to' block first.");
      this._requireScope(SCOPES.STORAGE_WRITE);
      await this._cmd(`/storage/${encodeURIComponent(this._storageId)}`, 'DELETE');
    }

    async storageUsage() {
      this._requireScope(SCOPES.STORAGE_READ);
      const data = await this._http('/storage-info/info/usage').catch(() => ({}));
      return data.usage ?? 0;
    }
    async storageLimit() {
      this._requireScope(SCOPES.STORAGE_READ);
      const data = await this._http('/storage-info/info/usage').catch(() => ({}));
      return data.limit ?? 5242880;
    }
    async storageRemaining() {
      this._requireScope(SCOPES.STORAGE_READ);
      const data = await this._http('/storage-info/info/usage').catch(() => ({}));
      return data.remaining ?? 0;
    }
    async storageBiggest() {
      this._requireScope(SCOPES.STORAGE_READ);
      const data = await this._http('/storage-info/info/usage').catch(() => ({}));
      return JSON.stringify(data.breakdown || []);
    }

    _isUserOnline(user) {
      const u = Scratch.Cast.toString(user).trim().toLowerCase();
      return this._onlinePlayers.some(p => Scratch.Cast.toString(p.username).toLowerCase() === u);
    }

    // DMs are end-to-end encrypted, and a project can't keep keys safe (its storage is shared with whatever else runs on that site), so these blocks say so
    // DMs with people are end-to-end encrypted, but DMs with BOTS never are: send those as plain text (POST /im/send {to, message}).
    // The server answers e2ee_required for a person, and then the block says why it can't.
    async sendIM({ TO, MSG } = {}) {
      this._requireScope(SCOPES.VMAIL_SEND);
      const to = Scratch.Cast.toString(TO).trim();
      if (!to) throw new Error('Enter who to message.');
      this._lastActionSuccess = false;
      const data = await this._http('/im/send', 'POST', { to, message: Scratch.Cast.toString(MSG) });
      this._lastActionOutput = JSON.stringify(data);
      if (data.error === 'e2ee_required') return this._dmsEncrypted();
      if (data.error) throw (this._scopeErrorFromData(data) || new Error(data.message || data.error));
      this._lastActionSuccess = !!data.success;
      this._lastIMDelivered = !!data.delivered;
      return data;
    }

    lastIMSender()    { return this._lastIM?.from || ''; }
    lastIMContent()   { return this._lastIM?.body || ''; }
    lastIMStatusReply() { return this._lastIM?.status_reply?.text || ''; }

    // answers their CURRENT custom status (looked up first; the server refuses it if it changed or you can't DM them)
    _dmsEncrypted() {
      this._lastActionSuccess = false;
      throw new Error('Direct messages are end-to-end encrypted now, and a project cannot keep keys safe. People can message each other in Ember. Bots can be messaged from here: DMs with bots are plain text.');
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

    // legacy vMail block - subject is ignored now
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

    // takes back a request I sent that nobody answered yet. the id comes from the outgoing list
    async cancelFriendRequest({ USER }) {
      this._requireScope(SCOPES.FRIENDS_MANAGE);
      this._requireScope(SCOPES.FRIENDS_READ);
      const name = Scratch.Cast.toString(USER).trim().toLowerCase();
      const list = await this._http('/friends/requests');
      if (list.error) throw (this._scopeErrorFromData(list) || new Error(list.error));
      const req = (list.outgoing || []).find(r => String(r.to_username).toLowerCase() === name);
      if (!req) return;
      await this._cmd(`/friends/request/${encodeURIComponent(req.id)}`, 'DELETE');
    }

    // Ember's Inbox. these need Chat; saving or listing a DM also needs Read Instant Messages
    async inboxMentions({ LIMIT, BEFORE }) {
      const q = new URLSearchParams({ limit: String(Math.min(Math.max(Math.floor(Scratch.Cast.toNumber(LIMIT)) || 30, 1), 50)) });
      if (Scratch.Cast.toString(BEFORE).trim()) q.set('before', Scratch.Cast.toString(BEFORE).trim());
      return JSON.stringify(await this._bfRequest(`/chat/inbox/mentions?${q}`));
    }

    async savedMessages({ LIMIT, BEFORE }) {
      const q = new URLSearchParams({ limit: String(Math.min(Math.max(Math.floor(Scratch.Cast.toNumber(LIMIT)) || 50, 1), 100)) });
      if (Scratch.Cast.toString(BEFORE).trim()) q.set('before', Scratch.Cast.toString(BEFORE).trim());
      return JSON.stringify(await this._bfRequest(`/chat/saved?${q}`));
    }

    async saveMessage({ KIND, ID }) {
      const kind = Scratch.Cast.toString(KIND) === 'dm' ? 'dm' : 'channel';
      if (kind === 'dm') this._requireScope(SCOPES.VMAIL_READ);
      await this._bfRequest('/chat/saved', 'POST', { kind, id: Scratch.Cast.toString(ID).trim() });
    }

    async saveGroupMessage({ SNAPSHOT }) {
      let snapshot;
      try { snapshot = JSON.parse(Scratch.Cast.toString(SNAPSHOT)); } catch { throw new Error('Enter valid JSON.'); }
      await this._bfRequest('/chat/saved', 'POST', { kind: 'group', snapshot });
    }

    async unsaveMessage({ SAVEDID }) {
      await this._bfRequest(`/chat/saved/${encodeURIComponent(Scratch.Cast.toString(SAVEDID).trim())}`, 'DELETE');
    }

    async savedIdOfMessage({ KIND, ID }) {
      const kind = Scratch.Cast.toString(KIND) === 'dm' ? 'dm' : 'channel';
      const id = Scratch.Cast.toString(ID).trim();
      if (!id) return '';
      const data = await this._bfRequest('/chat/saved/check', 'POST', { kind, ids: [id] });
      return (data.saved && data.saved[id]) || '';
    }

    async translateText({ TEXT, LANG }) {
      const data = await this._bfRequest('/chat/translate', 'POST', { text: Scratch.Cast.toString(TEXT), to: Scratch.Cast.toString(LANG).trim() || 'en' });
      return data.text || '';
    }

    // Ember Beta: needs Chat. beta is true only with a running Ember Beta membership (selling the product doesn't count)
    async emberBetaStatus() {
      const data = await this._bfRequest('/chat/beta');
      return JSON.stringify({ beta: !!data.beta, membership: data.membership || null, product: data.product || null });
    }

    async hasEmberBeta() {
      const data = await this._bfRequest('/chat/beta');
      return !!data.beta;
    }

    // blocking: a blocked pair can't message, call, pay or friend each other; blocking also ends any friendship
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

    // "who can DM me": everyone | friends only | members in my servers (friends count as members). Staff always get through.
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

    async getBalance() {
      if (!this._authenticated) throw new Error('Not logged in');
      this._requireScope(SCOPES.CURRENCY_READ);
      const data = await this._http('/currency/balance').catch(() => ({}));
      return data.balance ?? 0;
    }

    // Sending credits needs the person to say yes: Nookara opens a popup ("<project> is trying to
    // make a payment to <user> of <n> credits") with Cancel / Pay, and Pay needs a captcha.
    // The block waits until they answer; closing the popup = cancel.
    async transferCredits({ AMOUNT, USER }) {
      this._requireScope(SCOPES.CURRENCY_PAY);
      const data = await this._http('/currency/transfer-request', 'POST', { to: Scratch.Cast.toString(USER), amount: parseInt(AMOUNT) });
      if (data.error) {
        this._lastActionOutput = JSON.stringify(data);
        this._lastActionSuccess = false;
        throw (this._scopeErrorFromData(data) || new Error(data.error));
      }
      let popup = null;
      try {
        popup = window.open(data.url, 'velora_payment', 'width=480,height=640,toolbar=no,menubar=no,location=no,scrollbars=yes,resizable=yes');
      } catch (_) {}
      if (!popup) {
        await this._http(`/currency/transfer-request/${data.id}/cancel`, 'POST').catch(() => {});
        this._lastActionSuccess = false;
        throw new Error('Popup blocked - allow popups for this page so you can confirm the payment.');
      }
      const result = await new Promise(resolve => {
        const started = Date.now();
        const t = setInterval(async () => {
          let s = null;
          try { s = await this._http(`/currency/transfer-request/${data.id}`); } catch (_) {}
          if (s && s.status && s.status !== 'pending') { clearInterval(t); resolve(s); return; }
          let closed = false;
          try { closed = popup.closed; } catch (_) {}
          if (closed || Date.now() - started > 11 * 60 * 1000) {
            clearInterval(t);
            // cancel only touches a pending request, so a payment that landed right as it closed still counts
            const c = await this._http(`/currency/transfer-request/${data.id}/cancel`, 'POST').catch(() => null);
            resolve(c && c.status ? c : { status: 'cancelled' });
          }
        }, 1500);
      });
      this._lastActionOutput = JSON.stringify(result);
      this._lastActionSuccess = result.status === 'paid';
      if (result.status !== 'paid') throw new Error(result.status === 'failed' ? (result.error || 'Payment failed') : `Payment ${result.status}`);
    }

    // Products (docs/PAYMENTS.md): adding to the cart moves no money, so it needs no credits scope. The person pays on the checkout page.
    async _addToCart(body) {
      if (!this._authenticated) throw new Error('Not logged in');
      const data = await this._http('/cart/items', 'POST', body);
      this._lastActionOutput = JSON.stringify(data);
      this._lastActionSuccess = !data.error;
      if (data.error) throw (this._scopeErrorFromData(data) || new Error(data.error));
    }
    async addProductToCart({ QUANTITY, ID }) {
      await this._addToCart({ product_id: Scratch.Cast.toString(ID), quantity: Math.max(1, Math.floor(Scratch.Cast.toNumber(QUANTITY))) });
    }
    async addMembershipToCart({ ID, PLAN }) {
      await this._addToCart({ product_id: Scratch.Cast.toString(ID), plan: Scratch.Cast.toString(PLAN) === 'yearly' ? 'yearly' : 'period' });
    }
    async addPaymentToCart({ AMOUNT, USER, NOTE }) {
      await this._addToCart({ to: Scratch.Cast.toString(USER), amount: Math.floor(Scratch.Cast.toNumber(AMOUNT)), note: Scratch.Cast.toString(NOTE) });
    }
    // needs Transfer Credits, and nobody sees a page: the person gets a notification. Anything that bills later has to go through checkout
    async _payDirect(items) {
      this._requireScope(SCOPES.CURRENCY_PAY);
      const quote = await this._http('/checkout/direct/quote', 'POST', { items });
      if (quote.error) throw (this._scopeErrorFromData(quote) || new Error(quote.error));
      const bad = quote.lines.find(l => l.problem);
      if (bad) throw new Error(bad.problem);
      const key = Array.from(crypto.getRandomValues(new Uint8Array(16)), x => x.toString(16).padStart(2, '0')).join('');
      const data = await this._http('/checkout/direct', 'POST', { items, idempotency_key: key, expected_total: quote.total });
      this._lastActionOutput = JSON.stringify(data);
      this._lastActionSuccess = !data.error;
      if (data.error) throw (this._scopeErrorFromData(data) || new Error(data.error));
    }
    async buyProductDirect({ QUANTITY, ID }) {
      await this._payDirect([{ product_id: Scratch.Cast.toString(ID), quantity: Math.max(1, Math.floor(Scratch.Cast.toNumber(QUANTITY))) }]);
    }
    async payUserDirect({ AMOUNT, USER, NOTE }) {
      await this._payDirect([{ to: Scratch.Cast.toString(USER), amount: Math.floor(Scratch.Cast.toNumber(AMOUNT)), note: Scratch.Cast.toString(NOTE) }]);
    }
    // waits until the checkout window is closed; ask "owns product" afterwards to see what happened
    async openCheckout() {
      let popup = null;
      try {
        popup = window.open(`${SERVER_HTTP}/checkout`, 'velora_checkout', 'width=980,height=760,toolbar=no,menubar=no,location=no,scrollbars=yes,resizable=yes');
      } catch (_) {}
      if (!popup) throw new Error('Popup blocked - allow popups for this page so you can check out.');
      await new Promise(resolve => {
        const started = Date.now();
        const t = setInterval(() => {
          let closed = false;
          try { closed = popup.closed; } catch (_) {}
          if (closed || Date.now() - started > 30 * 60 * 1000) { clearInterval(t); resolve(); }
        }, 700);
      });
    }
    async _productAccess(ID) {
      const data = await this._http(`/products/${encodeURIComponent(Scratch.Cast.toString(ID))}/access`);
      if (data.error) throw (this._scopeErrorFromData(data) || new Error(data.error));
      return data;
    }
    async ownsProduct({ ID }) {
      return !!(await this._productAccess(ID)).owned;
    }
    async productBoughtCount({ ID }) {
      return Number((await this._productAccess(ID)).count) || 0;
    }
    async membershipStatus({ ID }) {
      return (await this._productAccess(ID)).membership?.status || 'none';
    }
    async productInfo({ ID }) {
      const data = await this._http(`/products/${encodeURIComponent(Scratch.Cast.toString(ID))}`);
      if (data.error) throw new Error(data.error);
      return JSON.stringify(data.product);
    }

    async getTransactions() {
      if (!this._authenticated) throw new Error('Not logged in');
      this._requireScope(SCOPES.CURRENCY_READ);
      const data = await this._http('/currency/transactions').catch(() => ({}));
      return JSON.stringify(data.transactions || []);
    }

    async subscribe({ AMOUNT, USER, PERIOD, NOTE }) {
      this._requireScope(SCOPES.CURRENCY_PAY);
      await this._cmd('/currency/subscribe', 'POST', { to: USER, amount: parseInt(AMOUNT), period: PERIOD, note: NOTE });
    }

    async cancelSubscription({ USER }) {
      this._requireScope(SCOPES.CURRENCY_PAY);
      await this._cmd(`/currency/subscribe/user/${encodeURIComponent(USER)}`, 'DELETE');
    }

    async getOutgoingSubs() {
      if (!this._authenticated) throw new Error('Not logged in');
      this._requireScope(SCOPES.CURRENCY_READ);
      const data = await this._http('/currency/subscriptions/outgoing').catch(() => ({}));
      return JSON.stringify(data.subscriptions || []);
    }

    async getIncomingSubs() {
      if (!this._authenticated) throw new Error('Not logged in');
      this._requireScope(SCOPES.CURRENCY_READ);
      const data = await this._http('/currency/subscriptions/incoming').catch(() => ({}));
      return JSON.stringify(data.subscriptions || []);
    }

    _xhrUpload(path, body, isFormData, onProgress) {
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', SERVER_HTTP + path);
        if (this._token) xhr.setRequestHeader('Authorization', `Bearer ${this._token}`);
        if (!isFormData) xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const pct = Math.round(e.loaded / e.total * 100);
            if (onProgress) onProgress(pct);
            else this._uploadProgress = pct;
          }
        };
        xhr.onload = () => {
          if (!onProgress) this._uploadProgress = 100;
          try { resolve(JSON.parse(xhr.responseText)); } catch { resolve({}); }
        };
        xhr.onerror = () => reject(new Error('xhr_error'));
        xhr.send(isFormData ? body : JSON.stringify(body));
      });
    }

    async _blobFromUrl(url) {
      const resp = await fetch(url);
      return resp.blob();
    }

    async uploadImage({ DATA_URI, MODE }) {
      this._requireScope(SCOPES.MEDIA_UPLOAD);
      this._uploadStatus = 'uploading'; this._uploadProgress = 0;
      const doUpload = async () => {
        let data;
        if (typeof DATA_URI === 'string' && DATA_URI.startsWith('blob:')) {
          const blob = await this._blobFromUrl(DATA_URI);
          const fd = new FormData();
          fd.append('file', blob, 'image.jpg');
          data = await this._xhrUpload('/media/image', fd, true);
        } else {
          data = await this._xhrUpload('/media/image', { data: DATA_URI }, false);
        }
        this._lastActionOutput = JSON.stringify(data);
        this._lastActionSuccess = !!data.url;
        if (data.url) { this._lastUploadUrl = data.url; this._uploadStatus = 'done'; }
        else { this._uploadStatus = 'error'; }
        if (data.error) throw new Error(data.error);
      };
      if (MODE === 'wait' || MODE === undefined) await doUpload();
      else doUpload().catch(() => { this._uploadStatus = 'error'; this._lastActionSuccess = false; });
    }

    async uploadAudio({ DATA_URI, MODE }) {
      this._requireScope(SCOPES.MEDIA_UPLOAD);
      this._uploadStatus = 'uploading'; this._uploadProgress = 0;
      const doUpload = async () => {
        let data;
        if (typeof DATA_URI === 'string' && DATA_URI.startsWith('blob:')) {
          const blob = await this._blobFromUrl(DATA_URI);
          const fd = new FormData();
          const ext = (blob.type || 'audio/mpeg').split('/')[1] || 'mp3';
          fd.append('file', blob, `audio.${ext}`);
          data = await this._xhrUpload('/media/audio', fd, true);
        } else {
          data = await this._xhrUpload('/media/audio', { data: DATA_URI }, false);
        }
        this._lastActionOutput = JSON.stringify(data);
        this._lastActionSuccess = !!data.url;
        if (data.url) { this._lastUploadUrl = data.url; this._uploadStatus = 'done'; }
        else { this._uploadStatus = 'error'; }
        if (data.error) throw new Error(data.error);
      };
      if (MODE === 'wait' || MODE === undefined) await doUpload();
      else doUpload().catch(() => { this._uploadStatus = 'error'; this._lastActionSuccess = false; });
    }

    async uploadVideo({ DATA_URI, MODE }) {
      this._requireScope(SCOPES.MEDIA_UPLOAD);
      this._uploadStatus = 'uploading'; this._uploadProgress = 0;
      const doUpload = async () => {
        let data;
        if (typeof DATA_URI === 'string' && DATA_URI.startsWith('blob:')) {
          // splits into 10 MB pieces to stay under cf's 100 mb limit (boo)
          // grabs the actual File object if we have it instead of re-fetching the
          // blob url, way faster and doesn't load the whole thing into memory twice
          const fileBlob = (this._selectedFile && this._selectedFileUrl === DATA_URI)
            ? this._selectedFile
            : await this._blobFromUrl(DATA_URI);

          const mimeType = fileBlob.type || 'video/mp4';
          const originalName = this._selectedFileName || 'video.mp4';
          const CHUNK = 10 * 1024 * 1024; // 10 MB per chunk
          const total = Math.ceil(fileBlob.size / CHUNK);
          const sessionId = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

          for (let i = 0; i < total; i++) {
            const start = i * CHUNK;
            const chunk = fileBlob.slice(start, Math.min(start + CHUNK, fileBlob.size), mimeType);
            const fd = new FormData();
            fd.append('sessionId', sessionId);
            fd.append('chunkIndex', Scratch.Cast.toString(i));
            fd.append('totalChunks', Scratch.Cast.toString(total));
            fd.append('chunk', chunk, `chunk_${i}`);
            const chunkData = await this._xhrUpload('/media/video/chunk', fd, true, (pct) => {
              this._uploadProgress = Math.round((i / total + pct / 100 / total) * 95);
            });
            if (chunkData.error) throw new Error(chunkData.error);
          }

          this._uploadProgress = 97;
          data = await this._http('/media/video/finalize', 'POST', { sessionId, mimeType, originalName });
          this._uploadProgress = 100;
        } else {
          data = await this._xhrUpload('/media/video', { data: DATA_URI }, false);
        }
        this._lastActionOutput = JSON.stringify(data);
        this._lastActionSuccess = !!data.url;
        if (data.url) { this._lastUploadUrl = data.url; this._uploadStatus = 'done'; }
        else { this._uploadStatus = 'error'; }
        if (data.error) throw new Error(data.error);
      };
      if (MODE === 'wait' || MODE === undefined) await doUpload();
      else doUpload().catch(() => { this._uploadStatus = 'error'; this._lastActionSuccess = false; });
    }

    async uploadPfp({ DATA_URI, MODE }) {
      this._requireScope(SCOPES.ACCOUNT_WRITE);
      this._uploadStatus = 'uploading'; this._uploadProgress = 0;
      const doUpload = async () => {
        let data;
        if (typeof DATA_URI === 'string' && DATA_URI.startsWith('blob:')) {
          const blob = await this._blobFromUrl(DATA_URI);
          const fd = new FormData();
          fd.append('file', blob, 'pfp.jpg');
          data = await this._xhrUpload('/media/pfp', fd, true);
        } else {
          data = await this._xhrUpload('/media/pfp', { data: DATA_URI }, false);
        }
        this._lastActionOutput = JSON.stringify(data);
        this._lastActionSuccess = !!data.url;
        if (data.url) { this._lastUploadUrl = data.url; this._uploadStatus = 'done'; }
        else { this._uploadStatus = 'error'; }
        if (data.error) throw new Error(data.error);
      };
      if (MODE === 'wait' || MODE === undefined) await doUpload();
      else doUpload().catch(() => { this._uploadStatus = 'error'; this._lastActionSuccess = false; });
    }

    async setChatColor({ COLOR }) {
      this._requireScope(SCOPES.ACCOUNT_WRITE);
      await this._cmd('/account/update', 'PATCH', { color: COLOR });
    }

    // '' clears it. Refused names (reserved, a staff member's, invisible characters...) come back as the server's error
    async setDisplayName({ NAME }) {
      this._requireScope(SCOPES.ACCOUNT_WRITE);
      const name = Scratch.Cast.toString(NAME ?? '').trim();
      await this._cmd('/account/update', 'PATCH', { display_name: name || null });
    }

    async setPronouns({ PRONOUNS }) {
      this._requireScope(SCOPES.ACCOUNT_WRITE);
      await this._cmd('/account/update', 'PATCH', { pronouns: Scratch.Cast.toString(PRONOUNS ?? '') });
    }

    uploadProgress() { return this._uploadProgress; }

    openFilePicker({ TYPE }) {
      const acceptMap = {
        'videos':      'video/mp4,video/webm,video/quicktime,video/x-matroska,.mkv,.mov',
        'images':      'image/*',
        'audio files': 'audio/*',
      };
      return new Promise((resolve) => {
        this._fileSelected = false;
        this._selectedFileName = '';
        this._selectedFileSize = 0;
        this._selectedFile = null;
        // gotta manually clean up the old blob url or it just sits in memory forever
        if (this._selectedFileUrl) { try { URL.revokeObjectURL(this._selectedFileUrl); } catch (_) {} }
        this._selectedFileUrl = '';

        const input = document.createElement('input');
        input.type = 'file';
        input.accept = acceptMap[TYPE] || '*/*';
        input.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;';
        document.body.appendChild(input);

        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          window.removeEventListener('focus', onWindowFocus);
          try { document.body.removeChild(input); } catch (_) {}
          resolve();
        };

        input.addEventListener('cancel', finish);
        const onWindowFocus = () => setTimeout(() => { if (!done) finish(); }, 400);
        window.addEventListener('focus', onWindowFocus, { once: true });

        input.addEventListener('change', () => {
          window.removeEventListener('focus', onWindowFocus);
          const file = input.files && input.files[0];
          if (!file) { finish(); return; }

          // createObjectURL is basically instant no matter how big the file is,
          // it doesn't actually read the file into memory or anything
          this._selectedFile = file;
          this._selectedFileUrl = URL.createObjectURL(file);
          this._selectedFileName = file.name || '';
          this._selectedFileSize = file.size || 0;
          this._fileSelected = true;
          finish();
        });

        input.click();
      });
    }

    fileWasSelected()  { return this._fileSelected; }
    selectedFileUri()  { return this._selectedFileUrl; }
    selectedFileName() { return this._selectedFileName; }
    selectedFileSize() { return this._selectedFileSize; }

    async fetchLoginHistory() {
      if (!this._token) return;
      this._requireScope(SCOPES.PROFILE_SENSITIVE);
      const data = await this._cmd('/auth/login-history');
      this._loginHistory = data.history || [];
    }

    loginHistoryCount() { this._requireScope(SCOPES.PROFILE_SENSITIVE); return this._loginHistory.length; }
    loginHistoryJSON()  { this._requireScope(SCOPES.PROFILE_SENSITIVE); return JSON.stringify(this._loginHistory); }
    lastLoginDevice()   { this._requireScope(SCOPES.PROFILE_SENSITIVE); return this._loginHistory[0]?.browser_ua || ''; }
    // this isn't actually ur real ip!! its a hashed version, we don't keep raw ips
    // around anymore for privacy reasons. still useful for "is this the same
    // location as last time" type checks tho, just cant reverse it back into an ip
    lastLoginIP()       { this._requireScope(SCOPES.PROFILE_SENSITIVE); return this._loginHistory[0]?.ip_hash || ''; }

    async lookupUser({ USER }) {
      const data = await this._cmd(`/account/lookup/${encodeURIComponent(USER)}`);
      this._lookedUpUser = data;
      // Hyperfocus: what they're playing + playtime (only games that are in the launcher right now)
      this._lookedUpHF = await this._http(`/hyperfocus/profile/${encodeURIComponent(USER)}`).catch(() => ({})) || {};
      // Badge Arcade: unlocked badges + where they sit on the profile
      this._lookedUpArcade = await this._http(`/arcade/profile/${encodeURIComponent(USER)}`).catch(() => ({})) || {};
    }

    lookedUpUsername() { return this._lookedUpUser.username || ''; }
    lookedUpDisplayName() { return this._lookedUpUser.display_name || this._lookedUpUser.username || ''; } // (their username when they have none)
    lookedUpRank()     { return this._lookedUpUser.rank || ''; }
    lookedUpBio()      { return this._lookedUpUser.bio || ''; }
    lookedUpPronouns() { return this._lookedUpUser.pronouns || ''; }
    lookedUpPfp()      { return this._lookedUpUser.pfp_url || ''; }
    lookedUpCountry()  { return this._lookedUpUser.country_code || ''; }
    lookedUpJSON()     { return JSON.stringify(this._lookedUpUser); }

    // Hyperfocus launcher blocks
    _hfGame(game) {
      const q = Scratch.Cast.toString(game).trim().toLowerCase();
      return (this._lookedUpHF?.games || []).find(g => g.id.toLowerCase() === q || g.name.toLowerCase() === q);
    }
    lookedUpGame()      { return this._lookedUpHF?.playing?.name || ''; }
    lookedUpGameIcon()  { return this._lookedUpHF?.playing?.icon || ''; }
    lookedUpIsPlaying() { return !!this._lookedUpHF?.playing; }
    lookedUpPlaytime({ GAME }) { const g = this._hfGame(GAME); return g ? Math.round(g.seconds / 36) / 100 : 0; }
    lookedUpGames()     { return JSON.stringify(this._lookedUpHF?.games || []); }

    // Badge Arcade. Profile badge positions: x = centre as a fraction (0-1) of the profile's
    // width, y = centre in pixels from the top of the profile, size = width/height in pixels.
    _arcadeCollection() { return Array.isArray(this._lookedUpArcade?.collection) ? this._lookedUpArcade.collection : []; }
    _arcadeBoard()      { return Array.isArray(this._lookedUpArcade?.board) ? this._lookedUpArcade.board : []; }
    _arcadeFind(name)   { const q = Scratch.Cast.toString(name).trim().toLowerCase(); return this._arcadeCollection().find(b => b.name.toLowerCase() === q || Scratch.Cast.toString(b.id) === q); }
    lookedUpUnlockedBadges() {
      return JSON.stringify(this._arcadeCollection().map(b => ({ id: b.id, name: b.name, image: b.imageUrl, rarity: b.rarity, count: b.count })));
    }
    lookedUpUnlockedCount()           { return this._arcadeCollection().length; }
    lookedUpHasUnlocked({ NAME })     { return !!this._arcadeFind(NAME); }
    lookedUpUnlockedImage({ NAME })   { return this._arcadeFind(NAME)?.imageUrl || ''; }
    lookedUpProfileBadges() {
      return JSON.stringify(this._arcadeBoard().map(b => ({ badge: b.badge, name: b.name, image: b.imageUrl, rarity: b.rarity, x: b.x, y: b.y, size: b.size })));
    }
    lookedUpProfileBadgeCount()       { return this._arcadeBoard().length; }
    lookedUpProfileBadge({ PROP, N }) {
      const b = this._arcadeBoard()[Math.floor(Number(N)) - 1];
      if (!b) return '';
      return { name: b.name, 'image URL': b.imageUrl, x: b.x, y: b.y, size: b.size, 'badge id': b.badge, rarity: b.rarity }[Scratch.Cast.toString(PROP)] ?? '';
    }
    hyperfocusDownload() { return 'https://ikelene.net/launcher/'; }
    hyperfocusPlayLink({ GAME }) {
      const g = this._hfGame(GAME);
      return 'hyperfocus://play/' + encodeURIComponent(g ? g.id : Scratch.Cast.toString(GAME).trim());
    }

    badgeInfo({ BADGE }) {
      const b = this._badges.find(x => x.name === BADGE);
      return b ? JSON.stringify(b) : '';
    }

    async clearNotifications() {
      await this._cmd('/notifications/read-all', 'PATCH');
      this._notifications = [];
      this._lastNotifTitle = '';
      this._lastNotifBody = '';
    }
    // signed in through an App with Send Notifications: a notification to the person signed in, under "From apps"
    // (POST /account/notifications/send: 10 an hour, 50 a day)
    async sendNotificationToMe({ TITLE, BODY }) {
      await this._cmd('/account/notifications/send', 'POST', { title: Scratch.Cast.toString(TITLE), body: Scratch.Cast.toString(BODY) });
    }

    async _pollLoginHistory() {
      if (!this._token) return;
      if ((this._grantedScopes & SCOPES.PROFILE_SENSITIVE) !== SCOPES.PROFILE_SENSITIVE) return;
      const data = await this._http('/auth/login-history').catch(() => ({}));
      const history = data.history || [];
      if (this._knownLoginCount === -1) {
        this._knownLoginCount = history.length;
      } else if (history.length > this._knownLoginCount) {
        this._knownLoginCount = history.length;
        this._evtNewLogin = true;
        this._loginHistory = history;
      }
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

    // ── admin restrictions ─────────────────────────────────────────────────────
    // ── achievements ──────────────────────────────────────────────────────────
    // get achievements -> { "<id>": { name, description, icon, rarity, hidden, game, gameName, unlocked, unlockedAt } }
    // (hidden ones you don't have yet read "Hidden Achievement" / "Earn this to view it!")
    async _loadAchievements() {
      this._requireScope(SCOPES.PROFILE_READ);
      const data = await this._cmd('/achievements');
      this._achievements = data.achievements || {};
      return this._achievements;
    }
    async grantAchievement({ ID }) {
      this._requireScope(SCOPES.PROFILE_READ);
      const id = Scratch.Cast.toString(ID).trim();
      const data = await this._cmd(`/achievements/${encodeURIComponent(id)}/grant`, 'POST');
      if (data.achievement) { const { id: _i, ...a } = data.achievement; this._achievements[id] = { ...a, unlocked: true }; }
    }
    async revokeAchievement({ ID }) {
      this._requireScope(SCOPES.PROFILE_READ);
      const id = Scratch.Cast.toString(ID).trim();
      await this._cmd(`/achievements/${encodeURIComponent(id)}/revoke`, 'POST');
      if (this._achievements[id]) this._achievements[id] = { ...this._achievements[id], unlocked: false, unlockedAt: null };
    }
    async getAchievements() { return JSON.stringify(await this._loadAchievements()); }
    async hasAchievement({ ID }) {
      const id = Scratch.Cast.toString(ID).trim();
      if (!(id in this._achievements)) await this._loadAchievements().catch(() => {});
      return !!this._achievements[id]?.unlocked;
    }
    whenAchievementUnlocked() { const v = this._evtAchievement; this._evtAchievement = false; return v; }
    lastAchievement() { return this._lastAchievement ? JSON.stringify(this._lastAchievement) : '{}'; }

    serviceDisabled({ SERVICE }) {
      const bits = SERVICE_BITS[Scratch.Cast.toString(SERVICE).toLowerCase()] || 0;
      return !!bits && (this._disabledScopes & bits) !== 0;
    }

    // ── Nookara Voice ──────────────────────────────────────────────────────────
    // Voice rooms over the Nookara socket: {type:'voice', msg} JSON both ways, audio
    // as binary frames (out: raw Int16; in: [u16 idLen][sender id][Int16 PCM]).
    // Nookara rooms are WebRTC/SFU only.  Other Scratch party rooms retain the
    // legacy voice protocol for compatibility.
    _rtcReq(type, body = {}) {
      return new Promise((resolve, reject) => {
        const r = this._rtc, nonce = `scratch_rtc_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        r.pending.set(nonce, { resolve, reject });
        setTimeout(() => { const p = r.pending.get(nonce); if (p) { r.pending.delete(nonce); reject(new Error('Voice request timed out.')); } }, 20000);
        this._wsSend({ type, nonce, ...body });
      });
    }
    _rtcIce(pc) { return new Promise(done => { if (pc.iceGatheringState === 'complete') return done(); const f = () => { if (pc.iceGatheringState === 'complete') { pc.removeEventListener('icegatheringstatechange', f); done(); } }; pc.addEventListener('icegatheringstatechange', f); setTimeout(() => { pc.removeEventListener('icegatheringstatechange', f); done(); }, 5000); }); }
    async _rtcJoin(room) {
      if (!window.RTCPeerConnection) throw new Error('This Scratch environment does not support WebRTC voice.');
      this._rtcLeave(); this._rtc = { room, pending: new Map(), producer: null, consumer: null, stream: null, received: new Map(), people: [] };
      const r = this._rtc, joined = await this._rtcReq('chat_rtc_join', { room });
      r.producer = new RTCPeerConnection({ iceServers: joined.iceServers || [], iceTransportPolicy: 'all' });
      r.consumer = new RTCPeerConnection({ iceServers: joined.iceServers || [], iceTransportPolicy: 'all' });
      r.consumer.ontrack = e => { const a = new Audio(); a.autoplay = true; a.srcObject = new MediaStream([e.track]); a.volume = this._vGlobal / 100; r.received.set(e.track.id, a); a.play().catch(() => {}); };
      r.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, sampleRate: 48000 }, video: false });
      const tx = r.producer.addTransceiver(r.stream.getAudioTracks()[0], { direction: 'sendonly' });
      const offer = await r.producer.createOffer(); await r.producer.setLocalDescription(offer); await this._rtcIce(r.producer);
      const published = await this._rtcReq('chat_rtc_publish', { room, sessionDescription: r.producer.localDescription, tracks: [{ mid: tx.mid, trackName: 'audio' }] });
      await r.producer.setRemoteDescription(published.sessionDescription);
      this._v.room = room; this._vMicOn = true; this._rtcPeople(joined.people || []);
      await this._rtcSubscribe(joined.people || []);
    }
    async _rtcSubscribe(people) {
      const r = this._rtc; if (!r?.consumer || r.busy) return; r.busy = true;
      try { const sources = people.flatMap(p => (p.tracks || []).filter(t => t.trackName === 'audio').map(t => ({ userId: p.userId, trackName: t.trackName }))).filter(s => !r.seen?.has(`${s.userId}:${s.trackName}`)); if (!sources.length) return; r.seen ||= new Set(); sources.forEach(s => r.seen.add(`${s.userId}:${s.trackName}`)); const out = await this._rtcReq('chat_rtc_subscribe', { room: r.room, sources }); if (!out.sessionDescription) return; await r.consumer.setRemoteDescription(out.sessionDescription); const answer = await r.consumer.createAnswer(); await r.consumer.setLocalDescription(answer); await this._rtcIce(r.consumer); await this._rtcReq('chat_rtc_answer', { room: r.room, session: 'receive', sessionDescription: r.consumer.localDescription }); } finally { r.busy = false; }
    }
    _rtcPeople(people) { if (!this._rtc) return; this._rtc.people = people; const next = new Map(people.filter(p => p.username !== this._accountObj?.username).map(p => [Scratch.Cast.toString(p.userId), { id: Scratch.Cast.toString(p.userId), name: p.username, volume: 0, speaking: false }])); for (const [id, u] of next) if (!this._v.users.has(id)) this._vJoinQ.push(u.name); for (const [id, u] of this._v.users) if (!next.has(id)) this._vLeaveQ.push(u.name); this._v.users = next; }
    _rtcMessage(msg, failed = false) { const r = this._rtc; if (!r) return; const p = r.pending.get(msg.nonce); if (p) { r.pending.delete(msg.nonce); failed ? p.reject(new Error(msg.error || 'Voice request failed.')) : p.resolve(msg); } if (msg.type === 'chat_rtc_room' && msg.room === r.room) { this._rtcPeople(msg.people || []); this._rtcSubscribe(msg.people || []).catch(() => {}); } }
    _rtcLeave() { const r = this._rtc; if (!r) return; try { this._wsSend({ type: 'chat_rtc_leave', room: r.room }); } catch (_) {} r.stream?.getTracks().forEach(t => t.stop()); r.producer?.close(); r.consumer?.close(); r.received?.forEach(a => { a.pause(); a.srcObject = null; }); this._rtc = null; }
    _vFresh() { return { open: false, opening: null, room: null, id: null, users: new Map(), joinWait: null }; }
    async _vEnsureOpen() {
      if (!this._authenticated || !this._ws || this._ws.readyState !== 1) throw new Error('Log in to Nookara first.');
      this._requireScope(SCOPES.VOICE);
      if (this._v.open) return;
      if (!this._v.opening) {
        let resolve, reject;
        const promise = new Promise((a, b) => { resolve = a; reject = b; });
        this._v.opening = { promise, resolve, reject };
        setTimeout(() => {
          if (this._v.opening?.promise === promise) { this._v.opening = null; reject(new Error("Nookara Voice didn't answer - try again.")); }
        }, 8000);
        this._wsSend({ type: 'voice_connect' });
      }
      return this._v.opening.promise;
    }
    _vSend(m) { this._wsSend({ type: 'voice', msg: m }); }
    async _vEnsureAudio() {
      if (!this._vAudio || this._vAudio.state === 'closed') {
        const AC = window.AudioContext || window.webkitAudioContext;
        this._vAudio = new AC({ sampleRate: V_RATE });
        this._vMaster = this._vAudio.createGain();
        this._vMaster.gain.value = this._vGlobal / 100;
        this._vMaster.connect(this._vAudio.destination);
        this._vGains.clear();
      }
      if (this._vAudio.state === 'suspended') await this._vAudio.resume();
    }
    async _joinVoiceRoom(room) {
      if (/^bfc?_/.test(Scratch.Cast.toString(room))) return this._rtcJoin(Scratch.Cast.toString(room).slice(0, 64));
      await this._vEnsureOpen();
      await this._vEnsureAudio();
      await new Promise(resolve => {
        this._v.joinWait = resolve;
        this._vSend({ type: 'join', room: Scratch.Cast.toString(room).slice(0, 64) });
        setTimeout(() => { if (this._v.joinWait === resolve) { this._v.joinWait = null; resolve(); } }, 6000);
      });
      this._vStartVolume();
    }
    joinVoice({ ROOM }) { return this._joinVoiceRoom(Scratch.Cast.toString(ROOM || '').trim() || 'default'); }
    leaveVoice() {
      if (this._rtc) { this._rtcLeave(); this._vReset('left'); return; }
      if (this._v.room) this._vSend({ type: 'leave' });
      this._wsSend({ type: 'voice_disconnect' });
      this._vReset('left');
    }
    _vReset() {
      this._rtcLeave();
      if (this._vVolTimer) { clearInterval(this._vVolTimer); this._vVolTimer = null; }
      this._vStopMic();
      for (const t of this._vSilence.values()) clearTimeout(t);
      this._vSilence.clear();
      this._vQueues.clear();
      this._vGains.clear();
      if (this._vAudio) { try { this._vAudio.close(); } catch (_) {} this._vAudio = null; this._vMaster = null; }
      if (this._v.opening) { try { this._v.opening.reject(new Error('Nookara Voice closed.')); } catch (_) {} }
      this._v = this._vFresh();
      this._vMyVol = 0;
    }
    _vMessage(m) {
      switch (m.type) {
        case 'session': this._v.id = m.id; break;
        case 'joined':
          this._v.room = m.room;
          if (m.id) this._v.id = m.id;
          if (this._v.joinWait) { const r = this._v.joinWait; this._v.joinWait = null; r(); }
          break;
        case 'room_update': {
          const incoming = new Map((m.users || []).map(u => [u.id, u]));
          for (const [id, u] of incoming) if (id !== this._v.id && !this._v.users.has(id)) this._vJoinQ.push(u.name);
          for (const [id, u] of this._v.users) {
            if (!incoming.has(id)) {
              this._vLeaveQ.push(u.name);
              if (this._vSilence.has(id)) { clearTimeout(this._vSilence.get(id)); this._vSilence.delete(id); }
            }
          }
          const old = this._v.users;
          this._v.users = new Map();
          for (const [id, u] of incoming) {
            if (id === this._v.id) continue;
            const was = old.get(id);
            this._v.users.set(id, { id, name: u.name, volume: was?.volume ?? 0, speaking: was?.speaking ?? false, joinedAt: u.joinedAt });
          }
          if (this._vJoinQ.length > 50) this._vJoinQ.splice(0, this._vJoinQ.length - 50);
          if (this._vLeaveQ.length > 50) this._vLeaveQ.splice(0, this._vLeaveQ.length - 50);
          break;
        }
        case 'kicked': case 'party_ended': case 'party_missing':
          this._v.room = null;
          this._v.users.clear();
          break;
      }
    }
    _vIncoming(buffer) {
      if (!this._vAudio || this._vAudio.state === 'closed' || buffer.byteLength < 4) return;
      const idLen = new DataView(buffer).getUint16(0, true);
      if (buffer.byteLength < 2 + idLen + 2) return;
      const senderId = new TextDecoder().decode(new Uint8Array(buffer, 2, idLen));
      if (senderId === this._v.id) return;
      const pcm = buffer.slice(2 + idLen);
      const int16 = new Int16Array(pcm, 0, Math.floor(pcm.byteLength / 2));
      const f32 = new Float32Array(int16.length);
      let sum = 0;
      for (let i = 0; i < int16.length; i++) { const x = int16[i] / 32768; f32[i] = x; sum += x * x; }
      const volume = Math.sqrt(sum / (f32.length || 1)) * 100;
      if (!this._vQueues.has(senderId)) this._vQueues.set(senderId, { next: this._vAudio.currentTime });
      const q = this._vQueues.get(senderId);
      const now = this._vAudio.currentTime;
      if (q.next < now - 0.05 || q.next > now + 1.0) q.next = now + 0.05; // small jitter buffer
      const buf = this._vAudio.createBuffer(1, f32.length, V_RATE);
      buf.copyToChannel(f32, 0);
      const src = this._vAudio.createBufferSource();
      src.buffer = buf;
      src.connect(this._vGainFor(senderId));
      src.start(q.next);
      const delay = Math.max(0, (q.next - now) * 1000);
      q.next += buf.duration;
      setTimeout(() => {
        const u = this._v.users.get(senderId);
        if (!u) return;
        u.volume = Math.round(volume * 10) / 10;
        if (volume >= this._vThreshold) {
          u.speaking = true;
          if (this._vSilence.has(senderId)) { clearTimeout(this._vSilence.get(senderId)); this._vSilence.delete(senderId); }
        } else if (!this._vSilence.has(senderId)) {
          this._vSilence.set(senderId, setTimeout(() => {
            const x = this._v.users.get(senderId);
            if (x) { x.speaking = false; x.volume = 0; }
            this._vSilence.delete(senderId);
          }, 750));
        }
      }, delay);
    }
    _vGainFor(id) {
      if (!this._vGains.has(id)) {
        const g = this._vAudio.createGain();
        g.gain.value = this._vUserGain(id);
        g.connect(this._vMaster);
        this._vGains.set(id, g);
      }
      return this._vGains.get(id);
    }
    _vUserGain(id) {
      const u = this._v.users.get(id);
      const st = u ? this._vUserSettings.get(u.name) : null;
      return !st ? 1 : st.muted ? 0 : st.volume / 100;
    }
    _vApplyUser(name) {
      for (const [id, u] of this._v.users) if (u.name === name && this._vGains.has(id)) this._vGains.get(id).gain.value = this._vUserGain(id);
    }
    async voiceMic({ STATE }) {
      if (this._rtc?.stream) { this._rtc.stream.getAudioTracks().forEach(t => { t.enabled = STATE === 'on'; }); this._vMicOn = STATE === 'on'; return; }
      if (STATE === 'on') await this._vStartMic(); else this._vStopMic();
    }
    async _vStartMic() {
      if (this._vMicOn) return;
      this._requireScope(SCOPES.VOICE);
      await this._vEnsureAudio();
      this._vMicStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1, sampleRate: V_RATE }, video: false,
      });
      this._vMicSrc = this._vAudio.createMediaStreamSource(this._vMicStream);
      this._vProc = this._vAudio.createScriptProcessor(V_CHUNK, 1, 1);
      this._vProc.onaudioprocess = e => {
        const input = e.inputBuffer.getChannelData(0);
        e.outputBuffer.getChannelData(0).fill(0);
        let sum = 0;
        for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
        this._vMyVol = Math.sqrt(sum / input.length) * 100;
        if (this._v.room && this._ws && this._ws.readyState === 1) {
          const out = new Int16Array(input.length);
          for (let i = 0; i < input.length; i++) out[i] = Math.max(-32768, Math.min(32767, input[i] * 32768));
          this._ws.send(out.buffer);
        }
      };
      this._vMicSrc.connect(this._vProc);
      this._vProc.connect(this._vAudio.destination);
      this._vMicOn = true;
    }
    _vStopMic() {
      if (this._vProc) { this._vProc.disconnect(); this._vProc = null; }
      if (this._vMicSrc) { this._vMicSrc.disconnect(); this._vMicSrc = null; }
      if (this._vMicStream) { this._vMicStream.getTracks().forEach(t => t.stop()); this._vMicStream = null; }
      this._vMicOn = false;
      this._vMyVol = 0;
    }
    _vStartVolume() {
      if (this._vVolTimer) clearInterval(this._vVolTimer);
      this._vVolTimer = setInterval(() => {
        if (!this._v.room) return;
        this._vSend({ type: 'volume', volume: Math.round(this._vMyVol * 10) / 10, speaking: this._vMyVol >= this._vThreshold });
      }, 100);
    }
    voiceThreshold({ T }) { this._vThreshold = Math.max(0, Math.min(100, Number(T) || 0)); }
    inVoice()       { return !!this._v.room; }
    voiceMicOn()    { return this._vMicOn; }
    voiceRoom()     { return this._v.room || ''; }
    voiceMyVolume() { return Math.round(this._vMyVol * 10) / 10; }
    _vUserList(filter) {
      return JSON.stringify([...this._v.users.values()].filter(filter).map(u => ({ name: u.name, volume: Math.round(u.volume * 10) / 10, speaking: u.speaking, joinedAt: u.joinedAt })));
    }
    voicePeople()   { return this._vUserList(() => true); }
    voiceSpeaking() { return this._vUserList(u => u.speaking); }
    voiceUserVolume({ USER })   { for (const u of this._v.users.values()) if (u.name === Scratch.Cast.toString(USER)) return Math.round(u.volume * 10) / 10; return 0; }
    voiceUserSpeaking({ USER }) { for (const u of this._v.users.values()) if (u.name === Scratch.Cast.toString(USER)) return u.speaking; return false; }
    voiceSetVolume({ V }) {
      this._vGlobal = Math.max(0, Math.min(200, Number(V) || 0));
      if (this._rtc) for (const a of this._rtc.received.values()) a.volume = Math.min(1, this._vGlobal / 100);
      if (this._vMaster) this._vMaster.gain.value = this._vGlobal / 100;
    }
    voiceSetUserVolume({ USER, V }) {
      const name = Scratch.Cast.toString(USER);
      const st = this._vUserSettings.get(name) || { volume: 100, muted: false };
      st.volume = Math.max(0, Math.min(200, Number(V) || 0));
      this._vUserSettings.set(name, st);
      this._vApplyUser(name);
    }
    voiceMuteUser({ USER, STATE }) {
      const name = Scratch.Cast.toString(USER);
      const st = this._vUserSettings.get(name) || { volume: 100, muted: false };
      st.muted = STATE === 'on';
      this._vUserSettings.set(name, st);
      this._vApplyUser(name);
    }
    // hat blocks are edge-triggered, so queued events go out one per true/false flip
    whenVoiceJoin() {
      if (this._vJoinFlip) { this._vJoinFlip = false; return false; }
      if (!this._vJoinQ.length) return false;
      this._vEventUser = this._vJoinQ.shift();
      this._vJoinFlip = true;
      return true;
    }
    whenVoiceLeave() {
      if (this._vLeaveFlip) { this._vLeaveFlip = false; return false; }
      if (!this._vLeaveQ.length) return false;
      this._vEventUser = this._vLeaveQ.shift();
      this._vLeaveFlip = true;
      return true;
    }
    voiceEventUser() { return this._vEventUser; }

    // calls
    voiceCallUser({ USER }) {
      this._requireScope(SCOPES.VOICE);
      if (!this._v.room) { this._vCallResult = 'failed: not in voice'; this._evtVoiceAnswered = true; return; }
      this._vCallResult = 'calling';
      this._wsSend({ type: 'voice_call', to: Scratch.Cast.toString(USER).trim(), room: this._v.room });
    }
    cancelVoiceCall() { if (this._vOutCall) this._wsSend({ type: 'voice_call_cancel', callId: this._vOutCall.callId }); }
    whenVoiceAnswered() { const v = this._evtVoiceAnswered; this._evtVoiceAnswered = false; return v; }
    voiceCallResult()   { return this._vCallResult; }
    whenVoiceCalled()   { const v = this._evtVoiceCalled; this._evtVoiceCalled = false; return v; }
    beingCalled()       { return !!this._vCall; }
    voiceCaller()       { return this._vCall?.from || ''; }
    answerVoiceCall({ ANSWER }) {
      if (!this._vCall) return;
      this._wsSend({ type: 'voice_call_answer', callId: this._vCall.callId, accept: ANSWER === 'accept' });
      this._vCall = null; // accepting: Nookara answers with voice_call_accepted and we join their room
    }

    callUser({ USER }) {
      const callId = Math.random().toString(36).slice(2);
      this._callData = { callId };
      this._wsSend({ type: 'call_user', to: USER, callId });
    }

    acceptCall() {
      if (this._callData?.from) {
        this._wsSend({ type: 'call_accept', to: this._callData.from, callId: this._callData.callId });
      }
    }

    setMic({ STATE }) {
      if (this._callData?.from || this._callData?.to) {
        const target = this._callData.from || this._callData.to;
        this._wsSend({ type: 'mic_state', to: target, muted: STATE === 'off', callId: this._callData.callId });
      }
    }

    stopCall() {
      const target = this._callData?.from || this._callData?.to;
      if (target) this._wsSend({ type: 'call_end', to: target, callId: this._callData.callId });
      this._callData = {};
    }
  }

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
    "opcode": "bfPostChatCalls",
    "blockType": "command",
    "text": "create / send Nookara calls options JSON [OPTIONS]",
    "arguments": {
      "OPTIONS": {
        "type": "string",
        "defaultValue": "{\"to\": \"username\"}"
      }
    },
    "method": "POST",
    "path": "/chat/calls",
    "params": [],
    "query": [],
    "body": true,
    "upload": false,
    "scopes": [
      2048,
      16384
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
  const VELORA_PERMS = { SEND: 1, MANAGE_CHANNELS: 2, MANAGE_SERVER: 4, MANAGE_ROLES: 8, KICK: 16, BAN: 32, MANAGE_MESSAGES: 64, MENTION_EVERYONE: 128, ATTACH: 256, ADMIN: 512, VIEW: 1024 };
  const bfString = value => Scratch.Cast.toString(value);
  const bfArg = (value = '', menu) => ({ type: Scratch.ArgumentType.STRING, defaultValue: value, ...(menu ? { menu } : {}) });
  const bfBlock = (opcode, blockType, text, args = {}) => ({ opcode, blockType, text, arguments: args });
  // pre-Bonfire routes for Nookara-hosted communities (read-only now) - see the note in getInfo below
  const BF_DEPRECATED_ROUTE = /^\/chat\/(invite|servers|discover|channels|messages|join|upload|notify|open|emojis|sounds|hooks|bridge|media\/(upload|external))(\/|$)/;
  const bfCoreBlocks = [
          { blockType: Scratch.BlockType.LABEL, text: 'Communities & Channels' },
          { opcode: 'chatMyServers',     blockType: Scratch.BlockType.REPORTER, text: "joined communities as JSON" },
          { opcode: 'chatJoinServer',    blockType: Scratch.BlockType.COMMAND,  text: 'join community on [SERVER] (URL or invite link)', arguments: { SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' } } },
          { opcode: 'chatLeaveServer',   blockType: Scratch.BlockType.COMMAND,  text: 'leave community on [SERVER]', arguments: { SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' } } },
          { opcode: 'chatChannels',      blockType: Scratch.BlockType.REPORTER, text: "channel directory for [SERVER] as JSON", arguments: { SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' } } },
          { opcode: 'chatMembers',       blockType: Scratch.BlockType.REPORTER, text: "member directory for [SERVER] as JSON", arguments: { SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' } } },
          { opcode: 'chatOnlineMembers', blockType: Scratch.BlockType.REPORTER, text: "active member directory for [SERVER] as JSON", arguments: { SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' } } },
          { opcode: 'chatIsMember',      blockType: Scratch.BlockType.BOOLEAN,  text: "membership active in [SERVER]?", arguments: { SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' } } },
          '---',
          { opcode: 'chatSend',          blockType: Scratch.BlockType.COMMAND,  text: 'send [MSG] in channel [CHANNEL] of server [SERVER]', arguments: { MSG: { type: Scratch.ArgumentType.STRING, defaultValue: 'Hello!' }, CHANNEL: { type: Scratch.ArgumentType.STRING, defaultValue: 'general' }, SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' } } },
          { opcode: 'chatMessages',      blockType: Scratch.BlockType.REPORTER, text: "channel history for [CHANNEL] in [SERVER] as JSON", arguments: { CHANNEL: { type: Scratch.ArgumentType.STRING, defaultValue: 'general' }, SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' } } },
          { opcode: 'chatChannelLocked', blockType: Scratch.BlockType.BOOLEAN,  text: "posting locked in [CHANNEL] of [SERVER]?", arguments: { CHANNEL: { type: Scratch.ArgumentType.STRING, defaultValue: 'announcements' }, SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' } } },
          { opcode: 'chatCanPost',       blockType: Scratch.BlockType.BOOLEAN,  text: "posting allowed in [CHANNEL] of [SERVER]?", arguments: { CHANNEL: { type: Scratch.ArgumentType.STRING, defaultValue: 'general' }, SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' } } },
          { opcode: 'whenChatMessage',   blockType: Scratch.BlockType.HAT,      text: 'when message received in channel [CHANNEL] of server [SERVER]', arguments: { CHANNEL: { type: Scratch.ArgumentType.STRING, defaultValue: 'general' }, SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' } } },
          { opcode: 'whenAnyChatMessage',blockType: Scratch.BlockType.HAT,      text: 'when a message is received in any channel' },
          { opcode: 'chatLastMessage',   blockType: Scratch.BlockType.REPORTER, text: "latest channel post: [PROP]", arguments: { PROP: { type: Scratch.ArgumentType.STRING, menu: 'chatMsgProps', defaultValue: 'text' } } },
          { opcode: 'chatTyping',        blockType: Scratch.BlockType.COMMAND,  text: 'show me typing in channel [CHANNEL] of server [SERVER]', arguments: { CHANNEL: { type: Scratch.ArgumentType.STRING, defaultValue: 'general' }, SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' } } },
          { opcode: 'chatTypingUsers',   blockType: Scratch.BlockType.REPORTER, text: "typing activity for [CHANNEL] in [SERVER] as JSON", arguments: { CHANNEL: { type: Scratch.ArgumentType.STRING, defaultValue: 'general' }, SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://chat.ikelene.net' } } },

          // what you're doing, shown under your name in Nookara Chat + on your profile
          { blockType: Scratch.BlockType.LABEL, text: 'Status & Rich Presence' },
          { opcode: 'rpSet',             blockType: Scratch.BlockType.COMMAND,  text: 'set activity: [TYPE] [NAME] details [DETAILS] state [STATE]', arguments: { TYPE: { type: Scratch.ArgumentType.STRING, menu: 'activityTypes', defaultValue: 'playing' }, NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'my game' }, DETAILS: { type: Scratch.ArgumentType.STRING, defaultValue: 'Level 1' }, STATE: { type: Scratch.ArgumentType.STRING, defaultValue: 'In a match' } } },
          { opcode: 'rpImage',           blockType: Scratch.BlockType.COMMAND,  text: 'set activity picture to [URL]', arguments: { URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://' } } },
          { opcode: 'rpClear',           blockType: Scratch.BlockType.COMMAND,  text: 'clear activity' },
          { opcode: 'rpCustom',          blockType: Scratch.BlockType.COMMAND,  text: 'set custom status to [TEXT]', arguments: { TEXT: { type: Scratch.ArgumentType.STRING, defaultValue: 'making games' } } },
          { opcode: 'rpPresence',        blockType: Scratch.BlockType.REPORTER, text: "[USER] presence details as JSON", arguments: { USER: { type: Scratch.ArgumentType.STRING, defaultValue: 'username' } } },
          { opcode: 'rpStatusOf',        blockType: Scratch.BlockType.REPORTER, text: "[USER] availability", arguments: { USER: { type: Scratch.ArgumentType.STRING, defaultValue: 'username' } } },
          { opcode: 'rpActivityOf',      blockType: Scratch.BlockType.REPORTER, text: "[USER] shared activity", arguments: { USER: { type: Scratch.ArgumentType.STRING, defaultValue: 'username' } } },
          { opcode: 'whenPresenceChanges', blockType: Scratch.BlockType.HAT,    text: 'when [USER] changes status or activity', arguments: { USER: { type: Scratch.ArgumentType.STRING, defaultValue: 'anyone' } } },
          { opcode: 'rpLastUser',        blockType: Scratch.BlockType.REPORTER, text: "account from latest presence update" },

          
  ];
  const bfOldChat = new Set(['sendGlobalMessage', 'getGlobalMessages', 'sendRoomMessage', 'getRoomMessages', 'joinRoom', 'setTyping', 'typingUsers', 'whenGlobalMessageReceived', 'whenRoomMessageReceived', 'lastMessageUser', 'lastMessageContent', 'lastMessageUserJson']);
  const bfInfo = VeloraExtension.prototype.getInfo;
  VeloraExtension.prototype.getInfo = function () {
    this._bfInit();
    const info = bfInfo.call(this);
    const core = new Set(bfCoreBlocks.map(b => b.opcode).filter(Boolean));
    const blocks = info.blocks.filter(b => typeof b !== 'object' || (!core.has(b.opcode) && !['Chatroom Messaging', 'Servers & Channels', 'Communities & Channels', 'Status & Rich Presence'].includes(b.text)));
    for (const block of blocks) if (bfOldChat.has(block?.opcode)) block.hideFromPalette = true;
    const index = blocks.findIndex(b => b.opcode === 'clientUsername');
    const extra = [
      ...bfCoreBlocks,
      { blockType: Scratch.BlockType.LABEL, text: 'Nookara Events & Permissions' },
      bfBlock('bfWhenEvent', Scratch.BlockType.HAT, 'when Nookara [EVENT]', { EVENT: bfArg('chat_message', 'bfEvents') }),
      bfBlock('bfEventJson', Scratch.BlockType.REPORTER, "latest Nookara event data as JSON"),
      bfBlock('bfEventField', Scratch.BlockType.REPORTER, "latest event detail [FIELD]", { FIELD: bfArg('type') }),
      bfBlock('bfServerPermissions', Scratch.BlockType.REPORTER, "permission mask for my account in [SERVER]", { SERVER: bfArg('https://chat.ikelene.net') }),
      bfBlock('bfChannelPermissions', Scratch.BlockType.REPORTER, "permission mask for my account in [CHANNEL] of [SERVER]", { CHANNEL: bfArg('general'), SERVER: bfArg('https://chat.ikelene.net') }),
      bfBlock('bfHasPermission', Scratch.BlockType.BOOLEAN, "permission [PERMISSION] granted in [CHANNEL] of [SERVER]?", { PERMISSION: bfArg('SEND', 'bfPermissions'), CHANNEL: bfArg('general'), SERVER: bfArg('https://chat.ikelene.net') }),
      bfBlock('bfPermissionBit', Scratch.BlockType.REPORTER, "numeric flag for permission [PERMISSION]", { PERMISSION: bfArg('SEND', 'bfPermissions') }),
      bfBlock('bfRoles', Scratch.BlockType.REPORTER, "role directory for [SERVER] as JSON", { SERVER: bfArg('https://chat.ikelene.net') }),
      bfBlock('bfSendReply', Scratch.BlockType.COMMAND, 'send [MSG] reply to [ID] attachments JSON [ATTACHMENTS] in channel [CHANNEL] of server [SERVER]', { MSG: bfArg('Hello!'), ID: bfArg(), ATTACHMENTS: bfArg('[]'), CHANNEL: bfArg('general'), SERVER: bfArg('https://chat.ikelene.net') }),
      bfBlock('bfTypingState', Scratch.BlockType.COMMAND, 'typing [STATE] in channel [CHANNEL] of server [SERVER]', { STATE: bfArg('on', 'onOff'), CHANNEL: bfArg('general'), SERVER: bfArg('https://chat.ikelene.net') }),
      bfBlock('bfJoinVoiceChannel', Scratch.BlockType.COMMAND, 'join voice channel [CHANNEL] of server [SERVER]', { CHANNEL: bfArg('Voice'), SERVER: bfArg('https://chat.ikelene.net') }),
      bfBlock('bfJoinCall', Scratch.BlockType.COMMAND, 'join Nookara call room [ROOM]', { ROOM: bfArg('bfc_') }),
      bfBlock('bfPlaySound', Scratch.BlockType.COMMAND, 'play Nookara sound [SOUND]', { SOUND: bfArg('snd') }),
      bfBlock('bfEditDM', Scratch.BlockType.COMMAND, 'edit direct message [ID] to [MSG]', { ID: bfArg(), MSG: bfArg('Hello!') }),
      { blockType: Scratch.BlockType.LABEL, text: 'Game Servers (Minecraft)' },
      bfBlock('bfGameServers', Scratch.BlockType.REPORTER, "game connections for [SERVER] as JSON", { SERVER: bfArg('https://chat.ikelene.net') }),
      bfBlock('bfGameStatus', Scratch.BlockType.REPORTER, "game connection detail [PROP] for [CHANNEL] in [SERVER]", { PROP: bfArg('online', 'bfGameProps'), CHANNEL: bfArg('minecraft'), SERVER: bfArg('https://chat.ikelene.net') }),
      bfBlock('bfGameOnline', Scratch.BlockType.BOOLEAN, "game connection online in [CHANNEL] of [SERVER]?", { CHANNEL: bfArg('minecraft'), SERVER: bfArg('https://chat.ikelene.net') }),
      bfBlock('bfGameConsole', Scratch.BlockType.REPORTER, "console history for [CHANNEL] in [SERVER] as JSON", { CHANNEL: bfArg('console'), SERVER: bfArg('https://chat.ikelene.net') }),
      bfBlock('bfGameCommand', Scratch.BlockType.COMMAND, 'run console command [COMMAND] in channel [CHANNEL] of server [SERVER]', { COMMAND: bfArg('list'), CHANNEL: bfArg('console'), SERVER: bfArg('https://chat.ikelene.net') }),
      bfBlock('bfGameCommandOutput', Scratch.BlockType.REPORTER, "latest console command response"),
      bfBlock('bfWhenGameStatus', Scratch.BlockType.HAT, 'when game status changes in channel [CHANNEL] of server [SERVER]', { CHANNEL: bfArg('minecraft'), SERVER: bfArg('https://chat.ikelene.net') }),
      bfBlock('bfWhenGameConsole', Scratch.BlockType.HAT, 'when console line in channel [CHANNEL] of server [SERVER]', { CHANNEL: bfArg('console'), SERVER: bfArg('https://chat.ikelene.net') }),
      bfBlock('bfGameLastLine', Scratch.BlockType.REPORTER, "latest received console entry"),
      bfBlock('bfMessageFromMinecraft', Scratch.BlockType.BOOLEAN, "latest post originated in Minecraft?"),
      bfBlock('bfMessageGameServer', Scratch.BlockType.REPORTER, "Minecraft connection tag from latest post"),
      bfBlock('bfMessageGameEvent', Scratch.BlockType.REPORTER, "Minecraft event type from latest post"),
      { blockType: Scratch.BlockType.LABEL, text: 'CloudLink Bridges' },
      bfBlock('bfCloudlinkStatus', Scratch.BlockType.REPORTER, "bridge detail [PROP] for [CHANNEL] in [SERVER]", { PROP: bfArg('state', 'bfCloudlinkProps'), CHANNEL: bfArg('global-chat'), SERVER: bfArg('https://chat.ikelene.net') }),
      bfBlock('bfCloudlinkConnected', Scratch.BlockType.BOOLEAN, "bridge connection active in [CHANNEL] of [SERVER]?", { CHANNEL: bfArg('global-chat'), SERVER: bfArg('https://chat.ikelene.net') }),
      bfBlock('bfMessageFromCloudlink', Scratch.BlockType.BOOLEAN, "latest post originated through CloudLink?"),
    ];
    // Communities moved to Bonfire servers, so the raw routes for Nookara's own (now read-only) communities are DEPRECATED:
    // hidden from the palette but still registered, so projects that already use them keep loading. Use the Bonfire blocks
    // (or "call [METHOD] [PATH] on [URL]") for the same things on a Bonfire server.
    let category = '';
    for (const spec of VELORA_ROUTES) {
      const next = spec.path.startsWith('/groups') ? 'groups' : spec.path.startsWith('/im') ? 'direct messages' : (spec.path.split('/')[2] || 'groups');
      const deprecated = BF_DEPRECATED_ROUTE.test(spec.path);
      if (!deprecated && next !== category) { category = next; extra.push({ blockType: Scratch.BlockType.LABEL, text: `Nookara API: ${category}` }); }
      extra.push({ opcode: spec.opcode, blockType: spec.blockType === 'reporter' ? Scratch.BlockType.REPORTER : Scratch.BlockType.COMMAND, text: spec.text, ...(deprecated ? { hideFromPalette: true } : {}), arguments: Object.fromEntries(Object.entries(spec.arguments).map(([k, a]) => [k, { ...a, type: Scratch.ArgumentType.STRING }])) });
    }
    blocks.splice(index < 0 ? blocks.length : index, 0, ...extra);
    info.blocks = blocks;
    info.menus = { ...info.menus,
      chatMsgProps: { acceptReporters: false, items: ['text', 'author', 'channel', 'server', 'id', 'JSON'] },
      activityTypes: { acceptReporters: false, items: ['playing', 'listening', 'watching', 'competing', 'streaming', 'custom'] },
      bfPermissions: { acceptReporters: true, items: Object.keys(VELORA_PERMS) },
      bfCloudlinkProps: { acceptReporters: true, items: ['state', 'online count', 'online users (JSON)', 'url', 'room', 'error', 'JSON'] },
      bfGameProps: { acceptReporters: true, items: ['online', 'player count', 'max players', 'players (JSON)', 'MOTD', 'version', 'last seen', 'JSON'] },
      bfEvents: { acceptReporters: true, items: ['any', 'chat_ready', 'chat_message', 'chat_message_update', 'chat_message_delete', 'chat_reactions', 'chat_pins_update', 'chat_starboard', 'chat_typing', 'chat_read', 'chat_server_update', 'chat_channels_update', 'chat_server_removed', 'chat_roles_update', 'chat_perms_changed', 'chat_member_update', 'chat_members_stale', 'chat_emojis_update', 'chat_voice_state', 'chat_call_state', 'chat_ephemeral', 'chat_error', 'presence_update', 'im_received', 'im_edited', 'im_reactions', 'im_deleted', 'im_pins_update', 'dm_typing', 'roomMessage', 'room_message_edited', 'room_message_reactions', 'room_message_deleted', 'room_pins_update', 'group_update', 'group_removed', 'modmail', 'modmail_staff', 'voice_sound', 'voice_sound_failed', 'game_status', 'game_console', 'game_linked', 'game_unlinked'] },
    };
    return info;
  };

  Object.assign(VeloraExtension.prototype, {
    async _chatServer(ref) {
      this._requireScope(SCOPES.CHAT);
      const k = Scratch.Cast.toString(ref).trim().toLowerCase();
      if (!k) throw new Error('server_required');
      if (this._chatDetail[k]) return this._chatDetail[k];
      const d = await this._bfRequest(`/chat/servers/${encodeURIComponent(Scratch.Cast.toString(ref).trim())}`);
      if (d.error) throw (this._scopeErrorFromData(d) || new Error(d.error));
      this._chatDetail[k] = d;
      return d;
    },
    async _chatChannel(chRef, srvRef) {
      const d = await this._chatServer(srvRef);
      const c = await this._instanceChannel(d.instance, chRef);
      return { d, c };
    },
    async chatMyServers() {
      if (!this._authenticated) throw new Error('Not logged in');
      this._requireScope(SCOPES.CHAT);
      const d = await this._bfRequest('/chat/servers');
      if (d.error) throw (this._scopeErrorFromData(d) || new Error(d.error));
      this._chatServers = d.servers;
      return JSON.stringify(d.servers);
    },
    async chatJoinServer({ SERVER }) {
      this._requireScope(SCOPES.CHAT);
      const ref = Scratch.Cast.toString(SERVER).trim().split('/').pop();
      // a server ID (s...) / one listed in Discover, or an invite code
      let d = await this._bfRequest(`/chat/servers/${encodeURIComponent(ref)}/join`, 'POST');
      if (d.error === 'server_not_found') d = await this._bfRequest(`/chat/join/${encodeURIComponent(ref)}`, 'POST');
      this._lastActionOutput = JSON.stringify(d); this._lastActionSuccess = !d.error;
      if (d.error) throw (this._scopeErrorFromData(d) || new Error(d.error));
      this._chatServers = null;
    },
    async chatLeaveServer({ SERVER }) {
      this._requireScope(SCOPES.CHAT);
      await this._bfRequest(`/chat/servers/${encodeURIComponent(Scratch.Cast.toString(SERVER).trim())}/leave`, 'POST');
      this._chatServers = null; this._chatDetail = {};
    },
    async chatChannels({ SERVER }) {
      if (!this._authenticated) throw new Error('Not logged in');
      const d = await this._chatServer(SERVER);
      return JSON.stringify(d.channels);
    },
    async chatMembers({ SERVER }) {
      if (!this._authenticated) throw new Error('Not logged in');
      this._requireScope(SCOPES.CHAT);
      const d = await this._bfRequest(`/chat/servers/${encodeURIComponent(Scratch.Cast.toString(SERVER).trim())}/members`);
      if (d.error) throw (this._scopeErrorFromData(d) || new Error(d.error));
      d.members.forEach(m => { this._presence[m.username.toLowerCase()] = m.presence; });
      return JSON.stringify(d.members);
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
    async chatSend({ MSG, CHANNEL, SERVER }) {
      const { c } = await this._chatChannel(CHANNEL, SERVER);
      const d = await this._bfRequest(`/chat/channels/${c.cid}/messages`, 'POST', { message: Scratch.Cast.toString(MSG) });
      this._lastActionOutput = JSON.stringify(d); this._lastActionSuccess = !d.error;
      if (d.error) throw (this._scopeErrorFromData(d) || new Error(d.error));
    },
    async chatMessages({ CHANNEL, SERVER }) {
      if (!this._authenticated) throw new Error('Not logged in');
      const { c } = await this._chatChannel(CHANNEL, SERVER);
      const d = await this._bfRequest(`/chat/channels/${c.cid}/messages?limit=100`);
      if (d.error) throw (this._scopeErrorFromData(d) || new Error(d.error));
      this._chatMsgs[c.cid] = d.messages;
      return JSON.stringify(d.messages);
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
    async chatTyping({ CHANNEL, SERVER }) {
      const { c } = await this._chatChannel(CHANNEL, SERVER);
      this._wsSend({ type: 'chat_typing', channel: c.cid });
    },
    async chatTypingUsers({ CHANNEL, SERVER }) {
      const { c } = await this._chatChannel(CHANNEL, SERVER).catch(() => ({ c: null }));
      const now = Date.now();
      return JSON.stringify(c ? Object.keys(this._chatTyping[c.cid] || {}).filter(u => this._chatTyping[c.cid][u] > now) : []);
    },

    // ── status + rich presence ──
    rpSet({ TYPE, NAME, DETAILS, STATE }) {
      if (!this._authenticated) throw new Error('Not logged in');
      const prev = this._rich || {};
      this._rich = { type: Scratch.Cast.toString(TYPE).trim().toLowerCase(), name: Scratch.Cast.toString(NAME), details: Scratch.Cast.toString(DETAILS), state: Scratch.Cast.toString(STATE),
        image: prev.image, since: prev.name === Scratch.Cast.toString(NAME) ? prev.since : Date.now() };
      this._wsSend({ type: 'set_rich_presence', activity: this._rich });
    },
    rpImage({ URL }) {
      const u = Scratch.Cast.toString(URL).trim();
      if (!this._rich) this._rich = { type: 'playing', name: this._projectName || 'a Nookara project', since: Date.now() };
      this._rich.image = /^https:\/\//i.test(u) ? u : undefined;
      this._wsSend({ type: 'set_rich_presence', activity: this._rich });
    },
    rpClear() { this._rich = null; this._wsSend({ type: 'clear_rich_presence' }); },
    async rpCustom({ TEXT }) {
      this._requireScope(SCOPES.CHAT);
      await this._bfRequest('/chat/presence/custom', 'POST', { text: Scratch.Cast.toString(TEXT) });
    },
    async _presenceOf(user) {
      const k = Scratch.Cast.toString(user).trim().toLowerCase();
      if (!k) return null;
      if (!this._presence[k]) {
        const d = await this._bfRequest(`/chat/presence/${encodeURIComponent(Scratch.Cast.toString(user).trim())}`).catch(() => ({}));
        if (!d.error && d.status) this._presence[k] = d;
      }
      return this._presence[k] || null;
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

    _rtcReq(type, body = {}) {
      return new Promise((resolve, reject) => {
        const r = this._rtc, nonce = `scratch_rtc_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        r.pending.set(nonce, { resolve, reject });
        setTimeout(() => { const p = r.pending.get(nonce); if (p) { r.pending.delete(nonce); reject(new Error('Voice request timed out.')); } }, 20000);
        this._wsSend({ type, nonce, ...body });
      });
    },
    _rtcIce(pc) { return new Promise(done => { if (pc.iceGatheringState === 'complete') return done(); const f = () => { if (pc.iceGatheringState === 'complete') { pc.removeEventListener('icegatheringstatechange', f); done(); } }; pc.addEventListener('icegatheringstatechange', f); setTimeout(() => { pc.removeEventListener('icegatheringstatechange', f); done(); }, 5000); }); },
    async _rtcJoin(room) {
      if (!window.RTCPeerConnection) throw new Error('This Scratch environment does not support WebRTC voice.');
      this._rtcLeave(); this._rtc = { room, pending: new Map(), producer: null, consumer: null, stream: null, received: new Map(), people: [] };
      const r = this._rtc, joined = await this._rtcReq('chat_rtc_join', { room });
      r.producer = new RTCPeerConnection({ iceServers: joined.iceServers || [], iceTransportPolicy: 'all' });
      r.consumer = new RTCPeerConnection({ iceServers: joined.iceServers || [], iceTransportPolicy: 'all' });
      r.consumer.ontrack = e => { const a = new Audio(); a.autoplay = true; a.srcObject = new MediaStream([e.track]); a.volume = this._vGlobal / 100; r.received.set(e.track.id, a); a.play().catch(() => {}); };
      r.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, sampleRate: 48000 }, video: false });
      const tx = r.producer.addTransceiver(r.stream.getAudioTracks()[0], { direction: 'sendonly' });
      const offer = await r.producer.createOffer(); await r.producer.setLocalDescription(offer); await this._rtcIce(r.producer);
      const published = await this._rtcReq('chat_rtc_publish', { room, sessionDescription: r.producer.localDescription, tracks: [{ mid: tx.mid, trackName: 'audio' }] });
      await r.producer.setRemoteDescription(published.sessionDescription);
      this._v.room = room; this._vMicOn = true; this._rtcPeople(joined.people || []);
      await this._rtcSubscribe(joined.people || []);
    },
    async _rtcSubscribe(people) {
      const r = this._rtc; if (!r?.consumer || r.busy) return; r.busy = true;
      try { const sources = people.flatMap(p => (p.tracks || []).filter(t => t.trackName === 'audio').map(t => ({ userId: p.userId, trackName: t.trackName }))).filter(s => !r.seen?.has(`${s.userId}:${s.trackName}`)); if (!sources.length) return; r.seen ||= new Set(); sources.forEach(s => r.seen.add(`${s.userId}:${s.trackName}`)); const out = await this._rtcReq('chat_rtc_subscribe', { room: r.room, sources }); if (!out.sessionDescription) return; await r.consumer.setRemoteDescription(out.sessionDescription); const answer = await r.consumer.createAnswer(); await r.consumer.setLocalDescription(answer); await this._rtcIce(r.consumer); await this._rtcReq('chat_rtc_answer', { room: r.room, session: 'receive', sessionDescription: r.consumer.localDescription }); } finally { r.busy = false; }
    },
    _rtcPeople(people) { if (!this._rtc) return; this._rtc.people = people; const next = new Map(people.filter(p => p.username !== this._accountObj?.username).map(p => [Scratch.Cast.toString(p.userId), { id: Scratch.Cast.toString(p.userId), name: p.username, volume: 0, speaking: false }])); for (const [id, u] of next) if (!this._v.users.has(id)) this._vJoinQ.push(u.name); for (const [id, u] of this._v.users) if (!next.has(id)) this._vLeaveQ.push(u.name); this._v.users = next; },
    _rtcMessage(msg, failed = false) { const r = this._rtc; if (!r) return; const p = r.pending.get(msg.nonce); if (p) { r.pending.delete(msg.nonce); failed ? p.reject(new Error(msg.error || 'Voice request failed.')) : p.resolve(msg); } if (msg.type === 'chat_rtc_room' && msg.room === r.room) { this._rtcPeople(msg.people || []); this._rtcSubscribe(msg.people || []).catch(() => {}); } },
    _rtcLeave() { const r = this._rtc; if (!r) return; try { this._wsSend({ type: 'chat_rtc_leave', room: r.room }); } catch (_) {} r.stream?.getTracks().forEach(t => t.stop()); r.producer?.close(); r.consumer?.close(); r.received?.forEach(a => { a.pause(); a.srcObject = null; }); this._rtc = null; },

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
    // which scope a request path needs (the server checks too; this just makes the block fail fast with a proper message).
    // Only /chat, /groups and the Bonfire account routes are 'Chat Messaging'; the public bot gallery + server directory need nothing and Instant Messages has its own pair.
    _bfScopeFor(path, method) {
      const p = Scratch.Cast.toString(path).split('?')[0];
      if (method === 'GET' && (/^\/bonfire\/bots\/gallery(\/[^/]+)?$/.test(p) || p === '/bonfire/directory')) return 0;
      if (/^\/(im|mail)(\/|$)/.test(p)) return method === 'GET' ? SCOPES.VMAIL_READ : SCOPES.VMAIL_SEND;
      if (/^\/(chat|groups|bonfire)(\/|$)/.test(p)) return SCOPES.CHAT;
      return 0;
    },
    async _bfRequest(path, method = 'GET', body = null, form = null) {
      this._bfInit();
      if (BF_DEPRECATED_ROUTE.test(bfString(path).split('?')[0]) || /^\/chat\/game(\/|$)/.test(path)) throw new Error('Legacy Nookara community API retired: use the new ID-based Bonfire block with instance URL, server ID and channel ID.');
      const needScope = this._bfScopeFor(path, method);
      if (needScope) this._requireScope(needScope);
      else if (!this._token && method !== 'GET') throw new Error('Not logged in');
      this._lastActionSuccess = false;
      try {
        const options = { method, headers: this._token ? { Authorization: `Bearer ${this._token}` } : {} };
        if (form) options.body = form;
        else if (body !== null) { options.headers['Content-Type'] = 'application/json'; options.body = JSON.stringify(body); }
        const response = await fetch(SERVER_HTTP + path, options);
        const data = await response.json();
        this._lastActionOutput = JSON.stringify(data);
        if (!response.ok || data.error) throw (this._scopeErrorFromData(data) || new Error(data.error || `HTTP ${response.status}`));
        this._lastActionSuccess = true;
        if (method !== 'GET') { this._chatDetail = Object.create(null); this._chatServers = null; this._chatHatIds = Object.create(null); }
        return data;
      } catch (error) {
        this._lastActionSuccess = false;
        this._lastActionOutput = JSON.stringify({ error: error.message });
        throw error;
      }
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
    async bfJoinVoiceChannel({ CHANNEL, SERVER }) { this._requireScope(SCOPES.VOICE); const { c } = await this._chatChannel(CHANNEL, SERVER); if (c.type !== 'voice') throw new Error('Choose a voice channel.'); return this._rtcJoin(`bf_${c.cid}`); },
    bfJoinCall({ ROOM }) { this._requireScope(SCOPES.CHAT); this._requireScope(SCOPES.VOICE); if (!/^bfc_\w+$/.test(bfString(ROOM))) throw new Error('Invalid Nookara call room.'); return this._rtcJoin(bfString(ROOM)); },
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
    async bfEditDM() { this._requireScope(SCOPES.VMAIL_SEND); return this._dmsEncrypted(); }
  });

  for (const spec of VELORA_ROUTES) VeloraExtension.prototype[spec.opcode] = function (args) { return this._bfRoute(spec, args); };

  const bfHandleWS = VeloraExtension.prototype._handleWS;
  VeloraExtension.prototype._handleWS = function (msg) {
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
      case 'chat_error': this._lastActionSuccess = false; this._lastActionOutput = JSON.stringify(msg); this._rtcMessage(msg, true); return;
      case 'chat_rtc_joined': case 'chat_rtc_published': case 'chat_rtc_offer': case 'chat_rtc_ready': case 'chat_rtc_room': this._rtcMessage(msg); return;
      case 'voice_sound': if (msg.sound?.url && this._rtc) { const audio = new Audio(msg.sound.url); audio.volume = Math.min(1, this._vGlobal / 100); audio.play().catch(() => {}); } return;
    }
    bfHandleWS.call(this, msg);
    // Community chat is subscribed only on explicitly connected instance gateways.
  };

  // use the checked HTTP contract for the convenient name-based blocks too
  VeloraExtension.prototype._chatServer = async function (ref) {
    this._bfInit();
    return this._bfRequest(`/chat/servers/${encodeURIComponent(bfString(ref).trim())}`);
  };
  VeloraExtension.prototype.chatSend = async function ({ MSG, CHANNEL, SERVER }) { const { c } = await this._chatChannel(CHANNEL, SERVER); await this._bfRequest(`/chat/channels/${encodeURIComponent(c.cid)}/messages`, 'POST', { message: bfString(MSG) }); };
  VeloraExtension.prototype.chatMessages = async function ({ CHANNEL, SERVER }) { const { c } = await this._chatChannel(CHANNEL, SERVER); const d = await this._bfRequest(`/chat/channels/${encodeURIComponent(c.cid)}/messages?limit=100`); this._chatMsgs[c.cid] = d.messages; return JSON.stringify(d.messages); };
  VeloraExtension.prototype.chatMembers = async function ({ SERVER }) { const d = await this._bfRequest(`/chat/servers/${encodeURIComponent(bfString(SERVER).trim())}/members`); for (const m of d.members) this._presence[m.username.toLowerCase()] = m.presence; return JSON.stringify(d.members); };
  VeloraExtension.prototype.chatMyServers = async function () { const d = await this._bfRequest('/chat/servers'); this._chatServers = d.servers; return JSON.stringify(d.servers); };
  VeloraExtension.prototype.chatJoinServer = async function ({ SERVER }) {
    const ref = bfString(SERVER).trim().replace(/\/$/, '').split('/').pop();
    try { await this._bfRequest(`/chat/servers/${encodeURIComponent(ref)}/join`, 'POST', {}); }
    catch (error) { if (error.message !== 'server_not_found') throw error; await this._bfRequest(`/chat/join/${encodeURIComponent(ref)}`, 'POST', {}); }
  };
  VeloraExtension.prototype.chatLeaveServer = async function ({ SERVER }) { const d = await this._chatServer(SERVER); await this._bfRequest(`/chat/servers/${encodeURIComponent(d.server.sid)}/leave`, 'POST', {}); };
  const bfJoinVoice = VeloraExtension.prototype._joinVoiceRoom;
  VeloraExtension.prototype._joinVoiceRoom = function (room) { if (/^bfc?_/.test(room)) { this._requireScope(SCOPES.VOICE); return this._rtcJoin(room); } return bfJoinVoice.call(this, room); };
  const bfLeaveVoice = VeloraExtension.prototype.leaveVoice;
  VeloraExtension.prototype.leaveVoice = function () { this._rtcLeave(); return bfLeaveVoice.call(this); };
  const bfMic = VeloraExtension.prototype.voiceMic;
  VeloraExtension.prototype.voiceMic = function (args) { if (this._rtc?.stream) { this._rtc.stream.getAudioTracks().forEach(t => { t.enabled = args.STATE === 'on'; }); this._vMicOn = args.STATE === 'on'; return; } return bfMic.call(this, args); };
  const bfLogout = VeloraExtension.prototype.logout;
  VeloraExtension.prototype.logout = async function () { this._rtcLeave(); this._bfEvents = null; this._bfInit(); this._lastChatMsg = null; this._bfLastEvent = null; this._rich = null; return bfLogout.call(this); };

  const bfRtcJoin = VeloraExtension.prototype._rtcJoin;
  VeloraExtension.prototype._rtcJoin = async function (room) {
    this._requireScope(SCOPES.CHAT); this._requireScope(SCOPES.VOICE);
    if (!this._wsAuthed || this._ws?.readyState !== 1) throw new Error('Connect to Nookara before joining voice.');
    try { return await bfRtcJoin.call(this, room); }
    catch (error) { this._rtcLeave(); this._v.room = null; this._vMicOn = false; throw error; }
  };
  VeloraExtension.prototype._rtcReq = function (type, body = {}) {
    const r = this._rtc;
    if (!r) return Promise.reject(new Error('Not in Nookara voice.'));
    return new Promise((resolve, reject) => {
      const nonce = `scratch_rtc_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const timer = setTimeout(() => { r.pending.delete(nonce); reject(new Error('Voice request timed out.')); }, 20000);
      r.pending.set(nonce, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
      this._wsSend({ type, nonce, ...body });
    });
  };
  const bfRtcLeave = VeloraExtension.prototype._rtcLeave;
  VeloraExtension.prototype._rtcLeave = function () { if (this._rtc) for (const p of this._rtc.pending.values()) p.reject(new Error('Left Nookara voice.')); bfRtcLeave.call(this); };
  const bfReset = VeloraExtension.prototype._vReset;
  VeloraExtension.prototype._vReset = function (...args) { this._rtcLeave(); return bfReset.apply(this, args); };
  const bfVolume = VeloraExtension.prototype.voiceSetVolume;
  VeloraExtension.prototype.voiceSetVolume = function (args) { bfVolume.call(this, args); if (this._rtc) for (const audio of this._rtc.received.values()) audio.volume = Math.min(1, this._vGlobal / 100); };

  VeloraExtension.prototype._bfEnsureSocket = async function () {
    if (!this._token) throw new Error('Log in to Nookara first.');
    if (!this._ws || this._ws.readyState >= 2) { this._wsAuthed = false; this._connectWS(); }
    const deadline = Date.now() + 15000;
    while (!this._wsAuthed || this._ws?.readyState !== 1) {
      if (!this._token) throw new Error('Nookara socket authentication failed.');
      if (Date.now() >= deadline) throw new Error('Nookara socket authentication timed out.');
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  };
  VeloraExtension.prototype._waitForWS = function () { return this._bfEnsureSocket(); };
  VeloraExtension.prototype.rpSet = async function ({ TYPE, NAME, DETAILS, STATE }) {
    this._requireScope(SCOPES.CHAT);
    const name = bfString(NAME).trim();
    if (!name) throw new Error('Enter an activity name.');
    await this._bfEnsureSocket();
    const old = this._rich || {};
    this._rich = { type: bfString(TYPE).trim().toLowerCase(), name, details: bfString(DETAILS), state: bfString(STATE), image: old.image, since: old.name === name ? old.since : Date.now() };
    this._wsSend({ type: 'set_rich_presence', activity: this._rich });
  };
  VeloraExtension.prototype.rpImage = async function ({ URL }) {
    this._requireScope(SCOPES.CHAT);
    const url = bfString(URL).trim();
    if (url && !/^https:\/\//i.test(url)) throw new Error('Activity images need an HTTPS URL.');
    await this._bfEnsureSocket();
    this._rich ||= { type: 'playing', name: this._projectName || 'a Nookara project', since: Date.now() };
    this._rich.image = url || undefined;
    this._wsSend({ type: 'set_rich_presence', activity: this._rich });
  };
  VeloraExtension.prototype.rpClear = async function () {
    this._requireScope(SCOPES.CHAT);
    await this._bfEnsureSocket();
    this._rich = null;
    this._wsSend({ type: 'clear_rich_presence' });
  };
  VeloraExtension.prototype._presenceOf = async function (user) {
    const key = bfString(user).trim();
    if (!key) throw new Error('Enter a username.');
    const presence = await this._bfRequest(`/chat/presence/${encodeURIComponent(key)}`);
    this._presence[key.toLowerCase()] = presence;
    return presence;
  };
  const bfReadyRtcJoin = VeloraExtension.prototype._rtcJoin;
  VeloraExtension.prototype._rtcJoin = async function (room) {
    if (!this._voiceInstance19 || this._voiceInstance19.velora) { this._requireScope(SCOPES.CHAT); this._requireScope(SCOPES.VOICE); }
    await this._bfEnsureSocket();
    return bfReadyRtcJoin.call(this, room);
  };

  VeloraExtension.prototype._rtcPeople = function (people) {
    const r = this._rtc; if (!r) return;
    r.people = people;
    const next = new Map(people.filter(p => p.username.toLowerCase() !== this._username?.toLowerCase()).map(p => {
      const id = Scratch.Cast.toString(p.userId), old = this._v.users.get(id);
      return [id, { id, name: p.username, volume: old?.volume || 0, speaking: old?.speaking || false }];
    }));
    for (const [id, u] of next) if (!this._v.users.has(id)) this._vJoinQ.push(u.name);
    for (const [id, u] of this._v.users) if (!next.has(id)) this._vLeaveQ.push(u.name);
    this._v.users = next;
  };
  VeloraExtension.prototype._rtcSubscribe = async function (people) {
    const r = this._rtc; if (!r?.consumer) return;
    r.desired = people;
    if (r.busy) return;
    r.busy = true;
    try {
      while (r.desired && this._rtc === r) {
        const snapshot = r.desired; r.desired = null;
        const sources = snapshot.filter(p => p.username.toLowerCase() !== this._username?.toLowerCase()).flatMap(p => (p.tracks || []).filter(t => t.trackName === 'audio').map(t => ({ userId: p.userId, trackName: t.trackName })));
        const out = await this._rtcReq('chat_rtc_subscribe', { room: r.room, sources });
        const wanted = new Set(sources.map(s => Scratch.Cast.toString(s.userId)));
        for (const [mid, ref] of r.refs) if (!wanted.has(Scratch.Cast.toString(ref.userId))) {
          const node = r.nodes.get(mid); node?.source.disconnect(); node?.gain.disconnect();
          r.nodes.delete(mid); r.refs.delete(mid);
          r.received.get(mid)?.pause(); r.received.delete(mid);
        }
        if (!out.sessionDescription) continue;
        for (const ref of out.tracks || []) r.refs.set(Scratch.Cast.toString(ref.mid), ref);
        await r.consumer.setRemoteDescription(out.sessionDescription);
        await r.consumer.setLocalDescription(await r.consumer.createAnswer());
        await this._rtcIce(r.consumer);
        await this._rtcReq('chat_rtc_answer', { room: r.room, session: 'receive', sessionDescription: r.consumer.localDescription });
      }
    } finally { r.busy = false; }
  };
  VeloraExtension.prototype._rtcJoin = async function (room) {
    if (!this._voiceInstance19 || this._voiceInstance19.velora) { this._requireScope(SCOPES.CHAT); this._requireScope(SCOPES.VOICE); }
    await this._bfEnsureSocket();
    if (!globalThis.RTCPeerConnection) throw new Error('This Scratch environment does not support WebRTC voice.');
    const instanceVoice = this._voiceInstance19;
    this._rtcLeave(); this._voiceInstance19 = instanceVoice;
    const r = this._rtc = { room, pending: new Map(), received: new Map(), refs: new Map(), nodes: new Map(), people: [] };
    try {
      const joined = await this._rtcReq('chat_rtc_join', { room });
      if (this._rtc !== r) throw new Error('Left Nookara voice.');
      await this._vEnsureAudio();
      r.producer = new RTCPeerConnection({ iceServers: joined.iceServers || [] });
      r.consumer = new RTCPeerConnection({ iceServers: joined.iceServers || [] });
      r.consumer.ontrack = e => {
        const mid = Scratch.Cast.toString(e.transceiver.mid), ref = r.refs.get(mid);
        if (!ref || this._rtc !== r) return;
        const stream = new MediaStream([e.track]);
        // Chromium needs an active media element to start decoding remote RTC audio.
        // Output goes through the gain graph so volume above 100 percent also works.
        const audio = new Audio(); audio.srcObject = stream; audio.muted = true;
        audio.play().catch(() => {}); r.received.set(mid, audio);
        const source = this._vAudio.createMediaStreamSource(stream);
        const gain = this._vAudio.createGain(), analyser = this._vAudio.createAnalyser(); analyser.fftSize = 256;
        source.connect(analyser); source.connect(gain); gain.connect(this._vMaster);
        r.nodes.set(mid, { source, gain, analyser, ref });
        this._vApplyUser(ref.username);
      };
      r.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      if (this._rtc !== r) { r.stream.getTracks().forEach(t => t.stop()); throw new Error('Left Nookara voice.'); }
      const tx = r.producer.addTransceiver(r.stream.getAudioTracks()[0], { direction: 'sendonly' });
      await r.producer.setLocalDescription(await r.producer.createOffer()); await this._rtcIce(r.producer);
      const published = await this._rtcReq('chat_rtc_publish', { room, sessionDescription: r.producer.localDescription, tracks: [{ mid: tx.mid, trackName: 'audio' }] });
      await r.producer.setRemoteDescription(published.sessionDescription);
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => finish(new Error('Voice connection timed out.')), 20000);
        const finish = error => { clearTimeout(timer); r.producer.removeEventListener('connectionstatechange', check); r.cancelConnect = null; error ? reject(error) : resolve(); };
        const check = () => { const state = r.producer.connectionState; if (state === 'connected') finish(); else if (['failed', 'closed'].includes(state)) finish(new Error('Voice connection failed.')); };
        r.cancelConnect = () => finish(new Error('Left Nookara voice.'));
        r.producer.addEventListener('connectionstatechange', check); check();
      });
      this._v.room = room; this._vMicOn = true;
      this._wsSend({ type: 'chat_rtc_connected', room });
      this._rtcPeople(joined.people || []);
      await this._rtcSubscribe(joined.people || []);
      r.localSource = this._vAudio.createMediaStreamSource(r.stream);
      r.localAnalyser = this._vAudio.createAnalyser(); r.localAnalyser.fftSize = 256; r.localSource.connect(r.localAnalyser);
      const level = analyser => { const data = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(data); return Math.sqrt(data.reduce((sum, n) => sum + n * n, 0) / data.length) * 100; };
      r.meter = setInterval(() => {
        this._vMyVol = this._vMicOn ? level(r.localAnalyser) : 0;
        for (const n of r.nodes.values()) { const u = this._v.users.get(Scratch.Cast.toString(n.ref.userId)); if (u) { u.volume = level(n.analyser); u.speaking = u.volume >= this._vThreshold; } }
      }, 100);
    } catch (error) { if (this._rtc === r) this._rtcLeave(); throw error; }
  };
  const bfApplyUser = VeloraExtension.prototype._vApplyUser;
  VeloraExtension.prototype._vApplyUser = function (name) {
    bfApplyUser.call(this, name);
    const settings = this._vUserSettings.get(name) || { volume: 100, muted: false };
    for (const node of this._rtc?.nodes?.values() || []) if (node.ref.username === name) node.gain.gain.value = settings.muted ? 0 : settings.volume / 100;
  };
  const bfDisposeRtc = VeloraExtension.prototype._rtcLeave;
  VeloraExtension.prototype._rtcLeave = function () {
    const r = this._rtc;
    if (r) { clearInterval(r.meter); r.cancelConnect?.(); r.localSource?.disconnect(); for (const n of r.nodes?.values() || []) { n.source.disconnect(); n.gain.disconnect(); } }
    bfDisposeRtc.call(this);
    if (r) { this._v.room = null; this._v.users.clear(); this._vMicOn = false; this._vMyVol = 0; }
  };
  const bfOriginalCmd = VeloraExtension.prototype._cmd;
  VeloraExtension.prototype._cmd = function (path, method = 'GET', body = null) {
    return /^\/(chat|im)(\/|$)/.test(Scratch.Cast.toString(path)) ? this._bfRequest(path, method, body) : bfOriginalCmd.call(this, path, method, body);
  };
  VeloraExtension.prototype.chatTyping = async function (args) { return this.bfTypingState({ ...args, STATE: 'on' }); };
  const bfReadyTyping = VeloraExtension.prototype.bfTypingState;
  VeloraExtension.prototype.bfTypingState = async function (args) { await this._bfEnsureSocket(); return bfReadyTyping.call(this, args); };
  VeloraExtension.prototype._fetchMail = async function () {
    if (!this._token) return;
    const data = await this._bfRequest('/im');
    this._mail = data.messages || data.mail || [];
    this._imUnread = this._mail.filter(m => !m.read).length;
  };
  if (VeloraExtension.prototype.callUser) {
    VeloraExtension.prototype.callUser = async function ({ USER }) {
      await this._bfEnsureSocket();
      const callId = Math.random().toString(36).slice(2);
      this._callData = { callId, to: bfString(USER).trim() };
      this._wsSend({ type: 'call_user', to: this._callData.to, callId });
    };
  }
  // The former account notes endpoint was retired. Keep existing projects working
  // using the account's private Nookara storage, separately from project saves.
  if (VeloraExtension.prototype.getProfileNote) {
    const notePath = user => `/storage/velora_extension_profile_notes_v1/${encodeURIComponent(bfString(user).trim().toLowerCase())}`;
    VeloraExtension.prototype.getProfileNote = async function ({ USER }) {
      this._requireScope(SCOPES.STORAGE_READ);
      try { return (await this._bfRequest(notePath(USER))).value || ''; }
      catch (error) { if (error.message === 'key_not_found') return ''; throw error; }
    };
    VeloraExtension.prototype.setProfileNote = async function ({ USER, NOTE }) {
      this._requireScope(SCOPES.STORAGE_WRITE);
      if (!bfString(USER).trim()) throw new Error('Enter a username.');
      await this._bfRequest(notePath(USER), 'PUT', { value: bfString(NOTE) });
    };
    VeloraExtension.prototype.deleteProfileNote = async function ({ USER }) {
      this._requireScope(SCOPES.STORAGE_WRITE);
      await this._bfRequest(notePath(USER), 'DELETE');
    };
  }


  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // Bonfire communities (v1.8.0): explicit connections; projects manage retries
  //
  // Communities no longer live on Nookara. Each one lives on a Bonfire server ("instance": chat.ikelene.net, a hosted
  // *.ikelene.net server, or a self-hosted one) and Nookara is just the identity provider. So every block here picks the
  // server with a [URL] (or, in the older blocks, a [SERVER] that is either a URL or the name / id of a community on a
  // server you're explicitly connected to). Under the hood: Nookara gives us a short-lived instance token (POST /bonfire/instance-token,
  // needs Chat Messaging), we swap it for an instance session and then talk to INSTANCE/api/v1 + INSTANCE/gateway directly.
  // The sessions stay in memory only; a project just remembers which server URLs it uses.
  // Use connect to instance explicitly, then JSON reporters to obtain server and channel IDs.
  // Gateway failures never reconnect: inspect connection state/error and retry from the project.
  // The joined reporter uses public discovery for disconnected rail entries (joined: null).
  //
  // Permissions: nothing here is "required". A project only REQUESTS scopes (Permission Integer from
  // nookara.cc/permissions) and the person signing in may untick any of them. A block whose scope is missing just
  // says so (see _missingScopeText) and everything else keeps working.
  //
  // MESSAGE SIGNING: when the person allowed 'Sign Messages' (SIGN_MESSAGES = 32768) and the server login is a Nookara
  // account, every message / reply / edit sent through these blocks is signed (PROTOCOL §8): the account's one Ed25519
  // signing key is fetched from Nookara (GET /bonfire/signing-key), imported as a NON-extractable WebCrypto key, kept in
  // memory only, and used to sign "bonfire-msg-v1\n" + canonical(payload). Without that scope - or on local-account servers -
  // messages are sent unsigned, which every server accepts (signing is never required). Webhook posts, bot posts and system
  // messages are never signed. A rotated key is picked up automatically (we refetch once on bad_signature).

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
  const instanceInfo = VeloraExtension.prototype.getInfo;
  VeloraExtension.prototype.getInfo = function () {
    const info = instanceInfo.call(this);
    const bonfire = [];
    for (const entry of instanceBlocks) {
      if (typeof entry === 'string') { bonfire.push({ blockType: Scratch.BlockType.LABEL, text: entry }); continue; }
      const [opcode, type, text, args] = entry;
      const block = bfBlock(opcode, Scratch.BlockType[type], text, Object.fromEntries(Object.entries(args).map(([name, spec]) => Array.isArray(spec) ? [name, bfArg(spec[0], spec[1])] : [name, bfArg(spec)])));
      if (type === 'HAT' && opcode === 'biWhenMessage') block.isEdgeActivated = false;
      bonfire.push(block);
    }
    // the Bonfire blocks sit right after the older community blocks, before Status & Rich Presence
    const at = info.blocks.findIndex(b => b && b.blockType === Scratch.BlockType.LABEL && b.text === 'Status & Rich Presence');
    info.blocks.splice(at < 0 ? info.blocks.length : at, 0, ...bonfire);
    info.blocks.push({ blockType: Scratch.BlockType.LABEL, text: 'Extension' });
    info.blocks.push(bfBlock('extensionVersion', Scratch.BlockType.REPORTER, 'Nookara extension version'));
    info.menus = { ...info.menus,
      biInstanceProps: { acceptReporters: true, items: ['name', 'description', 'icon url', 'version', 'commit', 'build id', 'built at', 'protocol', 'accounts mode', 'registration', 'member count', 'join policy', 'community name', 'community id', 'read only', 'hosting plan', 'max upload MB', 'update available', 'JSON'] },
      biFeatures: { acceptReporters: true, items: ['voice', 'signing', 'uploads', 'youtube', 'minecraft', 'discord bridge', 'fluxer bridge', 'cloudlink bridge'] },
      biRoleActions: { acceptReporters: false, items: ['add', 'remove'] },
      biChannelTypes: { acceptReporters: true, items: ['text', 'voice', 'logs', 'welcome', 'link', 'starboard'] },
      biChannelProps: { acceptReporters: true, items: ['id', 'name', 'type', 'topic', 'locked', 'can post', 'JSON'] },
      biMethods: { acceptReporters: false, items: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] },
      biEvents: { acceptReporters: true, items: ['any', 'chat_message', 'chat_message_update', 'chat_message_delete', 'chat_reactions', 'chat_typing', 'chat_pins_update', 'chat_mention', 'chat_member_update', 'chat_channels_update', 'chat_roles_update', 'chat_server_update', 'chat_identity_update', 'chat_join_request', 'chat_join_result', 'chat_starboard', 'chat_stickers_update', 'chat_voice_state', 'instance_restarting', 'game_status', 'game_console'] },
      biLastProps: { acceptReporters: true, items: ['text', 'author name', 'author display name', 'author id', 'alias name', 'alias avatar', 'alias unmarked?', 'channel', 'id', 'reply to', 'signed', 'server says verified', 'attachments', 'JSON'] },
    };
    return info;
  };

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

  Object.assign(VeloraExtension.prototype, {
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
    extensionVersion() { return EXTENSION_VERSION; },
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
    // Deprecated resolution never logs in or opens a socket.
    async _bfConnectMine() {},
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
    const proto = VeloraExtension.prototype;
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
    reroute('bfJoinVoiceChannel', async function () {
      throw new Error('Voice on Bonfire servers runs over the server\'s own connection, which this extension can\'t join yet. Use the Bonfire app, or "voice channel info" for the details.');
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

  const instanceValidate = VeloraExtension.prototype._validateSavedToken;
  VeloraExtension.prototype._validateSavedToken = async function () {
    await instanceValidate.call(this);
    this._restoreInstances();
  };
  const instanceLogout = VeloraExtension.prototype.logout;
  VeloraExtension.prototype.logout = async function () {
    this._instanceSigningKey = null;
    this._instanceSigningToken = null;
    this._bfMineAt = 0;
    for (const state of this._instances.values()) if (state.velora) { state.cancelled = true; this._stopInstance(state); state.session = null; this._instanceTransition(state, 'disconnected'); this._instances.delete(state.origin); }
    return instanceLogout.call(this);
  };

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
    const implementation = VeloraExtension.prototype[old];
    VeloraExtension.prototype[opcode] = type === 'HAT' ? function (values) {
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

  Object.assign(VeloraExtension.prototype, {
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
  VeloraExtension.prototype.chatChannelLocked = async function ({ CHANNEL, SERVER }) { return !!(await this._chatChannel(CHANNEL, SERVER)).c.locked; };
  VeloraExtension.prototype.chatCanPost = async function ({ CHANNEL, SERVER }) { return !!(await this._chatChannel(CHANNEL, SERVER)).c.can_post; };
  // Keep biConnect as a deprecated alias. No deserialization, reporter or hat may initiate login.
  VeloraExtension.prototype.biConnect = VeloraExtension.prototype.biConnectInstance;
  const explicitInfo = VeloraExtension.prototype.getInfo;
  VeloraExtension.prototype.getInfo = function () {
    const info = explicitInfo.call(this);
    const hidden = new Set(idInstanceBlocks.map(entry => entry[4]).concat(['biConnect', 'biChannelId', 'biChannels', 'whenAnyChatMessage', 'chatLastMessage']));
    for (const block of info.blocks) {
      if (!block || !block.opcode) continue;
      if (hidden.has(block.opcode) || (block.arguments?.SERVER && !block.opcode.startsWith('bi'))) block.hideFromPalette = true;
    }
    const entries = [
      ['biConnectInstance', 'COMMAND', 'connect to instance [URL]', { URL: U }],
      ['biDisconnectInstance', 'COMMAND', 'disconnect from instance [URL]', { URL: U }],
      ['biConnectionState', 'REPORTER', 'instance [URL] connection state', { URL: U }],
      ['biConnectionError', 'REPORTER', 'instance [URL] last connection error', { URL: U }],
      ['biWhenState', 'HAT', 'when instance [URL] becomes [STATE]', { URL: U, STATE: ['connected', 'biConnectionStates'] }],
      ['biServers', 'REPORTER', 'servers of instance [URL] as JSON', { URL: U }],
      ['biServerChannels', 'REPORTER', 'channels of server ID [SERVER] on instance [URL] as JSON', { SERVER: 's1', URL: U }],
      ['biFindChannelId', 'REPORTER', 'channel ID named [NAME] in server ID [SERVER] on instance [URL]', { NAME: 'general', SERVER: 's1', URL: U }],
      ...idInstanceBlocks,
    ];
    const blocks = entries.map(([opcode, type, text, args]) => ({ ...bfBlock(opcode, Scratch.BlockType[type], text,
      Object.fromEntries(Object.entries(args).map(([key, value]) => [key, Array.isArray(value) ? bfArg(value[0], value[1]) : bfArg(value)]))),
      ...(type === 'HAT' ? { isEdgeActivated: false } : {}) }));
    // Put replacements beside their deprecated originals, preserving the section layout.
    for (const block of blocks) {
      const old = idInstanceBlocks.find(entry => entry[0] === block.opcode)?.[4];
      const marker = old || (['biServerChannels', 'biFindChannelId'].includes(block.opcode) ? 'biChannelId' :
        block.opcode === 'biServers' ? 'biCommunity' : 'biConnect');
      const at = info.blocks.findIndex(item => item?.opcode === marker);
      info.blocks.splice(at < 0 ? info.blocks.length : at, 0, block);
    }
    const helpAt = info.blocks.findIndex(block => block?.opcode === 'biConnectInstance');
    info.blocks.splice(helpAt, 0, { blockType: Scratch.BlockType.LABEL, text: 'Connect explicitly. Projects manage retries; JSON reporters provide IDs.' });
    info.menus.biConnectionStates = { acceptReporters: true, items: ['connecting', 'connected', 'disconnected', 'error'] };
    const connected = info.blocks.find(block => block.opcode === 'biConnectedList');
    connected.text = 'connected instances as JSON';
    const instances = info.blocks.find(block => block.opcode === 'biMyInstances');
    instances.text = 'saved instances from Nookara as JSON';
    return info;
  };


  // v1.9: existing project opcodes are the decentralized API. Resolution never connects.
  const migrationError = detail => new Error(detail + ': use the connect block and the server ID / channel ID (or an instance-scoped block).');
  const uiRoute = path => /^\/chat\/(gifs|klipy|modmail|unfurl|notify|open|settings|emojis|sounds|hooks|bridge)(\/|$)/.test(path) ||
    /^\/chat\/media(\/|$)/.test(path) && !/^\/chat\/media\/(upload|external)$/.test(path) ||
    /\/(emojis|sounds|webhooks|cloudlink)(\/|$)/.test(path) || /\/layout$/.test(path);
  // Presence, identities, Instant Messages and global bot-gallery identity remain Nookara services.
  const identityRoute = path => /^\/chat\/(presence|users|dm|calls|personal-emojis)(\/|$)/.test(path) || /^\/chat\/bots\/[^/]+\/gallery(\/|$)/.test(path);
  const nativeSpecs = VELORA_ROUTES.filter(spec => spec.path.startsWith('/chat/') && !identityRoute(spec.path));
  const migratedOps = new Set([...bfOldChat, ...bfCoreBlocks.filter(b => b.opcode?.startsWith('chat') || ['whenChatMessage', 'whenAnyChatMessage'].includes(b.opcode)).map(b => b.opcode),
    'bfWhenEvent', 'bfEventJson', 'bfEventField', 'bfServerPermissions', 'bfChannelPermissions', 'bfHasPermission', 'bfRoles', 'bfSendReply', 'bfTypingState', 'bfJoinVoiceChannel',
    'bfGameServers', 'bfGameStatus', 'bfGameOnline', 'bfGameConsole', 'bfGameCommand', 'bfWhenGameStatus', 'bfWhenGameConsole', 'bfCloudlinkStatus', 'bfCloudlinkConnected',
    ...nativeSpecs.map(s => s.opcode)]);
  const p19 = VeloraExtension.prototype;
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
  p19.bfJoinVoiceChannel = async function ({ CHANNEL, SERVER }) {
    const { state, channel } = await this._channel19(CHANNEL, SERVER);
    if (channel.type !== 'voice') throw new Error('Choose a voice channel ID.');
    this._rtcLeave(); this._voiceInstance19 = state;
    try { return await this._rtcJoin('bf_' + channel.cid); }
    catch (error) { this._rtcLeave(); throw error; }
  };
  const leaveRtc19 = p19._rtcLeave;
  p19._rtcLeave = function () { try { return leaveRtc19.call(this); } finally { this._voiceInstance19 = null; } };
  const joinCall19 = p19.bfJoinCall;
  p19.bfJoinCall = function (args) { this._rtcLeave(); return joinCall19.call(this, args); };
  const joinRoomVoice19 = p19._joinVoiceRoom;
  p19._joinVoiceRoom = async function (room) {
    if (/^bf_/.test(room)) {
      const { state, channel } = await this._channel19(room.slice(3));
      return this.bfJoinVoiceChannel({ SERVER: state.origin, CHANNEL: channel.cid });
    }
    this._rtcLeave();
    return joinRoomVoice19.call(this, room);
  };
  const send19 = p19._wsSend;
  p19._wsSend = function (frame) {
    if (frame.type?.startsWith('chat_rtc_') && this._voiceInstance19) {
      const state = this._voiceInstance19;
      if (!state.ready || state.socket?.readyState !== 1) throw migrationError('Voice instance not connected');
      state.socket.send(JSON.stringify(frame)); return;
    }
    return send19.call(this, frame);
  };
  const ensureSocket19 = p19._bfEnsureSocket;
  p19._bfEnsureSocket = function () {
    if (this._voiceInstance19) {
      if (!this._voiceInstance19.ready) throw migrationError('Voice instance not connected');
      return Promise.resolve();
    }
    return ensureSocket19.call(this);
  };
  const stop19 = p19._stopInstance;
  p19._stopInstance = function (state, ...args) {
    if (this._voiceInstance19 === state) { this._rtcLeave(); this._voiceInstance19 = null; }
    return stop19.call(this, state, ...args);
  };
  const palette19 = p19.getInfo;
  p19.getInfo = function () {
    const info = palette19.call(this);
    const reasons = {};
    for (const block of info.blocks) {
      if (!block?.opcode) continue;
      const spec = nativeSpecs.find(s => s.opcode === block.opcode);
      if (migratedOps.has(block.opcode)) delete block.hideFromPalette;
      // Original instance-scoped operations are retained; their new *Ids copies are redundant.
      if (instanceBlocks.some(e => Array.isArray(e) && e[0] === block.opcode)) delete block.hideFromPalette;
      if (idInstanceBlocks.some(e => e[0] === block.opcode) || ['biConnect', 'biDisconnectInstance', 'biFindChannelId'].includes(block.opcode)) {
        block.hideFromPalette = true; reasons[block.opcode] = 'Redundant 1.8 connection or ID variant; original opcode retained as the primary block.';
      }
      if (spec && uiRoute(spec.path) || ['bfPlaySound', 'bfCloudlinkStatus', 'bfCloudlinkConnected'].includes(block.opcode)) {
        block.hideFromPalette = true; reasons[block.opcode] = 'Bonfire client UI / media picker / notification / staff / administration feature.';
        const reporter = block.blockType === Scratch.BlockType.REPORTER;
        this[block.opcode] = () => reporter ? '{}' : block.blockType === Scratch.BlockType.BOOLEAN ? false : undefined;
      }
      if (migratedOps.has(block.opcode)) {
        block.text = block.text.replace(/\bVelora\b/g, 'Bonfire').replace(/\bserver \[SERVER\]/gi, 'server ID [SERVER]').replace(/\bchannel \[CHANNEL\]/gi, 'channel ID [CHANNEL]').replace(/\broom \[ROOM\]/gi, 'channel ID [ROOM]');
        for (const key of ['SERVER', 'SID', 'CHANNEL', 'CID', 'ROOM']) if (block.arguments?.[key]) {
          block.arguments[key].defaultValue = ['SERVER', 'SID'].includes(key) ? 's1' : 'c1';
          if (!block.text.includes((['SERVER', 'SID'].includes(key) ? 'server ID ' : 'channel ID ') + '[' + key + ']')) block.text = block.text.replace('[' + key + ']', (['SERVER', 'SID'].includes(key) ? 'server ID ' : 'channel ID ') + '[' + key + ']');
        }
        block.tooltip = 'Uses explicitly connected Bonfire instances. Use server IDs and channel IDs; unique legacy names and invite links are accepted. No automatic connections. Classic global blocks use the selected channel (join room), or a unique general channel.';
        if (['whenChatMessage', 'whenAnyChatMessage', 'whenGlobalMessageReceived', 'whenRoomMessageReceived', 'bfWhenGameStatus', 'bfWhenGameConsole'].includes(block.opcode)) block.isEdgeActivated = false;
      }
      if (block.hideFromPalette && !reasons[block.opcode]) reasons[block.opcode] = 'Previously hidden legacy feature; registration preserved.';
    }
    this._paletteReasons19 = reasons;
    this._migratedOpcodes19 = [...migratedOps];
    // Group restored blocks by their actual API area, removing labels left empty by UI hiding.
    const raw = new Set(nativeSpecs.map(spec => spec.opcode));
    const classic = info.blocks.filter(block => bfOldChat.has(block?.opcode));
    const rawBlocks = info.blocks.filter(block => raw.has(block?.opcode));
    info.blocks = info.blocks.filter(block => !raw.has(block?.opcode) && !bfOldChat.has(block?.opcode));
    const classicAt = info.blocks.findIndex(block => block?.opcode === 'chatMyServers');
    info.blocks.splice(classicAt < 0 ? 0 : classicAt, 0, { blockType: Scratch.BlockType.LABEL, text: 'Bonfire classic channel context' }, ...classic, { blockType: Scratch.BlockType.LABEL, text: 'Bonfire communities and channels' });
    const json = []; let area = '';
    for (const block of rawBlocks) {
      const spec = nativeSpecs.find(s => s.opcode === block.opcode);
      const next = spec.path.split('/')[2];
      if (!block.hideFromPalette && next !== area) { area = next; json.push({ blockType: Scratch.BlockType.LABEL, text: 'Bonfire JSON: ' + area }); }
      json.push(block);
    }
    const rawAt = info.blocks.findIndex(block => block?.opcode === 'biApi');
    info.blocks.splice(rawAt < 0 ? info.blocks.length : rawAt, 0, ...json, { blockType: Scratch.BlockType.LABEL, text: 'Bonfire advanced' });
    info.blocks = info.blocks.filter((block, index, all) => {
      if (block?.blockType !== Scratch.BlockType.LABEL) return true;
      for (let n = index + 1; n < all.length && all[n]?.blockType !== Scratch.BlockType.LABEL; n++) if (all[n]?.opcode && !all[n].hideFromPalette) return true;
      return false;
    });
    return info;
  };

  // A synchronous throw (e.g. 'Not logged in') can kill the block's thread without ever reporting
  // the error, leaving the block stuck "running". Rejected promises are always reported, so turn
  // any synchronous throw from a non-hat block into a rejection. Normal return values are untouched.
  const veloraExt = new VeloraExtension(Scratch.vm.runtime);
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
})();
