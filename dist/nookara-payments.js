// Name: Nookara Payments
// ID: ikelenenookarapayments
// Description: Credits, subscriptions, products, cart and checkout for Nookara. Needs Nookara Login.
// By: Ikelene
// License: MIT

// made by extensions/split/build.js from velora_extension.js, edit that one and rebuild
(function (Scratch) {
  'use strict';

  if (!Scratch.extensions.unsandboxed) throw new Error('Nookara Payments must run unsandboxed: it shares its sign-in with the other Nookara extensions.');

  const API_VERSION = 1;
  const CORE_URL = 'https://ikelene.net/gallery/extensions/nookara-login.js';
  const SERVER_HTTP = 'https://nookara.cc';
  const EXT_ID = 'ikelenenookarapayments';

  class NookaraExtension {
    constructor(runtime) {
      this.runtime = runtime;
      this._evtBalanceChanged = false;
      runtime.ext_ikelenenookarapayments = this;
      this._linked = null;
      runtime.on('EXTENSION_ADDED', () => this._linkCore());
      this._linkCore();
    }

    getInfo() {
      const blocks = [
          { blockType: Scratch.BlockType.LABEL, text: 'Credits' },
          { opcode: 'getBalance', blockType: Scratch.BlockType.REPORTER, text: 'my credits' },
          { opcode: 'transferCredits', blockType: Scratch.BlockType.COMMAND, text: 'send [AMOUNT] credits to [USER]', arguments: { AMOUNT: { type: Scratch.ArgumentType.NUMBER, defaultValue: 10 }, USER: { type: Scratch.ArgumentType.STRING, defaultValue: 'username' } } },
          { opcode: 'whenBalanceChanged', blockType: Scratch.BlockType.HAT, text: 'when balance changed' },
          { opcode: 'getTransactions', blockType: Scratch.BlockType.REPORTER, text: 'my transactions' },
          { opcode: 'subscribe', blockType: Scratch.BlockType.COMMAND, text: 'subscribe to [USER] for [AMOUNT] credits every [PERIOD] with note [NOTE]', arguments: { AMOUNT: { type: Scratch.ArgumentType.NUMBER, defaultValue: 5 }, USER: { type: Scratch.ArgumentType.STRING, defaultValue: 'username' }, PERIOD: { type: Scratch.ArgumentType.STRING, menu: 'periodMenu', defaultValue: 'monthly' }, NOTE: { type: Scratch.ArgumentType.STRING, defaultValue: '' } } },
          { opcode: 'cancelSubscription', blockType: Scratch.BlockType.COMMAND, text: 'unsubscribe from [USER]', arguments: { USER: { type: Scratch.ArgumentType.STRING, defaultValue: 'username' } } },
          { opcode: 'getOutgoingSubs', blockType: Scratch.BlockType.REPORTER, text: 'my subscriptions' },
          { opcode: 'getIncomingSubs', blockType: Scratch.BlockType.REPORTER, text: 'my subscribers' },
          { blockType: Scratch.BlockType.LABEL, text: 'Products and checkout' },
          { opcode: 'addProductToCart', blockType: Scratch.BlockType.COMMAND, text: 'add [QUANTITY] of product [ID] to cart', arguments: { QUANTITY: { type: Scratch.ArgumentType.NUMBER, defaultValue: 1 }, ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'prod_...' } } },
          { opcode: 'addMembershipToCart', blockType: Scratch.BlockType.COMMAND, text: 'add membership [ID] to cart on [PLAN] plan', arguments: { ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'prod_...' }, PLAN: { type: Scratch.ArgumentType.STRING, menu: 'productPlan', defaultValue: 'regular' } } },
          { opcode: 'addPaymentToCart', blockType: Scratch.BlockType.COMMAND, text: 'add [AMOUNT] credits to [USER] to cart with note [NOTE]', arguments: { AMOUNT: { type: Scratch.ArgumentType.NUMBER, defaultValue: 10 }, USER: { type: Scratch.ArgumentType.STRING, defaultValue: 'username' }, NOTE: { type: Scratch.ArgumentType.STRING, defaultValue: '' } } },
          { opcode: 'openCheckout', blockType: Scratch.BlockType.COMMAND, text: 'open checkout and wait' },
          { opcode: 'buyProductDirect', blockType: Scratch.BlockType.COMMAND, text: 'buy [QUANTITY] of product [ID] without checkout', arguments: { QUANTITY: { type: Scratch.ArgumentType.NUMBER, defaultValue: 1 }, ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'prod_...' } } },
          { opcode: 'payUserDirect', blockType: Scratch.BlockType.COMMAND, text: 'pay [AMOUNT] credits to [USER] with note [NOTE] without checkout', arguments: { AMOUNT: { type: Scratch.ArgumentType.NUMBER, defaultValue: 10 }, USER: { type: Scratch.ArgumentType.STRING, defaultValue: 'username' }, NOTE: { type: Scratch.ArgumentType.STRING, defaultValue: '' } } },
          { opcode: 'ownsProduct', blockType: Scratch.BlockType.BOOLEAN, text: 'own product [ID]?', arguments: { ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'prod_...' } } },
          { opcode: 'productBoughtCount', blockType: Scratch.BlockType.REPORTER, text: 'times I bought product [ID]', arguments: { ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'prod_...' } } },
          { opcode: 'membershipStatus', blockType: Scratch.BlockType.REPORTER, text: 'my membership of product [ID]', arguments: { ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'prod_...' } } },
          { opcode: 'productInfo', blockType: Scratch.BlockType.REPORTER, text: 'product [ID] info', arguments: { ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'prod_...' } } },
      ];
      if (!this._coreApi()) blocks.unshift({ func: '_addCore', blockType: Scratch.BlockType.BUTTON, text: 'Add Nookara Login' });
      return {
        id: EXT_ID,
        name: 'Nookara Payments',
        color1: '#7c3aed',
        color2: '#5b21b6',
        color3: '#4c1d95',
        docsURI: 'https://nookara.cc/guides/nookara-extensions',
        blocks,
        menus: {
          periodMenu: { acceptReporters: false, items: ['weekly', 'biweekly', 'monthly', 'bimonthly', 'yearly'] },
          productPlan: { acceptReporters: true, items: [{ text: 'regular', value: 'period' }, { text: 'yearly', value: 'yearly' }] },
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




    _handleWS(msg) {
      switch (msg.type) {
        // Instant Messages
        case 'balance_changed':
          this._evtBalanceChanged = true;
          if (this._accountObj.account) this._accountObj.account.credits = (this._accountObj.account.credits || 0) + (msg.delta || 0);
          break;
        // an admin changed which services this account can use (applies right away)
        // achievements (granted from any of your apps - the launcher pops them up)
        // ── Nookara Voice ──
      }
    }
    whenBalanceChanged()      { const v = this._evtBalanceChanged; this._evtBalanceChanged = false; return v; }
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
