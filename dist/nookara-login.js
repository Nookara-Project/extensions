// Name: Nookara Login
// ID: ikelenenookaralogin
// Description: Sign in with a Nookara account. The other Nookara extensions use this sign-in.
// By: Ikelene
// License: MIT

// made by extensions/split/build.js from velora_extension.js, edit that one and rebuild
(function (Scratch) {
  'use strict';

  if (!Scratch.extensions.unsandboxed) throw new Error('Nookara Login must run unsandboxed: it shares its sign-in with the other Nookara extensions.');

  const API_VERSION = 1;
  const SERVER_HTTP = 'https://nookara.cc';
  const SERVER_WS   = 'wss://nookara.cc';
  const EXT_ID = 'ikelenenookaralogin';

  class NookaraExtension {
    constructor(runtime) {
      this.runtime = runtime;
      this._token = null;
      this._grantedScopes = 0;
      this._user = null;
      this._ws = null;
      this._wsReady = false;
      this._accountObj = {};
      this._wsAuthed = false;
      this._username = '';
      this._disabledScopes = 0;
      this._authenticated = false;
      this._connected = false;
      this._intentionalDisconnect = false;
      this._loginInProgress = false;
      this._cancelPendingLogin = null;
      this._evtConnected = false;
      this._evtDisconnected = false;
      this._evtAuthenticated = false;
      this._lastAuthResult = null;
      this._evtAccountUpdated = false;
      this._evtUserUpdated = false;
      this._lastUserUpdate = null;
      this._status = 'online';
      this._uploadStatus = 'idle';
      this._lastUploadUrl = '';
      this._uploadProgress = 0;
      this._lastActionOutput = '';
      this._lastActionSuccess = false;
      this._listeners = new Map();
      this.api = this._makeApi();
      runtime.ext_ikelenenookaralogin = this;
    }

    getInfo() {
      const blocks = [
          { blockType: Scratch.BlockType.LABEL, text: 'Connection' },
          { opcode: 'whenConnected', blockType: Scratch.BlockType.HAT, text: 'when connected' },
          { opcode: 'whenDisconnected', blockType: Scratch.BlockType.HAT, text: 'when disconnected' },
          { opcode: 'serverOnline', blockType: Scratch.BlockType.BOOLEAN, text: 'is Nookara online?' },
          { opcode: 'isConnected', blockType: Scratch.BlockType.BOOLEAN, text: 'connected?' },
          { blockType: Scratch.BlockType.LABEL, text: 'Sign in' },
          { func: 'openAppsPage', blockType: Scratch.BlockType.BUTTON, text: 'Create an App' },
          { func: 'openGuides', blockType: Scratch.BlockType.BUTTON, text: 'View Guides' },
          { opcode: 'openAppLogin', blockType: Scratch.BlockType.COMMAND, text: 'sign in with app [APP_ID]', arguments: { APP_ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'app id' } } },
          { opcode: 'openLoginPrompt', hideFromPalette: true, blockType: Scratch.BlockType.COMMAND, text: 'sign in to Nookara for [PROJECT_NAME] with permissions [PERMISSIONS]', arguments: { PROJECT_NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'My Project' }, PERMISSIONS: { type: Scratch.ArgumentType.STRING, defaultValue: '5' } } },
          { opcode: 'loginWithToken', blockType: Scratch.BlockType.COMMAND, text: 'sign in with token [TOKEN]', arguments: { TOKEN: { type: Scratch.ArgumentType.STRING, defaultValue: '' } } },
          { opcode: 'logout', blockType: Scratch.BlockType.COMMAND, text: 'sign out' },
          { opcode: 'currentToken', blockType: Scratch.BlockType.REPORTER, text: 'token' },
          { opcode: 'isLoginOpen', blockType: Scratch.BlockType.BOOLEAN, text: 'sign in window open?' },
          { opcode: 'serviceDisabled', blockType: Scratch.BlockType.BOOLEAN, text: 'is [SERVICE] turned off?', arguments: { SERVICE: { type: Scratch.ArgumentType.STRING, menu: 'serviceMenu', defaultValue: 'voice' } } },
          { opcode: 'authResult', blockType: Scratch.BlockType.BOOLEAN, text: 'sign in [RESULT]?', arguments: { RESULT: { type: Scratch.ArgumentType.STRING, menu: 'authResultMenu', defaultValue: 'successful' } } },
          { opcode: 'whenAuthenticated', blockType: Scratch.BlockType.HAT, text: 'when signed in' },
          { blockType: Scratch.BlockType.LABEL, text: 'My account' },
          { opcode: 'getAccountKey', blockType: Scratch.BlockType.REPORTER, text: 'get [KEY]', arguments: { KEY: { type: Scratch.ArgumentType.STRING, menu: 'accountKeys', defaultValue: 'username' } } },
          { opcode: 'keyExists', blockType: Scratch.BlockType.BOOLEAN, text: 'has [KEY]?', arguments: { KEY: { type: Scratch.ArgumentType.STRING, menu: 'accountKeys', defaultValue: 'username' } } },
          { opcode: 'getAllKeys', blockType: Scratch.BlockType.REPORTER, text: 'all account fields' },
          { opcode: 'getAllValues', blockType: Scratch.BlockType.REPORTER, text: 'all account values' },
          { opcode: 'getAccountObject', blockType: Scratch.BlockType.REPORTER, text: 'account as JSON' },
          { opcode: 'isUserBanned', blockType: Scratch.BlockType.BOOLEAN, text: 'am I banned?' },
          { opcode: 'whenAccountUpdated', blockType: Scratch.BlockType.HAT, text: 'when my account changes' },
          { opcode: 'whenUserUpdated', blockType: Scratch.BlockType.HAT, text: 'when someone changes their profile' },
          { opcode: 'lastUserUpdate', blockType: Scratch.BlockType.REPORTER, text: 'last profile change as JSON' },
          { blockType: Scratch.BlockType.LABEL, text: 'Profile' },
          { opcode: 'uploadPfp', blockType: Scratch.BlockType.COMMAND, text: 'set my pfp to image [DATA_URI] and [MODE]', arguments: { DATA_URI: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, MODE: { type: Scratch.ArgumentType.STRING, menu: 'uploadModeMenu', defaultValue: 'wait' } } },
          { opcode: 'setChatColor', blockType: Scratch.BlockType.COMMAND, text: 'set my chat color to [COLOR]', arguments: { COLOR: { type: Scratch.ArgumentType.STRING, defaultValue: '#c084fc' } } },
          { opcode: 'setPronouns', blockType: Scratch.BlockType.COMMAND, text: 'set my pronouns to [PRONOUNS]', arguments: { PRONOUNS: { type: Scratch.ArgumentType.STRING, defaultValue: 'she/her' } } },
          { blockType: Scratch.BlockType.LABEL, text: 'Me' },
          { opcode: 'clientUsername', blockType: Scratch.BlockType.REPORTER, text: 'my username' },
          { opcode: 'myClientObject', blockType: Scratch.BlockType.REPORTER, text: 'my info as JSON' },
          { blockType: Scratch.BlockType.LABEL, text: 'Last result' },
          { opcode: 'lastActionOutput', blockType: Scratch.BlockType.REPORTER, text: 'last result as JSON' },
          { opcode: 'lastActionSuccess', blockType: Scratch.BlockType.BOOLEAN, text: 'last action worked?' },
          { blockType: Scratch.BlockType.LABEL, text: 'About' },
          { opcode: 'extensionVersion', blockType: Scratch.BlockType.REPORTER, text: 'version' },
      ];
      return {
        id: EXT_ID,
        name: 'Nookara Login',
        color1: '#7c3aed',
        color2: '#5b21b6',
        color3: '#4c1d95',
        docsURI: 'https://nookara.cc/guides/nookara-extensions',
        blocks,
        menus: {
          serviceMenu: { acceptReporters: true, items: ['instant messages', 'group chat', 'voice', 'storage', 'media uploads', 'friends', 'credits', 'profile editing'] },
          authResultMenu: { acceptReporters: false, items: ['successful', 'failed'] },
          accountKeys: { acceptReporters: true, items: [{ text: 'id', value: 'account_id' }, 'username', { text: 'rank', value: 'membership' }, 'staff_role', { text: 'status', value: 'account_status' }, { text: 'mod level', value: 'moderation_level' }, 'credits', 'badges', { text: 'join date', value: 'joined_at' }, { text: 'last sign in', value: 'last_signed_in_at' }, { text: 'sign in count', value: 'sign_in_count' }, 'sessions', { text: 'accepted terms', value: 'terms_accepted' }, { text: 'accepted terms date', value: 'terms_accepted_at' }, { text: 'email verified', value: 'email_verified' }, 'email', { text: 'pfp', value: 'avatar_url' }, { text: 'banner', value: 'banner_url' }, { text: 'bio', value: 'biography' }, 'pronouns', 'timezone', 'country'] },
          uploadModeMenu: { acceptReporters: false, items: ['wait', 'continue'] },
        },
      };
    }

    // ── what the add-ons use. they reach it with runtime.ext_ikelenenookaralogin.api, nothing goes on window ──
    _emit(event, ...args) {
      for (const fn of [...(this._listeners.get(event) || [])]) {
        try { fn(...args); } catch (error) { console.error('Nookara add-on failed on', event, error); }
      }
    }

    _makeApi() {
      return {
        version: API_VERSION,
        getToken: () => this._token,
        getUser: () => this._user,
        getUsername: () => this._username,
        getScopes: () => this._grantedScopes,
        getDisabledScopes: () => this._disabledScopes,
        getAccount: () => this._accountObj,
        getSocket: () => this._ws,
        isAuthenticated: () => this._authenticated,
        isConnected: () => this._connected,
        isSocketReady: () => this._wsReady,
        isSocketAuthed: () => this._wsAuthed,
        http: (...args) => this._http(...args),
        cmd: (...args) => this._cmd(...args),
        request: (...args) => this._bfRequest(...args),
        requireScope: bit => this._requireScope(bit),
        scopeError: data => this._scopeErrorFromData(data),
        missingScopeText: (bit, name) => this._missingScopeText(bit, name),
        send: frame => this._wsSend(frame),
        connect: () => this._connectWS(),
        ensureSocket: () => this._bfEnsureSocket(),
        getLastAction: () => ({ output: this._lastActionOutput, success: this._lastActionSuccess }),
        setLastAction: (output, success) => { this._lastActionOutput = output; this._lastActionSuccess = success; },
        on: (event, fn) => {
          if (!this._listeners.has(event)) this._listeners.set(event, new Set());
          this._listeners.get(event).add(fn);
          return () => this._listeners.get(event).delete(fn);
        },
      };
    }

    _connectWS() {
      if (this._ws && this._ws.readyState < 2) return;
      this._wsReady = false;
      this._ws = new WebSocket(SERVER_WS);
      this._ws.binaryType = 'arraybuffer';

      this._ws.onopen = () => {
        this._wsReady = true;
        this._connected = true;
        this._evtConnected = true;
        this._evtDisconnected = false;
        if (this._token) this._wsAuth();
        this._emit('connect');
      };

      this._ws.onmessage = (e) => {
        if (e.data instanceof ArrayBuffer) { this._emit('binary', e.data); return; }
        let msg; try { msg = JSON.parse(e.data); } catch { return; }
        this._handleWS(msg);
        this._emit('message', msg);
      };

      this._ws.onclose = () => {
        this._wsReady = false;
        this._wsAuthed = false;
        this._connected = false;
        this._authenticated = false;
        this._evtDisconnected = true;
        this._intentionalDisconnect = false;
        this._emit('disconnect');
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
      this._wsSend({ type: 'auth_token', token: this._token });
    }
    _handleWS(msg) {
      switch (msg.type) {
        case 'auth_success':
          this._wsAuthed = true;

          this._disabledScopes = Number(msg.disabled_scopes) || 0;
          this._user = msg.user;
          this._username = msg.user?.username || '';
          this._authenticated = true;
          this._evtAuthenticated = true;
          this._emit('login');
          this._fetchAccount();
          break;
        case 'auth_error':
          this._authenticated = false;
          this._token = null;
          this._emit('logout');
          break;
        case 'kicked':
          this._authenticated = false;
          this._wsReady = false;
          this._connected = false;
          this._evtDisconnected = true;
          break;
        case 'user_update':
          this._lastUserUpdate = { ...(msg.user || {}), changed: msg.changed || [], previous_username: msg.previous_username || null };
          this._evtUserUpdated = true;
          break;
        case 'account_updated':
          this._evtAccountUpdated = true;
          this._fetchAccount();
          break;
        case 'restrictions':
          this._disabledScopes = Number(msg.disabled_scopes) || 0;
          if (msg.scopes !== undefined) this._grantedScopes = Number(msg.scopes);
          break;
        case 'pong':
          break;
      }
    }
    async _http(path, method = 'GET', body = null) {
      const headers = { 'Content-Type': 'application/json' };
      if (this._token) headers['Authorization'] = `Bearer ${this._token}`;
      const opts = { method, headers };
      if (body) opts.body = JSON.stringify(body);
      const res = await fetch(SERVER_HTTP + path, opts);
      return res.json().catch(() => ({}));
    }
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
        this._emit('login');
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
        if (data.account.username) this._username = data.account.username;
      }
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
      if (this._loginInProgress) return Promise.resolve();

      let projName = Scratch.Cast.toString(args?.PROJECT_NAME || args?.project_name || 'My Project').trim();
      let rawPerm = args?.PERMISSIONS !== undefined && args?.PERMISSIONS !== null ? args.PERMISSIONS : (args?.permissions !== undefined ? args.permissions : '');

      let cleanPerm = Scratch.Cast.toString(rawPerm).replace(/[^0-9]/g, '');
      let permInt = parseInt(cleanPerm, 10);

      if (isNaN(permInt) || permInt <= 0) {
        this._lastAuthResult = 'failed';
        throw new Error('Invalid Permissions Integer. Pick the permissions your project asks for at https://nookara.cc/permissions (people signing in can still untick any of them).');
      }

      this._loginInProgress = true;
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

            pollInterval = setInterval(async () => {
              if (await doPoll(code)) finish();
            }, 1500);
          })
          .catch(() => finish());
      });
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
      if (this._loginInProgress) return Promise.resolve();
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
    keyExists({ KEY }) {
      return this._authenticated && Object.hasOwn(this._flatAccount(), KEY);
    }
    currentToken()      { if (!this._token) throw new Error('Not logged in'); return this._token; }
    clientUsername()    { if (!this._authenticated) throw new Error('Not logged in'); return this._username || this._user?.username || this._accountObj?.account?.username || ''; }
    getAccountObject()  { if (!this._authenticated) throw new Error('Not logged in'); return JSON.stringify(this._accountObj); }
    getAllKeys()         { if (!this._authenticated) throw new Error('Not logged in'); return JSON.stringify(Object.keys(this._flatAccount())); }
    getAllValues()       { if (!this._authenticated) throw new Error('Not logged in'); return JSON.stringify(Object.values(this._flatAccount())); }
    lastActionOutput()  { return this._lastActionOutput; }
    lastActionSuccess() { return this._lastActionSuccess; }
    myClientObject() {
      if (!this._authenticated) throw new Error('Not logged in');
      return JSON.stringify({
        username: this.clientUsername(),
        rank: this._accountObj?.account?.rank || this._user?.rank || '',
        pfp: this._accountObj?.profile?.pfp || '',
        status: this._status,
      });
    }
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
    async loginWithToken({ TOKEN }) {
      this._token = Scratch.Cast.toString(TOKEN);
      await this._validateSavedToken();
      if (!this._authenticated) throw new Error('invalid_token');
      this._connectWS();
      await this._waitForWS();
    }
    async logout() {
      if (this._cancelPendingLogin) this._cancelPendingLogin();
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
      this._emit('logout');
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
    async setPronouns({ PRONOUNS }) {
      this._requireScope(SCOPES.ACCOUNT_WRITE);
      await this._cmd('/account/update', 'PATCH', { pronouns: Scratch.Cast.toString(PRONOUNS ?? '') });
    }
    serviceDisabled({ SERVICE }) {
      const bits = SERVICE_BITS[Scratch.Cast.toString(SERVICE).toLowerCase()] || 0;
      return !!bits && (this._disabledScopes & bits) !== 0;
    }
  }

  const EXTENSION_VERSION = '2.0.3';
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
  const SERVICE_BITS = {
    'instant messages': 64 | 128, 'group chat': 2048, 'voice': 16384, 'storage': 16 | 32,
    'media uploads': 4096, 'friends': 256 | 512, 'credits': 1024 | 8192, 'profile editing': 8,
  };
  const bfString = value => Scratch.Cast.toString(value);
  const BF_DEPRECATED_ROUTE = /^\/chat\/(invite|servers|discover|channels|messages|join|upload|notify|open|emojis|sounds|hooks|bridge|media\/(upload|external))(\/|$)/;
  Object.assign(NookaraExtension.prototype, {
    _bfScopeFor(path, method) {
      const p = Scratch.Cast.toString(path).split('?')[0];
      if (method === 'GET' && (/^\/bonfire\/bots\/gallery(\/[^/]+)?$/.test(p) || p === '/bonfire/directory')) return 0;
      if (/^\/(im|mail)(\/|$)/.test(p)) return method === 'GET' ? SCOPES.VMAIL_READ : SCOPES.VMAIL_SEND;
      if (/^\/(chat|groups|bonfire)(\/|$)/.test(p)) return SCOPES.CHAT;
      return 0;
    },
    async _bfRequest(path, method = 'GET', body = null, form = null) {
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
        return data;
      } catch (error) {
        this._lastActionSuccess = false;
        this._lastActionOutput = JSON.stringify({ error: error.message });
        throw error;
      }
    },
  });
  const bfLogout = NookaraExtension.prototype.logout;
  NookaraExtension.prototype.logout = async function () {       return bfLogout.call(this); };
  NookaraExtension.prototype._bfEnsureSocket = async function () {
    if (!this._token) throw new Error('Log in to Nookara first.');
    if (!this._ws || this._ws.readyState >= 2) { this._wsAuthed = false; this._connectWS(); }
    const deadline = Date.now() + 15000;
    while (!this._wsAuthed || this._ws?.readyState !== 1) {
      if (!this._token) throw new Error('Nookara socket authentication failed.');
      if (Date.now() >= deadline) throw new Error('Nookara socket authentication timed out.');
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  };
  NookaraExtension.prototype._waitForWS = function () { return this._bfEnsureSocket(); };
  const bfOriginalCmd = NookaraExtension.prototype._cmd;
  NookaraExtension.prototype._cmd = function (path, method = 'GET', body = null) {
    return /^\/(chat|im)(\/|$)/.test(Scratch.Cast.toString(path)) ? this._bfRequest(path, method, body) : bfOriginalCmd.call(this, path, method, body);
  };
  Object.assign(NookaraExtension.prototype, {
    extensionVersion() { return EXTENSION_VERSION; },
  });
  const instanceValidate = NookaraExtension.prototype._validateSavedToken;
  NookaraExtension.prototype._validateSavedToken = async function () {
    await instanceValidate.call(this);
  };
  const instanceLogout = NookaraExtension.prototype.logout;
  NookaraExtension.prototype.logout = async function () {
    return instanceLogout.call(this);
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
  const MENU_WORDS = { accountKeys: { id: 'account_id', rank: 'membership', status: 'account_status', 'mod level': 'moderation_level', 'join date': 'joined_at', 'last sign in': 'last_signed_in_at', 'sign in count': 'sign_in_count', 'accepted terms': 'terms_accepted', 'accepted terms date': 'terms_accepted_at', 'email verified': 'email_verified', pfp: 'avatar_url', banner: 'banner_url', bio: 'biography' } };
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
