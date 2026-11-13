// Name: Nookara Data
// ID: ikelenenookaradata
// Description: Cloud storage, uploads and the file picker for Nookara. Needs Nookara Login.
// By: Ikelene
// License: MIT

// made by extensions/split/build.js from velora_extension.js, edit that one and rebuild
(function (Scratch) {
  'use strict';

  if (!Scratch.extensions.unsandboxed) throw new Error('Nookara Data must run unsandboxed: it shares its sign-in with the other Nookara extensions.');

  const API_VERSION = 1;
  const CORE_URL = 'https://ikelene.net/gallery/extensions/nookara-login.js';
  const SERVER_HTTP = 'https://nookara.cc';
  const EXT_ID = 'ikelenenookaradata';

  class NookaraExtension {
    constructor(runtime) {
      this.runtime = runtime;
      this._storageId = null;
      this._uploadStatus = 'idle';
      this._lastUploadUrl = '';
      this._uploadProgress = 0;
      this._selectedFile = null;
      this._selectedFileUrl = '';
      this._selectedFileName = '';
      this._selectedFileSize = 0;
      this._fileSelected = false;
      runtime.ext_ikelenenookaradata = this;
      this._linked = null;
      runtime.on('EXTENSION_ADDED', () => this._linkCore());
      this._linkCore();
    }

    getInfo() {
      const blocks = [
          { blockType: Scratch.BlockType.LABEL, text: 'Storage' },
          { opcode: 'setStorageId', blockType: Scratch.BlockType.COMMAND, text: 'use storage [ID]', arguments: { ID: { type: Scratch.ArgumentType.STRING, defaultValue: 'myProject' } } },
          { opcode: 'storageIdSet', blockType: Scratch.BlockType.BOOLEAN, text: 'storage set?' },
          { opcode: 'getStorageId', blockType: Scratch.BlockType.REPORTER, text: 'storage name' },
          { opcode: 'getStorage', blockType: Scratch.BlockType.REPORTER, text: 'get [KEY]', arguments: { KEY: { type: Scratch.ArgumentType.STRING, defaultValue: 'score' } } },
          { opcode: 'setStorage', blockType: Scratch.BlockType.COMMAND, text: 'set [KEY] to [VALUE]', arguments: { KEY: { type: Scratch.ArgumentType.STRING, defaultValue: 'score' }, VALUE: { type: Scratch.ArgumentType.STRING, defaultValue: '0' } } },
          { opcode: 'storageKeyExists', blockType: Scratch.BlockType.BOOLEAN, text: 'has [KEY]?', arguments: { KEY: { type: Scratch.ArgumentType.STRING, defaultValue: 'score' } } },
          { opcode: 'deleteStorageKey', blockType: Scratch.BlockType.COMMAND, text: 'delete [KEY]', arguments: { KEY: { type: Scratch.ArgumentType.STRING, defaultValue: 'score' } } },
          { opcode: 'getAllStorageKeys', blockType: Scratch.BlockType.REPORTER, text: 'all keys' },
          { opcode: 'getAllStorageValues', blockType: Scratch.BlockType.REPORTER, text: 'all values' },
          { opcode: 'clearStorage', blockType: Scratch.BlockType.COMMAND, text: 'delete everything' },
          { blockType: Scratch.BlockType.LABEL, text: 'Storage space' },
          { opcode: 'storageUsage', blockType: Scratch.BlockType.REPORTER, text: 'storage used' },
          { opcode: 'storageLimit', blockType: Scratch.BlockType.REPORTER, text: 'storage limit' },
          { opcode: 'storageRemaining', blockType: Scratch.BlockType.REPORTER, text: 'storage left' },
          { opcode: 'storageBiggest', blockType: Scratch.BlockType.REPORTER, text: 'biggest keys' },
          '---',
          { blockType: Scratch.BlockType.LABEL, text: 'Uploads' },
          { opcode: 'uploadImage', blockType: Scratch.BlockType.COMMAND, text: 'upload image [DATA_URI] and [MODE]', arguments: { DATA_URI: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, MODE: { type: Scratch.ArgumentType.STRING, menu: 'uploadModeMenu', defaultValue: 'wait' } } },
          { opcode: 'uploadAudio', blockType: Scratch.BlockType.COMMAND, text: 'upload audio [DATA_URI] and [MODE]', arguments: { DATA_URI: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, MODE: { type: Scratch.ArgumentType.STRING, menu: 'uploadModeMenu', defaultValue: 'wait' } } },
          { opcode: 'uploadVideo', blockType: Scratch.BlockType.COMMAND, text: 'upload video [DATA_URI] and [MODE]', arguments: { DATA_URI: { type: Scratch.ArgumentType.STRING, defaultValue: '' }, MODE: { type: Scratch.ArgumentType.STRING, menu: 'uploadModeMenu', defaultValue: 'wait' } } },
          { opcode: 'uploadStatus', blockType: Scratch.BlockType.REPORTER, text: 'upload status' },
          { opcode: 'lastUploadUrl', blockType: Scratch.BlockType.REPORTER, text: 'uploaded file link' },
          { opcode: 'uploadProgress', blockType: Scratch.BlockType.REPORTER, text: 'upload progress' },
          { blockType: Scratch.BlockType.LABEL, text: 'Pick a file' },
          { opcode: 'openFilePicker', blockType: Scratch.BlockType.COMMAND, text: 'pick a file: [TYPE]', arguments: { TYPE: { type: Scratch.ArgumentType.STRING, menu: 'fileTypeMenu', defaultValue: 'videos' } } },
          { opcode: 'fileWasSelected', blockType: Scratch.BlockType.BOOLEAN, text: 'file picked?' },
          { opcode: 'selectedFileUri', blockType: Scratch.BlockType.REPORTER, text: 'picked file as data URI' },
          { opcode: 'selectedFileName', blockType: Scratch.BlockType.REPORTER, text: 'picked file name' },
          { opcode: 'selectedFileSize', blockType: Scratch.BlockType.REPORTER, text: 'picked file size' },
      ];
      if (!this._coreApi()) blocks.unshift({ func: '_addCore', blockType: Scratch.BlockType.BUTTON, text: 'Add Nookara Login' });
      return {
        id: EXT_ID,
        name: 'Nookara Data',
        color1: '#7c3aed',
        color2: '#5b21b6',
        color3: '#4c1d95',
        docsURI: 'https://nookara.cc/guides/nookara-extensions',
        blocks,
        menus: {
          uploadModeMenu: { acceptReporters: false, items: ['wait', 'continue'] },
          fileTypeMenu: { acceptReporters: false, items: ['videos', 'images', { text: 'audio', value: 'audio files' }] },
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




    storageIdSet()  { return this._storageId !== null; }
    storageKeyExists({ KEY }) {
      if (!this._storageId) throw new Error("No storage ID set. Use the 'set storage ID to' block first.");
      this._requireScope(SCOPES.STORAGE_READ);
      return this._http(`/storage/${encodeURIComponent(this._storageId)}/${encodeURIComponent(KEY)}`).then(d => !d.error);
    }
    getStorageId()      { return this._storageId || ''; }
    uploadStatus()    { return this._uploadStatus; }
    lastUploadUrl()   { return this._lastUploadUrl; }
    setStorageId({ ID }) { this._storageId = Scratch.Cast.toString(ID); }
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

  const veloraExt = new NookaraExtension(Scratch.vm.runtime);

  // the menus show plain words but keep their old values, a dropped reporter can say either
  const MENU_WORDS = { fileTypeMenu: { audio: 'audio files' } };
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
