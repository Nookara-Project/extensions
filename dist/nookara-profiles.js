// Name: Nookara Profiles
// ID: ikelenenookaraprofiles
// Description: User lookup, arcade badges, achievements, account badges and login history for Nookara. Needs Nookara Login.
// By: Ikelene
// License: MIT

// made by extensions/split/build.js from velora_extension.js, edit that one and rebuild
(function (Scratch) {
  'use strict';

  if (!Scratch.extensions.unsandboxed) throw new Error('Nookara Profiles must run unsandboxed: it shares its sign-in with the other Nookara extensions.');

  const API_VERSION = 1;
  const CORE_URL = 'https://ikelene.net/gallery/extensions/nookara-login.js';
  const EXT_ID = 'ikelenenookaraprofiles';

  class NookaraExtension {
    constructor(runtime) {
      this.runtime = runtime;
      this._badges = [];
      this._achievements = {};
      this._lastAchievement = null;
      this._evtAchievement = false;
      this._loginHistory = [];
      this._evtNewLogin = false;
      this._knownLoginCount = -1;
      this._notifInterval = null;
      this._lookedUpUser = {};
      this._lookedUpHF = {};
      runtime.ext_ikelenenookaraprofiles = this;
      this._linked = null;
      runtime.on('EXTENSION_ADDED', () => this._linkCore());
      this._linkCore();
    }

    getInfo() {
      const blocks = [
          { blockType: Scratch.BlockType.LABEL, text: 'Sign in history' },
          { opcode: 'whenNewLoginDetected', blockType: Scratch.BlockType.HAT, text: 'when there is a new sign in' },
          { opcode: 'fetchLoginHistory', blockType: Scratch.BlockType.COMMAND, text: 'load sign in history' },
          { opcode: 'loginHistoryCount', blockType: Scratch.BlockType.REPORTER, text: 'sign in count' },
          { opcode: 'loginHistoryJSON', blockType: Scratch.BlockType.REPORTER, text: 'sign in history as JSON' },
          { opcode: 'lastLoginDevice', blockType: Scratch.BlockType.REPORTER, text: 'last sign in device' },
          { opcode: 'lastLoginIP', blockType: Scratch.BlockType.REPORTER, text: 'last sign in IP' },
          { blockType: Scratch.BlockType.LABEL, text: 'Look up a user' },
          { opcode: 'lookupUser', blockType: Scratch.BlockType.COMMAND, text: 'look up [USER]', arguments: { USER: { type: Scratch.ArgumentType.STRING, defaultValue: 'username' } } },
          { opcode: 'lookedUpUsername', blockType: Scratch.BlockType.REPORTER, text: 'their username' },
          { opcode: 'lookedUpDisplayName', blockType: Scratch.BlockType.REPORTER, text: 'their display name' },
          { opcode: 'lookedUpRank', blockType: Scratch.BlockType.REPORTER, text: 'their rank' },
          { opcode: 'lookedUpBio', blockType: Scratch.BlockType.REPORTER, text: 'their bio' },
          { opcode: 'lookedUpPronouns', blockType: Scratch.BlockType.REPORTER, text: 'their pronouns' },
          { opcode: 'lookedUpPfp', blockType: Scratch.BlockType.REPORTER, text: 'their pfp' },
          { opcode: 'lookedUpCountry', blockType: Scratch.BlockType.REPORTER, text: 'their country' },
          { opcode: 'lookedUpJSON', blockType: Scratch.BlockType.REPORTER, text: 'their profile as JSON' },
          { opcode: 'lookedUpGame', blockType: Scratch.BlockType.REPORTER, text: 'game they are playing' },
          { opcode: 'lookedUpGameIcon', blockType: Scratch.BlockType.REPORTER, text: 'icon of game they are playing' },
          { opcode: 'lookedUpIsPlaying', blockType: Scratch.BlockType.BOOLEAN, text: 'are they playing a game?' },
          { opcode: 'lookedUpPlaytime', blockType: Scratch.BlockType.REPORTER, text: 'their hours in [GAME]', arguments: { GAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'Five Nights at JARVIS' } } },
          { opcode: 'lookedUpGames', blockType: Scratch.BlockType.REPORTER, text: 'their games as JSON' },
          { blockType: Scratch.BlockType.LABEL, text: 'Arcade badges' },
          { opcode: 'lookedUpUnlockedBadges', blockType: Scratch.BlockType.REPORTER, text: 'their arcade badges as JSON' },
          { opcode: 'lookedUpUnlockedCount', blockType: Scratch.BlockType.REPORTER, text: 'their arcade badge count' },
          { opcode: 'lookedUpHasUnlocked', blockType: Scratch.BlockType.BOOLEAN, text: 'do they have badge [NAME]?', arguments: { NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'Lucky Star' } } },
          { opcode: 'lookedUpUnlockedImage', blockType: Scratch.BlockType.REPORTER, text: 'image of badge [NAME]', arguments: { NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'Lucky Star' } } },
          { opcode: 'lookedUpProfileBadges', blockType: Scratch.BlockType.REPORTER, text: 'badges on their profile as JSON' },
          { opcode: 'lookedUpProfileBadgeCount', blockType: Scratch.BlockType.REPORTER, text: 'badges on their profile count' },
          { opcode: 'lookedUpProfileBadge', blockType: Scratch.BlockType.REPORTER, text: '[PROP] of badge [N] on their profile', arguments: { PROP: { type: Scratch.ArgumentType.STRING, menu: 'arcadeBadgeProps', defaultValue: 'image URL' }, N: { type: Scratch.ArgumentType.NUMBER, defaultValue: 1 } } },
          { blockType: Scratch.BlockType.LABEL, text: 'Hyperfocus' },
          { opcode: 'hyperfocusDownload', blockType: Scratch.BlockType.REPORTER, text: 'Hyperfocus download link' },
          { opcode: 'hyperfocusPlayLink', blockType: Scratch.BlockType.REPORTER, text: 'Hyperfocus link to play [GAME]', arguments: { GAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'fnaj' } } },
          { blockType: Scratch.BlockType.LABEL, text: 'Achievements' },
          { opcode: 'grantAchievement', blockType: Scratch.BlockType.COMMAND, text: 'grant achievement [ID]', arguments: { ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'achievement-id' } } },
          { opcode: 'revokeAchievement', blockType: Scratch.BlockType.COMMAND, text: 'revoke achievement [ID]', arguments: { ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'achievement-id' } } },
          { opcode: 'getAchievements', blockType: Scratch.BlockType.REPORTER, text: 'my achievements as JSON' },
          { opcode: 'hasAchievement', blockType: Scratch.BlockType.BOOLEAN, text: 'have achievement [ID]?', arguments: { ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'achievement-id' } } },
          { opcode: 'whenAchievementUnlocked', blockType: Scratch.BlockType.HAT, text: 'when I unlock an achievement' },
          { opcode: 'lastAchievement', blockType: Scratch.BlockType.REPORTER, text: 'last achievement as JSON' },
          { blockType: Scratch.BlockType.LABEL, text: 'Badges' },
          { opcode: 'badgesLoaded', blockType: Scratch.BlockType.BOOLEAN, text: 'badges loaded?' },
          { opcode: 'allBadges', blockType: Scratch.BlockType.REPORTER, text: 'my badges' },
          { opcode: 'badgeCount', blockType: Scratch.BlockType.REPORTER, text: 'badge count' },
          { opcode: 'hasBadge', blockType: Scratch.BlockType.BOOLEAN, text: 'have badge [BADGE]?', arguments: { BADGE: { type: Scratch.ArgumentType.STRING, defaultValue: 'Community Developer' } } },
          { opcode: 'badgeInfo', blockType: Scratch.BlockType.REPORTER, text: 'badge [BADGE] info', arguments: { BADGE: { type: Scratch.ArgumentType.STRING, defaultValue: 'Community Developer' } } },
      ];
      if (!this._coreApi()) blocks.unshift({ func: '_addCore', blockType: Scratch.BlockType.BUTTON, text: 'Add Nookara Login' });
      return {
        id: EXT_ID,
        name: 'Nookara Profiles',
        color1: '#7c3aed',
        color2: '#5b21b6',
        color3: '#4c1d95',
        docsURI: 'https://nookara.cc/guides/nookara-extensions',
        blocks,
        menus: {
          arcadeBadgeProps: { acceptReporters: true, items: ['name', { text: 'image', value: 'image URL' }, 'x', 'y', 'size', { text: 'id', value: 'badge id' }, 'rarity'] },
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


    _onLogin() {
        this._fetchBadges();
        this._pollLoginHistory();
        if (!this._notifInterval) this._notifInterval = setInterval(() => { if (this._token) this._pollLoginHistory(); }, 30000);
    }
    _onLogout() {
        if (this._notifInterval) { clearInterval(this._notifInterval); this._notifInterval = null; }
    }

    _handleWS(msg) {
      switch (msg.type) {
        // Instant Messages
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
        // ── Nookara Voice ──
      }
    }
    async _fetchBadges() {
      if (!this._token) return;
      const data = await this._http('/account/me').catch(() => ({}));
      if (data.account?.badges) this._badges = data.account.badges;
    }
    whenNewLoginDetected()    { const v = this._evtNewLogin;       this._evtNewLogin = false;       return v; }
    badgesLoaded()  { return this._badges.length > 0; }
    hasBadge({ BADGE }) {
      return this._badges.some(b => b.name === BADGE);
    }
    allBadges()         { if (!this._authenticated) throw new Error('Not logged in'); return JSON.stringify(this._badges); }
    badgeCount()        { if (!this._authenticated) throw new Error('Not logged in'); return this._badges.length; }
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
    lookedUpDisplayName() { return this._lookedUpUser.display_name || this._lookedUpUser.username || ''; }
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
  const p19 = NookaraExtension.prototype;
  // Nookara continues to carry identity/presence/IM/DM-call events, never community chat.
  const identityEvents19 = p19._handleWS;
  p19._handleWS = function (frame) {
    if (['globalMessage', 'roomMessage', 'globalMessages', 'roomMessages'].includes(frame.type)) return;
    if (frame.type?.startsWith('chat_') && !/^chat_(rtc_|call_|error$)/.test(frame.type)) return;
    return identityEvents19.call(this, frame);
  };

  const veloraExt = new NookaraExtension(Scratch.vm.runtime);

  // the menus show plain words but keep their old values, a dropped reporter can say either
  const MENU_WORDS = { arcadeBadgeProps: { image: 'image URL', id: 'badge id' } };
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
