'use strict';

const CORE_ID = 'ikelenenookaralogin';
const HOSTED = 'https://ikelene.net/gallery/extensions';

const SECTIONS = {
  'Connection': 'login', 'Authentication': 'login', 'Your Nookara Account': 'login', 'Profile': 'login', 'Verbose': 'login', 'Extension': 'login',
  'Currency': 'payments', 'Products and checkout': 'payments',
  'Data Storage': 'data', 'Storage Information': 'data', 'Media Upload': 'data', 'File Picker': 'data',
  'Status & Rich Presence': 'social', 'Users': 'social', 'DMs (Works offline)': 'social', 'Your Nookara Circle': 'social', 'Nookara App Alerts': 'social',
  'Nookara API: users': 'social', 'Nookara API: presence': 'social', 'Nookara API: dm': 'social', 'Nookara API: groups': 'social', 'Nookara API: direct messages': 'social',
  'User Lookup': 'profiles', 'Badge Arcade': 'profiles', 'Hyperfocus': 'profiles', 'Achievements': 'profiles', 'Badges': 'profiles', 'Login History': 'profiles',
  'Nookara Voice': 'voice', 'Nookara API: calls': 'voice',
};
const CHAT_SECTION = /^(Bonfire|Connect explicitly|Nookara Events|Game Servers|CloudLink|Nookara API: bots)/;

const OPCODES = {
  clientUsername: 'login', myClientObject: 'login',
  bfEditDM: 'social',
  bfJoinVoiceChannel: 'voice', bfJoinCall: 'voice',
  callUser: 'voice', whenCallReceived: 'voice', callData: 'voice', acceptCall: 'voice', setMic: 'voice', stopCall: 'voice',
};

const moduleFor = (opcode, section) => {
  if (OPCODES[opcode]) return OPCODES[opcode];
  if (opcode && /^rp[A-Z]/.test(opcode)) return 'social';
  if (SECTIONS[section]) return SECTIONS[section];
  if (CHAT_SECTION.test(section)) return 'chat';
  return null;
};

const WS_CASES = {
  auth_success: ['login'], auth_error: ['login'], kicked: ['login'], account_updated: ['login'], user_update: ['login'], restrictions: ['login'], pong: ['login'],
  user_joined: ['social'], user_left: ['social'], status_changed: ['social'], onlinePlayers: ['social'],
  im_received: ['social'], im_unread: ['social'], im_ack: ['social'], im_error: ['social'], mail_received: ['social'],
  friend_request: ['social'], friend_request_accepted: ['social'], friend_online: ['social'], friend_offline: ['social'],
  presence_update: ['social', 'chat'],
  balance_changed: ['payments'],
  achievement_unlocked: ['profiles'], achievement_revoked: ['profiles'],
  error: ['voice'], chat_error: ['voice'], voice_open: ['voice'], voice_closed: ['voice'], voice: ['voice'], voice_sound: ['voice'],
  voice_call_incoming: ['voice'], voice_call_accepted: ['voice'], voice_call_ringing: ['voice'], voice_call_answered: ['voice'], voice_call_ended: ['voice'], voice_call_failed: ['voice'],
  chat_rtc_joined: ['voice'], chat_rtc_published: ['voice'], chat_rtc_offer: ['voice'], chat_rtc_ready: ['voice'], chat_rtc_room: ['voice'], call_incoming: ['voice'],
  chat_message: ['chat'], chat_message_update: ['chat'], chat_message_delete: ['chat'], chat_reactions: ['chat'], chat_typing: ['chat'],
  chat_channels_update: ['chat'], chat_server_update: ['chat'], chat_server_removed: ['chat'],
  globalMessage: ['chat'], imageMessage: ['chat'], roomMessage: ['chat'], roomHistory: ['chat'], globalHistory: ['chat'], typing: ['chat'], stopTyping: ['chat'],
};

const CHAT_STATE = ['_bfEvents', '_bfInit', '_bfLastEvent', '_bfMineAt', '_chatDetail', '_chatServers', '_chatHatIds', '_lastChatMsg', '_instanceSigningKey', '_instanceSigningToken', '_instances', '_instanceTransition', '_stopInstance', '_restoreInstances', '_instanceURLs', '_instanceEvent', '_disposeInstances'];

const MODULES = {
  login: {
    id: CORE_ID, file: 'nookara-login.js', name: 'Nookara Login', core: true,
    description: 'Sign in with a Nookara account. The other Nookara extensions use this sign-in.',
    roots: ['_http', '_cmd', '_bfRequest', '_requireScope', '_scopeErrorFromData', '_missingScopeText', '_wsSend', '_connectWS', '_bfEnsureSocket'],
    dropLayers: { _handleWS: [1], _wsSend: [1], _bfEnsureSocket: [1] },
    cut: ['_vReset', '_vCall', '_vIncoming', '_imPending', '_getOnlinePlayers', '_onlineTimer', '_rich', '_fetchFriends', '_fetchMail', '_fetchBadges', '_pollLoginHistory', '_fetchNotifications', '_notifInterval', '_rtcLeave', '_badges', ...CHAT_STATE],
    patches: [
      ['if (e.data instanceof ArrayBuffer) { this._vIncoming(e.data); return; }', "if (e.data instanceof ArrayBuffer) { this._emit('binary', e.data); return; }"],
      ['        this._handleWS(msg);\n      };', "        this._handleWS(msg);\n        this._emit('message', msg);\n      };"],
      ['        if (this._token) this._wsAuth();\n        this._getOnlinePlayers();', "        if (this._token) this._wsAuth();\n        this._emit('connect');\n        this._getOnlinePlayers();"],
      ["        this._vReset('disconnected');", "        this._emit('disconnect');\n        this._vReset('disconnected');"],
      ['          this._evtAuthenticated = true;\n          this._fetchAccount();', "          this._evtAuthenticated = true;\n          this._emit('login');\n          this._fetchAccount();"],
      ["        this._lastAuthResult = 'successful';", "        this._lastAuthResult = 'successful';\n        this._emit('login');"],
      ['      this._wsReady = false;\n      this._connected = false;\n    }\n\n    setStorageId', "      this._wsReady = false;\n      this._connected = false;\n      this._emit('logout');\n    }\n\n    setStorageId"],
      ['          this._authenticated = false;\n          this._token = null;\n          break;', "          this._authenticated = false;\n          this._token = null;\n          this._emit('logout');\n          break;"],
    ],
  },
  payments: {
    id: 'ikelenenookarapayments', file: 'nookara-payments.js', name: 'Nookara Payments',
    description: 'Credits, subscriptions, products, cart and checkout for Nookara. Needs Nookara Login.',
    dropLayers: { _handleWS: [1] },
  },
  data: {
    id: 'ikelenenookaradata', file: 'nookara-data.js', name: 'Nookara Data',
    description: 'Cloud storage, uploads and the file picker for Nookara. Needs Nookara Login.',
    dropLayers: { _handleWS: [1] },
  },
  social: {
    id: 'ikelenenookarasocial', file: 'nookara-social.js', name: 'Nookara Social',
    description: 'Presence, direct messages, groups, friends, blocking and alerts for Nookara. Needs Nookara Login.',
    roots: ['_fetchFriends', '_fetchMail', '_fetchNotifications', '_getOnlinePlayers'],
    hooks: {
      connect: `this._getOnlinePlayers();
        if (!this._onlineTimer) this._onlineTimer = setInterval(() => { if (this._ws?.readyState === 1) this._getOnlinePlayers(); }, 30000);`,
      login: `if (this._rich) this._wsSend({ type: 'set_rich_presence', activity: this._rich });
        this._fetchFriends();
        this._fetchMail();
        this._fetchNotifications();
        if (!this._notifInterval) this._notifInterval = setInterval(() => { if (this._token) this._fetchNotifications(); }, 30000);`,
      logout: `if (this._notifInterval) { clearInterval(this._notifInterval); this._notifInterval = null; }
        this._rich = null;`,
      disconnect: `this._imPending.forEach(p => p.reject(new Error('disconnected')));
        this._imPending.clear();`,
    },
    dropLayers: { _handleWS: [1] },
  },
  profiles: {
    id: 'ikelenenookaraprofiles', file: 'nookara-profiles.js', name: 'Nookara Profiles',
    description: 'User lookup, arcade badges, achievements, account badges and login history for Nookara. Needs Nookara Login.',
    roots: ['_fetchBadges', '_pollLoginHistory'],
    hooks: {
      login: `this._fetchBadges();
        this._pollLoginHistory();
        if (!this._notifInterval) this._notifInterval = setInterval(() => { if (this._token) this._pollLoginHistory(); }, 30000);`,
      logout: `if (this._notifInterval) { clearInterval(this._notifInterval); this._notifInterval = null; }`,
    },
    dropLayers: { _handleWS: [1] },
  },
  voice: {
    id: 'ikelenenookaravoice', file: 'nookara-voice.js', name: 'Nookara Voice',
    description: 'Voice rooms and calls for Nookara. Needs Nookara Login; voice channels on Ember servers also need Nookara Chat.',
    roots: ['_vReset', '_vIncoming', '_rtcLeave', '_rtcMessage'],
    binary: true,
    needsPeer: { chat: ['_channel19'] },
    keepWrappers: ['_wsSend', '_bfEnsureSocket'],
    hooks: {
      logout: 'this._rtcLeave();',
      disconnect: `this._vReset('disconnected');
        this._vCall = null;`,
    },
    cut: ['_bfEvents', '_bfInit', '_bfLastEvent', '_chatDetail', '_chatServers', '_chatHatIds', '_lastChatMsg', '_gameEvt', '_gameLastLine', '_chatMsgs', '_chatEvt', '_chatTyping', '_presence', '_presenceEvt', '_lastPresenceUser', '_stopInstance'],
  },
  chat: {
    id: 'ikelenenookarachat', file: 'nookara-chat.js', name: 'Nookara Chat',
    description: 'Ember servers, channels, messages, bots and game servers for Nookara. Needs Nookara Login.',
    roots: ['_bfInit', '_restoreInstances', '_disposeInstances', 'serialize', 'deserialize'],
    init: 'this._bfInit();',
    keepCtorEvents: true,
    chatLoops: true,
    optionalPeer: { voice: { methods: ['_rtcMessage', '_rtcLeave'], accessors: ['_voiceInstance19', '_rtc'] } },
    hooks: {
      login: `this._bfEvents = null; this._bfInit(); this._lastChatMsg = null; this._bfLastEvent = null;
        this._restoreInstances();`,
      logout: `this._bfEvents = null; this._bfInit(); this._lastChatMsg = null; this._bfLastEvent = null;
        this._instanceSigningKey = null;
        this._instanceSigningToken = null;
        this._bfMineAt = 0;
        for (const state of this._instances.values()) if (state.velora) { state.cancelled = true; this._stopInstance(state); state.session = null; this._instanceTransition(state, 'disconnected'); this._instances.delete(state.origin); }`,
    },
  },
};

const SHARED = {
  _token: ['getToken', 'null'], _user: ['getUser', 'null'], _username: ['getUsername', "''"], _authenticated: ['isAuthenticated', 'false'], _connected: ['isConnected', 'false'],
  _wsReady: ['isSocketReady', 'false'], _wsAuthed: ['isSocketAuthed', 'false'], _grantedScopes: ['getScopes', '0'], _disabledScopes: ['getDisabledScopes', '0'],
  _accountObj: ['getAccount', '{}'], _ws: ['getSocket', 'null'],
};
const FORWARD = { _http: 'http', _cmd: 'cmd', _bfRequest: 'request', _requireScope: 'requireScope', _scopeErrorFromData: 'scopeError', _missingScopeText: 'missingScopeText', _wsSend: 'send', _connectWS: 'connect', _bfEnsureSocket: 'ensureSocket', _waitForWS: 'ensureSocket' };

module.exports = { CORE_ID, HOSTED, MODULES, SHARED, FORWARD, WS_CASES, moduleFor };
