// Name: Nookara Voice
// ID: ikelenenookaravoice
// Description: Voice rooms and calls for Nookara. Needs Nookara Login; voice channels on Ember servers also need Nookara Chat.
// By: Ikelene
// License: MIT

// made by extensions/split/build.js from velora_extension.js, edit that one and rebuild
(function (Scratch) {
  'use strict';

  if (!Scratch.extensions.unsandboxed) throw new Error('Nookara Voice must run unsandboxed: it shares its sign-in with the other Nookara extensions.');

  const API_VERSION = 1;
  const CORE_URL = 'https://ikelene.net/gallery/extensions/nookara-login.js';
  const EXT_ID = 'ikelenenookaravoice';

  class NookaraExtension {
    constructor(runtime) {
      this.runtime = runtime;
      this._callData = {};
      this._v = this._vFresh();
      this._rtc = null;
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
      this._vUserSettings = new Map();
      this._vVolTimer = null;
      this._vJoinQ = [];
this._vLeaveQ = [];
this._vJoinFlip = false;
this._vLeaveFlip = false;
      this._vEventUser = '';
      this._vCall = null;
      this._evtVoiceCalled = false;
      this._vOutCall = null;
      this._vCallResult = '';
      this._evtVoiceAnswered = false;
      this._evtCallIncoming = false;
      runtime.ext_ikelenenookaravoice = this;
      this._linked = null;
      runtime.on('EXTENSION_ADDED', () => this._linkCore());
      this._linkCore();
    }

    getInfo() {
      const blocks = [
          { blockType: Scratch.BlockType.LABEL, text: 'Events and permissions' },
          { opcode: 'bfJoinVoiceChannel', blockType: Scratch.BlockType.COMMAND, text: 'join voice channel [CHANNEL] in server [SERVER]', arguments: { CHANNEL: { type: Scratch.ArgumentType.STRING, defaultValue: 'c1' }, SERVER: { type: Scratch.ArgumentType.STRING, defaultValue: 's1' } }, tooltip: 'Connect to the server first, then use server and channel IDs.' },
          { opcode: 'bfJoinCall', blockType: Scratch.BlockType.COMMAND, text: 'join call [ROOM]', arguments: { ROOM: { type: Scratch.ArgumentType.STRING, defaultValue: 'bfc_' } } },
          { blockType: Scratch.BlockType.LABEL, text: 'Calls' },
          { opcode: 'bfPostChatCalls', blockType: Scratch.BlockType.COMMAND, text: 'start call with options [OPTIONS]', arguments: { OPTIONS: { type: Scratch.ArgumentType.STRING, defaultValue: '{"to": "username"}' } } },
          { opcode: 'callUser', blockType: Scratch.BlockType.COMMAND, text: 'call user [USER]', arguments: { USER: { type: Scratch.ArgumentType.STRING, defaultValue: 'username' } }, hideFromPalette: true },
          { opcode: 'whenCallReceived', blockType: Scratch.BlockType.HAT, text: 'when call received', hideFromPalette: true },
          { opcode: 'callData', blockType: Scratch.BlockType.REPORTER, text: 'call invitation details', hideFromPalette: true },
          { opcode: 'acceptCall', blockType: Scratch.BlockType.COMMAND, text: 'accept call', hideFromPalette: true },
          { opcode: 'setMic', blockType: Scratch.BlockType.COMMAND, text: 'set mic to [STATE]', arguments: { STATE: { type: Scratch.ArgumentType.STRING, menu: 'onOff', defaultValue: 'on' } }, hideFromPalette: true },
          { opcode: 'stopCall', blockType: Scratch.BlockType.COMMAND, text: 'stop call', hideFromPalette: true },
          { blockType: Scratch.BlockType.LABEL, text: 'Voice' },
          { opcode: 'joinVoice', blockType: Scratch.BlockType.COMMAND, text: 'join voice room [ROOM]', arguments: { ROOM: { type: Scratch.ArgumentType.STRING, defaultValue: 'my-room' } } },
          { opcode: 'leaveVoice', blockType: Scratch.BlockType.COMMAND, text: 'leave voice room' },
          { opcode: 'voiceMic', blockType: Scratch.BlockType.COMMAND, text: 'turn mic [STATE]', arguments: { STATE: { type: Scratch.ArgumentType.STRING, menu: 'onOff', defaultValue: 'on' } } },
          { opcode: 'voiceThreshold', blockType: Scratch.BlockType.COMMAND, text: 'set mic sensitivity to [T]', arguments: { T: { type: Scratch.ArgumentType.NUMBER, defaultValue: 5 } } },
          { opcode: 'inVoice', blockType: Scratch.BlockType.BOOLEAN, text: 'in voice?' },
          { opcode: 'voiceMicOn', blockType: Scratch.BlockType.BOOLEAN, text: 'mic on?' },
          { opcode: 'voiceRoom', blockType: Scratch.BlockType.REPORTER, text: 'voice room' },
          { opcode: 'voiceMyVolume', blockType: Scratch.BlockType.REPORTER, text: 'my mic volume' },
          { opcode: 'voicePeople', blockType: Scratch.BlockType.REPORTER, text: 'people in voice as JSON' },
          { opcode: 'voiceSpeaking', blockType: Scratch.BlockType.REPORTER, text: 'people talking as JSON' },
          { opcode: 'voiceUserVolume', blockType: Scratch.BlockType.REPORTER, text: 'volume of [USER]', arguments: { USER: { type: Scratch.ArgumentType.STRING, defaultValue: 'username' } } },
          { opcode: 'voiceUserSpeaking', blockType: Scratch.BlockType.BOOLEAN, text: 'is [USER] talking?', arguments: { USER: { type: Scratch.ArgumentType.STRING, defaultValue: 'username' } } },
          { opcode: 'voiceSetVolume', blockType: Scratch.BlockType.COMMAND, text: 'set voice volume to [V] %', arguments: { V: { type: Scratch.ArgumentType.NUMBER, defaultValue: 100 } } },
          { opcode: 'voiceSetUserVolume', blockType: Scratch.BlockType.COMMAND, text: 'set [USER] voice volume to [V] %', arguments: { USER: { type: Scratch.ArgumentType.STRING, defaultValue: 'username' }, V: { type: Scratch.ArgumentType.NUMBER, defaultValue: 100 } } },
          { opcode: 'voiceMuteUser', blockType: Scratch.BlockType.COMMAND, text: 'mute [USER] [STATE]', arguments: { USER: { type: Scratch.ArgumentType.STRING, defaultValue: 'username' }, STATE: { type: Scratch.ArgumentType.STRING, menu: 'onOff', defaultValue: 'on' } } },
          { opcode: 'whenVoiceJoin', blockType: Scratch.BlockType.HAT, text: 'when someone joins voice' },
          { opcode: 'whenVoiceLeave', blockType: Scratch.BlockType.HAT, text: 'when someone leaves voice' },
          { opcode: 'voiceEventUser', blockType: Scratch.BlockType.REPORTER, text: 'who joined or left' },
          '---',
          { opcode: 'voiceCallUser', blockType: Scratch.BlockType.COMMAND, text: 'call [USER] into my voice room', arguments: { USER: { type: Scratch.ArgumentType.STRING, defaultValue: 'username' } } },
          { opcode: 'cancelVoiceCall', blockType: Scratch.BlockType.COMMAND, text: 'cancel my call' },
          { opcode: 'whenVoiceAnswered', blockType: Scratch.BlockType.HAT, text: 'when my call is answered' },
          { opcode: 'voiceCallResult', blockType: Scratch.BlockType.REPORTER, text: 'call result' },
          { opcode: 'whenVoiceCalled', blockType: Scratch.BlockType.HAT, text: 'when someone calls me' },
          { opcode: 'beingCalled', blockType: Scratch.BlockType.BOOLEAN, text: 'being called?' },
          { opcode: 'voiceCaller', blockType: Scratch.BlockType.REPORTER, text: 'who is calling' },
          { opcode: 'answerVoiceCall', blockType: Scratch.BlockType.COMMAND, text: '[ANSWER] the call', arguments: { ANSWER: { type: Scratch.ArgumentType.STRING, menu: 'callAnswer', defaultValue: 'accept' } } },
      ];
      if (!this._coreApi()) blocks.unshift({ func: '_addCore', blockType: Scratch.BlockType.BUTTON, text: 'Add Nookara Login' });
      return {
        id: EXT_ID,
        name: 'Nookara Voice',
        color1: '#7c3aed',
        color2: '#5b21b6',
        color3: '#4c1d95',
        docsURI: 'https://nookara.cc/guides/nookara-extensions',
        blocks,
        menus: {
          onOff: { acceptReporters: false, items: ['on', 'off'] },
          callAnswer: { acceptReporters: false, items: ['accept', 'decline'] },
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
      api.on('binary', data => this._vIncoming(data));
      api.on('logout', () => this._onLogout());
      api.on('disconnect', () => this._onDisconnect());
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
    _connectWS(...args) { return this._core().connect(...args); }
    _waitForWS(...args) { return this._core().ensureSocket(...args); }
    _wsSend(...args) { return this._core().send(...args); }
    _bfEnsureSocket(...args) { return this._core().ensureSocket(...args); }
    _channel19(...args) { const peer = this.runtime.ext_ikelenenookarachat; if (!peer) throw new Error('This block needs the Nookara Chat extension too.'); return peer._channel19(...args); }
    _onLogout() {
        this._rtcLeave();
    }
    _onDisconnect() {
        this._vReset('disconnected');
        this._vCall = null;
    }

    _handleWS(msg) {
      switch (msg.type) {
        case 'error':
          if (msg.required_scope === SCOPES.VOICE && this._v.opening) {
            const o = this._v.opening; this._v.opening = null;
            o.reject(new Error(msg.error === 'scope_disabled' ? 'Nookara Voice was disabled for your account by an administrator.' : "Missing permission: this needs the 'Nookara Voice' scope."));
          }
          break;
        case 'chat_error':
          this._rtcMessage(msg, true);
          break;
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
        case 'voice_call_accepted':
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
      }
    }
    whenCallReceived()        { const v = this._evtCallIncoming;   this._evtCallIncoming = false;   return v; }
    callData()          { return JSON.stringify(this._callData); }
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
      if (q.next < now - 0.05 || q.next > now + 1.0) q.next = now + 0.05;
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
      this._vCall = null;
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
  const V_RATE = 16000;
  const V_CHUNK = 512;
  const VELORA_ROUTES = [
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
  ];
  const bfString = value => Scratch.Cast.toString(value);
  Object.assign(NookaraExtension.prototype, {
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
    _rtcMessage(msg, failed = false) { const r = this._rtc; if (!r) return; const p = r.pending.get(msg.nonce); if (p) { r.pending.delete(msg.nonce); failed ? p.reject(new Error(msg.error || 'Voice request failed.')) : p.resolve(msg); } if (msg.type === 'chat_rtc_room' && msg.room === r.room) { this._rtcPeople(msg.people || []); this._rtcSubscribe(msg.people || []).catch(() => {}); } },
    _rtcLeave() { const r = this._rtc; if (!r) return; try { this._wsSend({ type: 'chat_rtc_leave', room: r.room }); } catch (_) {} r.stream?.getTracks().forEach(t => t.stop()); r.producer?.close(); r.consumer?.close(); r.received?.forEach(a => { a.pause(); a.srcObject = null; }); this._rtc = null; },
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
    bfJoinCall({ ROOM }) { this._requireScope(SCOPES.CHAT); this._requireScope(SCOPES.VOICE); if (!/^bfc_\w+$/.test(bfString(ROOM))) throw new Error('Invalid Nookara call room.'); return this._rtcJoin(bfString(ROOM)); },
  });
  for (const spec of VELORA_ROUTES) NookaraExtension.prototype[spec.opcode] = function (args) { return this._bfRoute(spec, args); };
  const bfHandleWS = NookaraExtension.prototype._handleWS;
  NookaraExtension.prototype._handleWS = function (msg) {
    switch (msg.type) {
      case 'chat_error': this._lastActionSuccess = false; this._lastActionOutput = JSON.stringify(msg); this._rtcMessage(msg, true); return;
      case 'chat_rtc_joined': case 'chat_rtc_published': case 'chat_rtc_offer': case 'chat_rtc_ready': case 'chat_rtc_room': this._rtcMessage(msg); return;
      case 'voice_sound': if (msg.sound?.url && this._rtc) { const audio = new Audio(msg.sound.url); audio.volume = Math.min(1, this._vGlobal / 100); audio.play().catch(() => {}); } return;
    }
    bfHandleWS.call(this, msg);
  };
  const bfJoinVoice = NookaraExtension.prototype._joinVoiceRoom;
  NookaraExtension.prototype._joinVoiceRoom = function (room) { if (/^bfc?_/.test(room)) { this._requireScope(SCOPES.VOICE); return this._rtcJoin(room); } return bfJoinVoice.call(this, room); };
  const bfLeaveVoice = NookaraExtension.prototype.leaveVoice;
  NookaraExtension.prototype.leaveVoice = function () { this._rtcLeave(); return bfLeaveVoice.call(this); };
  const bfMic = NookaraExtension.prototype.voiceMic;
  NookaraExtension.prototype.voiceMic = function (args) { if (this._rtc?.stream) { this._rtc.stream.getAudioTracks().forEach(t => { t.enabled = args.STATE === 'on'; }); this._vMicOn = args.STATE === 'on'; return; } return bfMic.call(this, args); };
  const bfRtcJoin = NookaraExtension.prototype._rtcJoin;
  NookaraExtension.prototype._rtcJoin = async function (room) {
    this._requireScope(SCOPES.CHAT); this._requireScope(SCOPES.VOICE);
    if (!this._wsAuthed || this._ws?.readyState !== 1) throw new Error('Connect to Nookara before joining voice.');
    try { return await bfRtcJoin.call(this, room); }
    catch (error) { this._rtcLeave(); this._v.room = null; this._vMicOn = false; throw error; }
  };
  NookaraExtension.prototype._rtcReq = function (type, body = {}) {
    const r = this._rtc;
    if (!r) return Promise.reject(new Error('Not in Nookara voice.'));
    return new Promise((resolve, reject) => {
      const nonce = `scratch_rtc_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const timer = setTimeout(() => { r.pending.delete(nonce); reject(new Error('Voice request timed out.')); }, 20000);
      r.pending.set(nonce, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
      this._wsSend({ type, nonce, ...body });
    });
  };
  const bfRtcLeave = NookaraExtension.prototype._rtcLeave;
  NookaraExtension.prototype._rtcLeave = function () { if (this._rtc) for (const p of this._rtc.pending.values()) p.reject(new Error('Left Nookara voice.')); bfRtcLeave.call(this); };
  const bfReset = NookaraExtension.prototype._vReset;
  NookaraExtension.prototype._vReset = function (...args) { this._rtcLeave(); return bfReset.apply(this, args); };
  const bfVolume = NookaraExtension.prototype.voiceSetVolume;
  NookaraExtension.prototype.voiceSetVolume = function (args) { bfVolume.call(this, args); if (this._rtc) for (const audio of this._rtc.received.values()) audio.volume = Math.min(1, this._vGlobal / 100); };
  NookaraExtension.prototype._rtcPeople = function (people) {
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
  NookaraExtension.prototype._rtcSubscribe = async function (people) {
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
  NookaraExtension.prototype._rtcJoin = async function (room) {
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
  const bfApplyUser = NookaraExtension.prototype._vApplyUser;
  NookaraExtension.prototype._vApplyUser = function (name) {
    bfApplyUser.call(this, name);
    const settings = this._vUserSettings.get(name) || { volume: 100, muted: false };
    for (const node of this._rtc?.nodes?.values() || []) if (node.ref.username === name) node.gain.gain.value = settings.muted ? 0 : settings.volume / 100;
  };
  const bfDisposeRtc = NookaraExtension.prototype._rtcLeave;
  NookaraExtension.prototype._rtcLeave = function () {
    const r = this._rtc;
    if (r) { clearInterval(r.meter); r.cancelConnect?.(); r.localSource?.disconnect(); for (const n of r.nodes?.values() || []) { n.source.disconnect(); n.gain.disconnect(); } }
    bfDisposeRtc.call(this);
    if (r) { this._v.room = null; this._v.users.clear(); this._vMicOn = false; this._vMyVol = 0; }
  };
  if (NookaraExtension.prototype.callUser) {
    NookaraExtension.prototype.callUser = async function ({ USER }) {
      await this._bfEnsureSocket();
      const callId = Math.random().toString(36).slice(2);
      this._callData = { callId, to: bfString(USER).trim() };
      this._wsSend({ type: 'call_user', to: this._callData.to, callId });
    };
  }
  const migrationError = detail => new Error(detail + ': use the connect block and the server ID / channel ID (or an instance-scoped block).');
  const p19 = NookaraExtension.prototype;
  const identityEvents19 = p19._handleWS;
  p19._handleWS = function (frame) {
    if (['globalMessage', 'roomMessage', 'globalMessages', 'roomMessages'].includes(frame.type)) return;
    if (frame.type?.startsWith('chat_') && !/^chat_(rtc_|call_|error$)/.test(frame.type)) return;
    return identityEvents19.call(this, frame);
  };
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
