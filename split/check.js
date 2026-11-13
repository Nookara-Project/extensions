'use strict';
// runs every block of the old all in one extension and the split ones against the same fake server and compares what they do.
// run: node check.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { MODULES, CORE_ID } = require('./manifest');

const DIST = path.join(__dirname, '..', 'dist');
const OLD = fs.readFileSync(path.join(__dirname, '..', '..', 'velora_extension.js'), 'utf8');
const files = Object.fromEntries(Object.entries(MODULES).map(([k, m]) => [k, fs.readFileSync(path.join(DIST, m.file), 'utf8')]));

const BlockType = { COMMAND: 'command', REPORTER: 'reporter', BOOLEAN: 'Boolean', HAT: 'hat', EVENT: 'event', LABEL: 'label', BUTTON: 'button', CONDITIONAL: 'conditional', LOOP: 'loop', XML: 'xml' };
const ArgumentType = { ANGLE: 'angle', BOOLEAN: 'Boolean', COLOR: 'color', NUMBER: 'number', STRING: 'string', MATRIX: 'matrix', NOTE: 'note', IMAGE: 'image' };

const USER = { id: 7, username: 'testuser', scopes: 2 ** 18 - 1, rank: 'member' };
const reply = (url, method) => {
  if (url.includes('/auth/validate')) return { valid: true, user: USER };
  if (url.includes('/account/me')) return { account: { id: 7, username: 'testuser', credits: 5, badges: ['a'] }, profile: { pfp: 'x' } };
  return { success: true, url: url.replace(/^https?:\/\/[^/]+/, ''), method };
};

function world() {
  const frames = [], calls = [];
  const listeners = {};
  const sockets = [];
  const stubs = new Map();
  class FakeSocket {
    constructor(url) { this.url = url; this.readyState = 1; sockets.push(this); setTimeout(() => { if (this.onopen) this.onopen(); }, 0); }
    send(frame) {
      if (typeof frame === 'string') {
        const parsed = JSON.parse(frame); frames.push(parsed.type);
        if (parsed.type === 'auth_token') setTimeout(() => this.deliver({ type: 'auth_success', user: USER }), 0);
      } else frames.push('binary');
    }
    close() { this.readyState = 3; if (this.onclose) this.onclose({}); }
    deliver(frame) { if (this.onmessage) this.onmessage({ data: JSON.stringify(frame) }); }
  }
  const runtime = { on(event, fn) { (listeners[event] = listeners[event] || []).push(fn); }, emit(event, ...args) { for (const fn of listeners[event] || []) fn(...args); }, startHats() { return []; } };
  const registered = [];
  const ctx = {
    console: { ...console, error() {}, warn() {}, log() {} }, setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {}, URL, URLSearchParams, TextEncoder, TextDecoder, btoa, atob, Uint8Array, FormData, Blob,
    WebSocket: FakeSocket, Audio: class { play() { return Promise.resolve(); } },
    fetch: async (url, options = {}) => {
      const u = String(url);
      calls.push(`${options.method || 'GET'} ${u}`);
      const data = reply(u, options.method || 'GET');
      return { ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data), blob: async () => new Blob(['x']), headers: { get: () => null } };
    },
    crypto: globalThis.crypto,
  };
  ctx.window = { open: () => null, addEventListener() {}, removeEventListener() {}, screen: {}, location: { href: 'https://turbowarp.org/editor', origin: 'https://turbowarp.org' } };
  ctx.document = { addEventListener() {}, createElement: () => ({ style: {}, click() {}, addEventListener() {} }), body: { appendChild() {} }, hidden: false };
  ctx.navigator = {};
  ctx.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
  ctx.location = ctx.window.location;
  const Scratch = {
    BlockType, ArgumentType, TargetType: { SPRITE: 'sprite', STAGE: 'stage' },
    Cast: { toString: v => String(v ?? ''), toNumber: v => Number(v) || 0, toBoolean: Boolean },
    vm: { runtime, extensionManager: { isExtensionLoaded: () => true, refreshBlocks: () => Promise.resolve(), loadExtensionURL: () => Promise.resolve() } },
    extensions: { unsandboxed: true, register(ext) { registered.push(ext); runtime.emit('EXTENSION_ADDED', ext.getInfo()); } },
    translate: s => s,
  };
  ctx.Scratch = Scratch;
  vm.createContext(ctx);
  return { ctx, runtime, registered, frames, calls, sockets, load: code => vm.runInContext(code, ctx), stubs };
}

const argsFor = block => Object.fromEntries(Object.entries(block.arguments || {}).map(([k, a]) => [k, a.defaultValue ?? (a.type === 'number' ? 1 : 'x')]));
const clean = v => JSON.stringify(v, (k, x) => typeof x === 'function' ? undefined : x);
const settle = () => new Promise(r => setTimeout(r, 2));

async function callAll(exts, revive) {
  const out = {};
  for (const ext of exts) {
    for (const block of ext.getInfo().blocks) {
      if (!block.opcode || block.blockType === 'hat' || block.blockType === 'event') continue;
      // blocks that wait for a popup, timer or real socket reply cant finish against a fake server
      if (/openAppLogin|openLoginPrompt|openFilePicker|openCheckout|uploadImage|uploadAudio|uploadVideo|uploadPfp|joinVoice|voiceMic|voiceCallUser|callUser|acceptCall|setMic|stopCall|bfJoin|sendIM|replyToStatus|logout/.test(block.opcode)) { if (typeof ext[block.opcode] !== 'function') out[block.opcode] = 'MISSING'; continue; }
      revive();
      let result;
      try {
        const fn = ext[block.opcode];
        if (typeof fn !== 'function') { out[block.opcode] = 'MISSING'; continue; }
        result = await Promise.race([Promise.resolve(fn.call(ext, argsFor(block), {})), new Promise(r => setTimeout(() => r('__timeout__'), 200))]);
        out[block.opcode] = clean(result);
      } catch (error) {
        out[block.opcode] = 'ERR ' + error.message;
      }
    }
  }
  return out;
}

(async () => {
  let bad = 0;
  const fail = msg => { bad++; console.log('FAIL', msg); };

  // 1. the old one, signed in
  const old = world();
  old.load(OLD);
  const oldExt = old.registered[0];
  await oldExt.loginWithToken({ TOKEN: 'tok' });
  await settle();

  // 2. the split ones, add-ons first because thats what a project load can do
  const fresh = world();
  for (const key of ['chat', 'voice', 'payments', 'data', 'social', 'profiles']) fresh.load(files[key]);
  if (fresh.registered.length !== 6) fail('add-ons did not all register without the core');
  const pay = fresh.registered.find(e => e.getInfo().id === MODULES.payments.id);
  if (!pay.getInfo().blocks.some(b => b.func === '_addCore')) fail('no Add Nookara Login button while the core is missing');
  try { await pay.getBalance({}); fail('a block worked without the core'); } catch (error) { if (!/Nookara Login/.test(error.message)) fail('wrong error without the core: ' + error.message); }
  fresh.load(files.login);
  const core = fresh.runtime[`ext_${CORE_ID}`];
  if (!core?.api) fail('core did not put itself on the runtime');
  if (pay.getInfo().blocks.some(b => b.func === '_addCore')) fail('button still shown after the core loaded');
  await core.loginWithToken({ TOKEN: 'tok' });
  await settle();
  if (pay._token !== 'tok' || !pay._authenticated) fail('add-on does not see the sign-in');
  if (fresh.sockets.length !== 1) fail(`expected one socket, got ${fresh.sockets.length}`);

  // 3. every block both ways
  const a = await callAll([oldExt], () => { oldExt._token = 'tok'; oldExt._authenticated = true; });
  const b = await callAll(fresh.registered.filter(e => e !== core).concat(core), () => { core._token = 'tok'; core._authenticated = true; });
  const diffs = [];
  for (const op of Object.keys(a)) {
    if (!(op in b)) { if (!/^_/.test(op)) diffs.push(`${op}: only in old`); continue; }
    if (op !== 'lastActionOutput' && a[op] !== b[op]) diffs.push(`${op}:\n     old ${String(a[op]).slice(0, 150)}\n     new ${String(b[op]).slice(0, 150)}`);
  }
  for (const op of Object.keys(b)) if (!(op in a) && b[op] === 'MISSING') diffs.push(`${op}: missing`);
  const missing = Object.entries(b).filter(([, v]) => v === 'MISSING').map(([k]) => k);
  if (missing.length) fail('blocks with no function: ' + missing.join(', '));

  // 4. same requests went out
  const norm = list => list.map(x => x.replace(/[?&]_=\d+/, '')).sort();
  const oldCalls = new Set(norm(old.calls)), newCalls = new Set(norm(fresh.calls));
  const lost = [...oldCalls].filter(x => !newCalls.has(x));
  const gained = [...newCalls].filter(x => !oldCalls.has(x));

  // 5. socket frames reach the add-ons
  const social = fresh.registered.find(e => e.getInfo().id === MODULES.social.id);
  fresh.sockets[0].deliver({ type: 'im_received', message: { from: 'someone', body: 'hi' } });
  if (social.lastIMSender() !== 'someone' && !social._lastIM) fail('social add-on missed im_received');
  fresh.sockets[0].deliver({ type: 'balance_changed', delta: 3 });
  if (!pay._evtBalanceChanged) fail('payments add-on missed balance_changed');
  const voice = fresh.registered.find(e => e.getInfo().id === MODULES.voice.id);
  fresh.sockets[0].deliver({ type: 'voice_call_incoming', callId: 'c', from: 'x', room: 'r' });
  if (voice.voiceCaller() !== 'x') fail('voice add-on missed voice_call_incoming');
  const chat = fresh.registered.find(e => e.getInfo().id === MODULES.chat.id);
  if (chat.serialize === undefined) fail('chat lost serialize');

  // the plain menu words and the old values both work, and no block lost an input
  core._accountObj = { account: { id: 7 }, profile: { pfp: 'pic' } };
  core._authenticated = true;
  if (core.getAccountKey({ KEY: 'pfp' }) !== 'pic' || core.getAccountKey({ KEY: 'avatar_url' }) !== 'pic') fail('pfp menu word');
  if (!core.keyExists({ KEY: 'pfp' })) fail('keyExists does not take the plain word');
  if (chat.bfPermissionBit({ PERMISSION: 'admin' }) !== 512 || chat.bfPermissionBit({ PERMISSION: 'ADMIN' }) !== 512) fail('permission menu word');
  if (core.getInfo().blocks.find(b => b.opcode === 'getAccountKey').text !== 'get [KEY]') fail('plain wording not applied');
  const inputs = t => (t.match(/\[[A-Z_0-9]+\]/g) || []).sort().join();
  const oldBlocks = new Map(oldExt.getInfo().blocks.filter(b => b.opcode).map(b => [b.opcode, b]));
  for (const ext of fresh.registered) for (const block of ext.getInfo().blocks) {
    if (!block.opcode) continue;
    const was = oldBlocks.get(block.opcode);
    if (inputs(block.text) !== inputs(was.text) || Object.keys(block.arguments || {}).sort().join() !== Object.keys(was.arguments || {}).sort().join()) fail('inputs changed on ' + block.opcode);
  }

  // 6. logout goes everywhere
  const before = fresh.sockets[0];
  await core.logout();
  if (pay._token !== null || social._authenticated) fail('add-ons still signed in after logout');
  if (before.readyState !== 3) fail('socket still open after logout');

  // 7. converting a project
  const { migrateProject } = require('../../public/assets/extensions/migrate-core.js');
  const map = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'assets', 'extensions', 'block-map.json'), 'utf8'));
  const project = { extensions: ['pen', 'velora'], extensionURLs: { velora: 'https://ikelene.net/gallery/extensions/velora_extension.js' }, monitors: [{ id: 'velora_getBalance', opcode: 'velora_getBalance' }],
    targets: [{ extensionStorage: { velora: { instances: ['https://chat.ikelene.net'] } }, blocks: { a: { opcode: 'velora_subscribe', parent: null, inputs: { PERIOD: [1, 'b'] } }, b: { opcode: 'velora_menu_periodMenu', parent: 'a' }, c: { opcode: 'motion_movesteps' }, d: { opcode: 'velora_loginWithToken' } } }] };
  const moved = migrateProject(project, map);
  if (!moved.ok || moved.used.join() !== 'login,chat,payments') fail('project conversion: ' + JSON.stringify(moved));
  if (project.targets[0].blocks.b.opcode !== MODULES.payments.id + '_menu_periodMenu') fail('menu shadow not moved: ' + project.targets[0].blocks.b.opcode);
  if (project.targets[0].blocks.c.opcode !== 'motion_movesteps') fail('touched a normal block');
  if (project.monitors[0].id !== MODULES.payments.id + '_getBalance') fail('monitor id not moved');
  if (project.extensions.includes('velora') || !project.extensions.includes('pen') || !project.extensions.includes(MODULES.login.id)) fail('extensions list wrong: ' + project.extensions);
  if (project.extensionURLs.velora || !project.extensionURLs[MODULES.login.id]) fail('extension urls wrong');
  if (!project.targets[0].extensionStorage[MODULES.chat.id]) fail('saved servers not moved');
  const strange = migrateProject({ targets: [{ blocks: { a: { opcode: 'velora_notARealBlock' } } }] }, map);
  if (strange.ok || strange.unknown[0] !== 'notARealBlock') fail('unknown block not refused');
  if (!migrateProject({ targets: [{ blocks: { a: { opcode: 'motion_movesteps' } } }] }, map).none) fail('non Nookara project not spotted');

  // 8. forums loads on its own
  const forums = world();
  forums.load(fs.readFileSync(path.join(DIST, 'nookara-forums.js'), 'utf8'));
  if (await forums.registered[0].directory() === undefined) fail('forums directory');
  if (forums.calls[0] !== 'GET https://forums.nookara.cc/forums/api/directory') fail('forums url: ' + forums.calls[0]);

  console.log(`${Object.keys(a).length} blocks compared, ${diffs.length} differ, ${lost.length} requests lost, ${gained.length} extra`);
  if (process.argv.includes('--verbose')) {
    for (const d of diffs) console.log(' ', d);
    for (const x of lost) console.log('  lost', x);
    for (const x of gained) console.log('  extra', x);
  }
  if (diffs.length || lost.length) bad++;
  console.log(bad ? 'NOT OK' : 'OK');
  process.exit(bad ? 1 : 0);
})().catch(error => { console.error(error); process.exit(1); });
