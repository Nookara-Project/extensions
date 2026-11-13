'use strict';
// builds extensions/dist/nookara-*.js out of ../../velora_extension.js + manifest.js, so theres still only one file to edit.
// run: node build.js  (npm i first, it only needs acorn). see README.md
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const acorn = require('acorn');
const { CORE_ID, HOSTED, MODULES, SHARED, FORWARD, WS_CASES, moduleFor } = require('./manifest');
const { TEXT, LABELS, MENUS } = require('./plain-words');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(__dirname, '..', 'dist');
const read = file => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const SOURCE = read(path.join(ROOT, 'velora_extension.js'));
const errors = [];
const fail = msg => errors.push(msg);

const BLOCK_TYPES = { COMMAND: 'command', REPORTER: 'reporter', BOOLEAN: 'Boolean', HAT: 'hat', EVENT: 'event', LABEL: 'label', BUTTON: 'button', CONDITIONAL: 'conditional', LOOP: 'loop', XML: 'xml' };
const ARG_TYPES = { ANGLE: 'angle', BOOLEAN: 'Boolean', COLOR: 'color', NUMBER: 'number', STRING: 'string', MATRIX: 'matrix', NOTE: 'note', IMAGE: 'image' };

// run the real file against a stub and take the finished palette, since getInfo gets patched five times over
function readPalette() {
  let ext;
  const Scratch = { BlockType: BLOCK_TYPES, ArgumentType: ARG_TYPES, TargetType: { SPRITE: 'sprite', STAGE: 'stage' }, Cast: { toString: String, toNumber: Number, toBoolean: Boolean }, vm: { runtime: { on() {}, startHats() {} } }, extensions: { register(e) { ext = e; }, unsandboxed: true }, translate: s => s };
  const ctx = { Scratch, console, setTimeout, clearTimeout, setInterval, clearInterval, URL, URLSearchParams, TextEncoder, TextDecoder, btoa, atob, fetch: () => new Promise(() => {}) };
  ctx.window = { addEventListener() {}, removeEventListener() {} };
  ctx.document = { addEventListener() {} };
  ctx.WebSocket = class {};
  vm.runInNewContext(SOURCE, ctx);
  const info = ext.getInfo();
  return JSON.parse(JSON.stringify(info));
}

function splitPalette(info) {
  const out = Object.fromEntries(Object.keys(MODULES).map(key => [key, []]));
  let section = '';
  for (const block of info.blocks) {
    if (block === '---') { for (const key in out) if (out[key].lastSection === section && out[key].length && out[key][out[key].length - 1] !== '---') out[key].push('---'); continue; }
    if (block.blockType === 'label') { section = block.text; continue; }
    const name = block.opcode || block.func;
    const key = moduleFor(block.opcode, section);
    if (!key) { fail(`block ${name} in section "${section}" has no extension`); continue; }
    const list = out[key];
    if (list.lastSection !== section && !block.hideFromPalette) { list.push({ blockType: 'label', text: LABELS[section] || section }); list.lastSection = section; }
    if (TEXT[block.opcode]) {
      const inputs = text => (text.match(/\[[A-Z_0-9]+\]/g) || []).sort().join();
      if (inputs(TEXT[block.opcode]) !== inputs(block.text)) fail(`plain-words: ${block.opcode} has different inputs than "${block.text}"`);
      block.text = TEXT[block.opcode];
    }
    if (block.tooltip) block.tooltip = 'Connect to the server first, then use server and channel IDs.';
    list.push(block);
  }
  for (const key in out) while (out[key][out[key].length - 1] === '---') out[key].pop();
  return out;
}

const walk = (node, visit, parent) => {
  if (!node || typeof node.type !== 'string') return;
  if (visit(node, parent) === false) return;
  for (const key of Object.keys(node)) {
    const value = node[key];
    if (Array.isArray(value)) value.forEach(child => child && walk(child, visit, node));
    else if (value && typeof value.type === 'string') walk(value, visit, node);
  }
};
const isFunction = node => /Function/.test(node.type);
const isThis = (node, names) => node.type === 'MemberExpression' && !node.computed && node.object.type === 'ThisExpression' && (!names || names.has(node.property.name));
const mentions = (node, names, skipFunctions) => {
  let found = false;
  walk(node, child => {
    if (found) return false;
    if (skipFunctions && child !== node && isFunction(child)) return false;
    if (isThis(child, names)) { found = true; return false; }
    return true;
  });
  return found;
};

function buildModule(key, palette) {
  const cfg = MODULES[key];
  let source = SOURCE;
  for (const [from, to] of cfg.patches || []) {
    if (source.split(from).length !== 2) { fail(`${key}: patch no longer matches exactly once: ${from}`); continue; }
    source = source.replace(from, () => to);
  }
  const ast = acorn.parse(source, { ecmaVersion: 'latest' });
  const top = ast.body[0].expression.callee.body.body;
  const text = node => source.slice(node.start, node.end);
  const cut = new Set(cfg.cut || []);
  const blocks = palette[key].filter(b => b !== '---' && b.blockType !== 'label');
  const opcodes = new Set(blocks.map(b => b.opcode).filter(Boolean));
  const forwards = cfg.core ? new Set() : new Set(Object.keys(FORWARD));
  const shared = cfg.core ? new Set() : new Set(Object.keys(SHARED));
  const keepWrappers = new Set(cfg.keepWrappers || []);
  const removed = [];

  // ---- what to leave out inside code we keep ----
  const editsFor = root => {
    const edits = [];
    const drop = node => { edits.push([node.start, node.end, '']); removed.push(text(node).split('\n')[0].trim().slice(0, 110)); return true; };
    const stmt = node => {
      if (!node) return false;
      switch (node.type) {
        case 'BlockStatement': {
          const gone = node.body.map(stmt);
          return node.body.length > 0 && gone.every(Boolean);
        }
        case 'IfStatement': {
          if (mentions(node.test, cut)) return drop(node);
          const a = stmt(node.consequent), b = stmt(node.alternate);
          if (a && (!node.alternate || b)) { edits.splice(0, edits.length, ...edits.filter(e => e[0] < node.start || e[1] > node.end)); return drop(node); }
          return false;
        }
        case 'ForStatement': case 'ForOfStatement': case 'ForInStatement': case 'WhileStatement': case 'DoWhileStatement': {
          const head = [node.init, node.test, node.update, node.left, node.right].filter(Boolean);
          if (head.some(part => mentions(part, cut))) return drop(node);
          return stmt(node.body);
        }
        case 'TryStatement': {
          stmt(node.block); if (node.handler) stmt(node.handler.body); stmt(node.finalizer);
          return false;
        }
        case 'SwitchStatement': {
          let group = [];
          const inHandler = text(node.discriminant) === 'msg.type';
          for (const c of node.cases) {
            group.push(c);
            if (!c.consequent.length && c !== node.cases[node.cases.length - 1]) continue;
            const labels = group.map(g => g.test && g.test.value).filter(v => typeof v === 'string');
            if (inHandler) {
              for (const label of labels) if (!WS_CASES[label]) fail(`socket message type ${label} has no home in WS_CASES`);
              if (!labels.some(label => (WS_CASES[label] || []).includes(key))) {
                edits.push([group[0].start, group[group.length - 1].end, '']);
                group = [];
                continue;
              }
            }
            c.consequent.forEach(stmt);
            group = [];
          }
          return false;
        }
        case 'LabeledStatement': return stmt(node.body);
        case 'ExpressionStatement': case 'VariableDeclaration': case 'ReturnStatement': case 'ThrowStatement': {
          if (mentions(node, cut, true)) return drop(node);
          walk(node, child => {
            if (child !== node && isFunction(child)) { if (child.body.type === 'BlockStatement') stmt(child.body); else if (mentions(child.body, cut, true)) fail(`${key}: cut name inside an arrow expression: ${text(child).slice(0, 80)}`); return false; }
            return true;
          });
          return false;
        }
        default: return false;
      }
    };
    if (root.type === 'BlockStatement') stmt(root);
    else if (isFunction(root) && root.body.type === 'BlockStatement') stmt(root.body);
    else {
      walk(root, child => {
        if (child !== root && isFunction(child) && child.body.type === 'BlockStatement') { stmt(child.body); return false; }
        return true;
      });
    }
    return edits;
  };

  // ---- pull apart the file into things that can be kept or left out ----
  const items = [];
  const layers = {};
  const layer = name => { layers[name] = (layers[name] ?? -1) + 1; return layers[name]; };
  const protoName = node => {
    if (node?.type !== 'MemberExpression' || node.computed) return null;
    const o = node.object;
    if (o.type === 'Identifier' && (o.name === 'p19' || o.name === 'proto')) return node.property.name;
    if (o.type === 'MemberExpression' && o.object.name === 'VeloraExtension' && o.property.name === 'prototype') return node.property.name;
    return null;
  };
  const add = (kind, node, extra = {}) => { const item = { kind, node, start: node.start, end: node.end, ...extra }; items.push(item); return item; };
  const leading = start => {
    let at = start;
    for (;;) {
      const lineStart = source.lastIndexOf('\n', at - 2) + 1;
      if (lineStart <= 0 || !/^\s*\/\//.test(source.slice(lineStart, at - 1))) return at;
      at = lineStart;
    }
  };
  const lineStartOf = at => {
    const lineStart = source.lastIndexOf('\n', at - 1) + 1;
    return /^\s*$/.test(source.slice(lineStart, at)) ? lineStart : at;
  };

  for (const s of top) {
    if (s.type === 'ExpressionStatement' && s.directive) continue;
    if (s.type === 'ClassDeclaration') {
      for (const member of s.body.body) {
        if (member.kind === 'constructor') {
          for (const st of member.value.body.body) {
            const field = st.type === 'ExpressionStatement' && st.expression.type === 'AssignmentExpression' && isThis(st.expression.left) ? st.expression.left.property.name : null;
            add('ctor', st, { field });
          }
        } else {
          const name = member.key.name;
          if (name === 'getInfo') continue;
          add('classMethod', member, { name, layer: layer(name) });
        }
      }
      continue;
    }
    if (s.type === 'VariableDeclaration') {
      const d = s.declarations[0];
      const saved = protoName(d.init);
      if (s.declarations.length === 1 && saved) { if (saved !== 'getInfo') add('save', s, { name: saved, var: d.id.name, sees: layers[saved] ?? -1 }); continue; }
      if (d.id.name === 'veloraExt') { add('always', s); continue; }
      if (d.id.name === 'VELORA_ROUTES') { add('routes', s, { vars: ['VELORA_ROUTES'] }); continue; }
      add('var', s, { vars: s.declarations.map(x => x.id.name).filter(Boolean) });
      continue;
    }
    if (s.type === 'ExpressionStatement') {
      const e = s.expression;
      if (e.type === 'CallExpression' && e.callee.type === 'MemberExpression' && e.callee.object.name === 'Object' && e.callee.property.name === 'assign') {
        const group = { head: source.slice(s.start, e.arguments[1].start + 1), tail: '});' };
        for (const prop of e.arguments[1].properties) {
          add('member', prop, { name: prop.key.name, layer: layer(prop.key.name), group });
        }
        continue;
      }
      if (e.type === 'AssignmentExpression') {
        const name = protoName(e.left);
        if (name === 'getInfo') continue;
        if (name) { add('assign', s, { name, layer: layer(name) }); continue; }
      }
      if (text(s).startsWith('Scratch.extensions.register')) { add('always', s); continue; }
      fail(`unknown top level statement: ${text(s).slice(0, 80)}`);
      continue;
    }
    const head = text(s).slice(0, 70);
    if (s.type === 'ForOfStatement' && head.startsWith('for (const spec of VELORA_ROUTES)')) { add('routeLoop', s); continue; }
    if (s.type === 'ForOfStatement' && /^for \(const block of veloraExt/.test(head)) { add('always', s); continue; }
    if (s.type === 'ForOfStatement' && /^for \(const (spec of nativeSpecs|entry of instanceBlocks|opcode of \['bfPlaySound')/.test(head)) { add('chatOnly', s); continue; }
    if (s.type === 'BlockStatement') { add('chatOnly', s); continue; }
    if (s.type === 'IfStatement' && text(s.test).endsWith('.callUser')) { add('gated', s, { name: 'callUser' }); continue; }
    if (s.type === 'IfStatement' && text(s.test).endsWith('.getProfileNote')) continue; // those blocks are gone, nothing registers them
    fail(`unknown top level statement: ${head}`);
  }

  // a later definition replaces an earlier one unless something saved the earlier one first (the file wraps methods a lot)
  {
    const last = new Map();
    for (const item of items) {
      if (item.kind === 'save' || item.kind === 'gated') { if (last.has(item.name)) last.get(item.name).live = true; }
      if (item.kind === 'chatOnly' && cfg.chatLoops) for (const def of last.values()) def.live = true;
      if (['classMethod', 'member', 'assign'].includes(item.kind)) {
        const before = last.get(item.name);
        if (before && !before.live) before.dead = true;
        last.set(item.name, item);
      }
    }
  }

  // ---- reachability ----
  const reach = new Set([...opcodes, ...(cfg.roots || []), 'runtime']);
  if (Object.values(WS_CASES).some(owners => owners.includes(key))) reach.add('_handleWS');
  for (const b of blocks) if (b.func) reach.add(b.func);
  for (const h of Object.values(cfg.hooks || {})) for (const m of h.matchAll(/this\.([A-Za-z_$][\w$]*)/g)) reach.add(m[1]);
  if ((cfg.init || '').length) for (const m of cfg.init.matchAll(/this\.([A-Za-z_$][\w$]*)/g)) reach.add(m[1]);
  const keptVars = new Set();
  // lives in another add-on: the generated forwarders stand in for it here
  const peerOwned = new Set(Object.values(cfg.needsPeer || {}).flat());
  for (const p of Object.values(cfg.optionalPeer || {})) { p.methods.forEach(n => peerOwned.add(n)); p.accessors.forEach(n => peerOwned.add(n)); }
  const dropped = (name, layerNo) => {
    if ((cfg.dropLayers?.[name] || []).includes(layerNo)) return true;
    if (peerOwned.has(name)) return true;
    if (forwards.has(name)) return !keepWrappers.has(name) || layerNo === 0;
    return false;
  };
  const gateOn = item => {
    switch (item.kind) {
      case 'always': return true;
      case 'ctor':
        if (item.field) return reach.has(item.field) && !shared.has(item.field) && !cut.has(item.field) && !peerOwned.has(item.field) && (cfg.core || !/^_lastAction(Output|Success)$/.test(item.field));
        if (text(item.node).startsWith('runtime.on')) return !!cfg.keepCtorEvents;
        return true;
      case 'classMethod': case 'member': case 'assign': return reach.has(item.name) && !item.dead && !dropped(item.name, item.layer);
      case 'save': return reach.has(item.name) && keptVars.has(item.var);
      case 'gated': return reach.has(item.name);
      case 'var': return item.vars.some(v => keptVars.has(v));
      case 'routes': return keptVars.has('VELORA_ROUTES');
      case 'routeLoop': return true;
      case 'chatOnly': return !!cfg.chatLoops;
      default: return false;
    }
  };
  // a shared route table: only the routes this extension owns
  const routesEdits = item => {
    const edits = [];
    const list = item.node.declarations[0].init.elements;
    let any = false;
    for (let i = 0; i < list.length; i++) {
      const el = list[i];
      const op = el.properties.find(p => (p.key.value || p.key.name) === 'opcode').value.value;
      if (opcodes.has(op)) { any = true; continue; }
      edits.push([el.start, i + 1 < list.length ? list[i + 1].start : el.end, '']);
    }
    item.anyRoutes = any;
    return edits;
  };
  for (const item of items) {
    if (item.kind === 'routes') item.edits = routesEdits(item);
    else if (item.kind === 'member' || item.kind === 'classMethod') item.edits = editsFor(item.node.value);
    else if (item.kind === 'ctor') item.edits = [];
    else item.edits = editsFor(item.node);
    // the old block rewires a few methods, skip the ones that moved to another extension
    if (item.kind === 'chatOnly') {
      walk(item.node, child => {
        if (child.type === 'ExpressionStatement' && child.expression.type === 'CallExpression' && child.expression.callee.name === 'reroute' && !opcodes.has(child.expression.arguments[0].value)) { item.edits.push([child.start, child.end, '']); return false; }
        return true;
      });
    }
  }
  const routesOwned = items.find(i => i.kind === 'routes').anyRoutes;
  for (const item of items) if (item.kind === 'routeLoop' && !routesOwned) item.kind = 'off';
  const inEdit = (item, node) => item.edits.some(([a, b]) => node.start >= a && node.end <= b);
  const collect = item => {
    walk(item.node, (child, parent) => {
      if (inEdit(item, child)) return false;
      if (child.type === 'MemberExpression' && !child.computed) {
        if (child.object.type === 'ThisExpression') reach.add(child.property.name);
        else if (protoName(child)) reach.add(child.property.name);
      }
      if (child.type === 'Identifier') {
        const isProp = parent && ((parent.type === 'MemberExpression' && parent.property === child && !parent.computed) || (parent.type === 'Property' && parent.key === child && !parent.computed && !parent.shorthand) || (parent.type === 'MethodDefinition' && parent.key === child));
        if (!isProp) keptVars.add(child.name);
      }
      if (child.type === 'CallExpression' && child.callee.name === 'reroute' && child.arguments[0]?.value) reach.add(child.arguments[0].value);
      return true;
    });
  };
  for (const h of [...Object.values(cfg.hooks || {}), cfg.init || '']) for (const m of h.matchAll(/\b(SCOPES|SERVER_HTTP|SERVER_WS|EXT_ID)\b/g)) keptVars.add(m[1]);
  keptVars.add('EXT_ID');
  const on = new Set();
  for (let changed = true; changed;) {
    changed = false;
    for (const item of items) {
      if (on.has(item) || !gateOn(item)) continue;
      on.add(item); changed = true;
      if (item.kind !== 'routes') collect(item);
      else for (const el of item.node.declarations[0].init.elements) if (!inEdit(item, el)) collect({ node: el, edits: [] });
    }
  }

  // ---- guard rails ----
  const defined = new Set([...on].map(i => i.name || i.field).filter(Boolean));
  const peerNames = new Set();
  for (const names of Object.values(cfg.needsPeer || {})) names.forEach(n => peerNames.add(n));
  for (const p of Object.values(cfg.optionalPeer || {})) { p.methods.forEach(n => peerNames.add(n)); p.accessors.forEach(n => peerNames.add(n)); }
  const allMethods = new Set(items.filter(i => i.name).map(i => i.name));
  for (const item of on) {
    if (item.kind === 'routes') continue;
    walk(item.node, (child, parent) => {
      if (inEdit(item, child)) return false;
      if (isThis(child, cut)) fail(`${key}: cut name ${child.property.name} still used in: ${text(child.object === child ? child : parent).slice(0, 90)}`);
      if (isThis(child) && parent?.type === 'CallExpression' && parent.callee === child) {
        const m = child.property.name;
        if (!defined.has(m) && !forwards.has(m) && !peerNames.has(m) && !['_coreApi', '_core', '_emit'].includes(m) && allMethods.has(m)) fail(`${key}: calls ${m} but it isnt kept`);
      }
      if (child.type === 'AssignmentExpression' && isThis(child.left) && shared.has(child.left.property.name)) fail(`${key}: assigns shared field ${child.left.property.name}: ${text(child).slice(0, 80)}`);
      return true;
    });
  }

  // ---- write it out ----
  const render = (item, from = item.start, to = item.end) => {
    const edits = item.edits.slice().sort((a, b) => b[0] - a[0]);
    let out = source.slice(from, to);
    let lastStart = Infinity;
    for (const [a, b, value] of edits) {
      if (a < from || b > to || a >= lastStart) continue;
      let start = a, end = b;
      const lineStart = source.lastIndexOf('\n', a - 1) + 1;
      if (/^\s*$/.test(source.slice(lineStart, a)) && lineStart >= from) { const nl = source.indexOf('\n', b); if (nl >= 0 && nl < to && /^\s*$/.test(source.slice(b, nl))) { start = lineStart; end = nl + 1; } }
      if (end > lastStart) end = lastStart;
      lastStart = start;
      out = out.slice(0, start - from) + value + out.slice(end - from);
    }
    return out;
  };

  const pieces = [];
  let openGroup = null;
  const closeGroup = () => { if (openGroup) { pieces.push('  ' + openGroup.tail); openGroup = null; } };
  const classMethods = [], ctorLines = [];
  for (const item of items) {
    if (!on.has(item)) continue;
    if (item.kind === 'classMethod') { classMethods.push(render(item, lineStartOf(leading(lineStartOf(item.start))))); continue; }
    if (item.kind === 'ctor') { ctorLines.push(render(item, lineStartOf(item.start))); continue; }
    if (item.kind === 'member') {
      if (openGroup !== item.group) { closeGroup(); pieces.push('  ' + item.group.head); openGroup = item.group; }
      pieces.push(render(item, lineStartOf(leading(lineStartOf(item.start)))) + ',');
      continue;
    }
    closeGroup();
    if (item.kind === 'always') continue;
    pieces.push(render(item, lineStartOf(leading(lineStartOf(item.start)))));
  }
  closeGroup();
  const tail = items.filter(i => i.kind === 'always').map(i => render(i, lineStartOf(i.start))).join('\n\n');

  return assemble(key, cfg, palette[key], { pieces, classMethods, ctorLines, tail, opcodes, removed, reachCount: on.size });
}

// ---- generated glue ----
const blockType = v => 'Scratch.BlockType.' + Object.keys(BLOCK_TYPES).find(k => BLOCK_TYPES[k] === v);
const argType = v => 'Scratch.ArgumentType.' + Object.keys(ARG_TYPES).find(k => ARG_TYPES[k] === v);
const quote = v => "'" + String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n') + "'";
const lit = v => {
  if (typeof v === 'string') return quote(v);
  if (Array.isArray(v)) return '[' + v.map(lit).join(', ') + ']';
  if (v && typeof v === 'object') return '{ ' + Object.entries(v).map(([k, x]) => (/^[A-Za-z_$][\w$]*$/.test(k) ? k : quote(k)) + ': ' + lit(x)).join(', ') + ' }';
  return String(v);
};
const blockLit = block => {
  if (block === '---') return "'---'";
  const parts = [];
  for (const [k, v] of Object.entries(block)) {
    if (k === 'blockType') parts.push('blockType: ' + blockType(v));
    else if (k === 'arguments') {
      const args = Object.entries(v).map(([name, a]) => name + ': { ' + Object.entries(a).map(([ak, av]) => ak + ': ' + (ak === 'type' ? argType(av) : lit(av))).join(', ') + ' }');
      if (args.length) parts.push('arguments: { ' + args.join(', ') + ' }');
    } else parts.push(k + ': ' + lit(v));
  }
  return '{ ' + parts.join(', ') + ' }';
};

const plainMenu = (name, menu) => {
  if (!MENUS[name]) return menu;
  for (const value of Object.keys(MENUS[name])) if (!menu.items.some(item => (item.value ?? item) === value)) fail(`plain-words: menu ${name} has no value ${value}`);
  return { ...menu, items: menu.items.map(item => (MENUS[name][item] ? { text: MENUS[name][item], value: item } : item)) };
};

function assemble(key, cfg, list, parts) {
  const info = PALETTE;
  const menus = {};
  for (const b of list) if (b.arguments) for (const a of Object.values(b.arguments)) if (a.menu) { if (!info.menus[a.menu]) fail(`${key}: missing menu ${a.menu}`); menus[a.menu] = plainMenu(a.menu, info.menus[a.menu]); }
  const words = Object.keys(menus).filter(name => MENUS[name]);
  const wordsCode = !words.length ? '' : `  // the menus show plain words but keep their old values, a dropped reporter can say either
  const MENU_WORDS = ${lit(Object.fromEntries(words.map(name => [name, Object.fromEntries(Object.entries(MENUS[name]).map(([value, text]) => [text, value]))])))};
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

`;

  const coreUrl = `${HOSTED}/${MODULES.login.file}`;
  const needsHandler = Object.values(WS_CASES).some(owners => owners.includes(key));
  const hooks = cfg.hooks || {};
  const linkLines = [];
  if (needsHandler) linkLines.push("api.on('message', msg => this._handleWS(msg));");
  if (cfg.binary) linkLines.push("api.on('binary', data => this._vIncoming(data));");
  for (const name of Object.keys(hooks)) linkLines.push(`api.on('${name}', () => this._on${name[0].toUpperCase() + name.slice(1)}());`);
  if (hooks.connect) linkLines.push('if (api.isSocketReady()) this._onConnect();');
  if (hooks.login) linkLines.push('if (api.isAuthenticated()) this._onLogin();');

  let glue;
  if (cfg.core) {
    glue = `
    // ── what the add-ons use. they reach it with runtime.ext_${CORE_ID}.api, nothing goes on window ──
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
`;
  } else {
    const gettersText = Object.entries(SHARED).map(([field, [method, fallback]]) => `    get ${field}() { const api = this._coreApi(); return api ? api.${method}() : ${fallback}; }`).join('\n');
    const forwardText = Object.entries(FORWARD).filter(([name]) => name !== '_wsSend' && name !== '_bfEnsureSocket' || !(cfg.keepWrappers || []).includes(name)).map(([name, method]) => `    ${name}(...args) { return this._core().${method}(...args); }`).join('\n');
    const baseWrap = (cfg.keepWrappers || []).map(name => `    ${name}(...args) { return this._core().${FORWARD[name]}(...args); }`).join('\n');
    const peers = [];
    for (const [peer, names] of Object.entries(cfg.needsPeer || {})) {
      const id = MODULES[peer].id, label = MODULES[peer].name;
      for (const n of names) peers.push(`    ${n}(...args) { const peer = this.runtime.ext_${id}; if (!peer) throw new Error('This block needs the ${label} extension too.'); return peer.${n}(...args); }`);
    }
    for (const [peer, p] of Object.entries(cfg.optionalPeer || {})) {
      const id = MODULES[peer].id;
      for (const n of p.methods) peers.push(`    ${n}(...args) { return this.runtime.ext_${id}?.${n}(...args); }`);
      for (const n of p.accessors) peers.push(`    get ${n}() { return this.runtime.ext_${id}?.${n}; }\n    set ${n}(value) { const peer = this.runtime.ext_${id}; if (peer) peer.${n} = value; }`);
    }
    const hookText = Object.entries(hooks).map(([name, body]) => `    _on${name[0].toUpperCase() + name.slice(1)}() {\n        ${body}\n    }`).join('\n');
    glue = `
    // ── the link to Nookara Login. the core may load after this, projects load their extensions all at once ──
    _coreApi() {
      const api = this.runtime.${'ext_' + CORE_ID}?.api;
      return api && api.version === API_VERSION ? api : null;
    }

    _core() {
      const api = this._coreApi();
      if (api) return api;
      if (this.runtime.${'ext_' + CORE_ID}) throw new Error('Update the Nookara Login extension, this one needs a newer version.');
      throw new Error("This block needs the Nookara Login extension. Use the 'Add Nookara Login' button in this extension's blocks.");
    }

    _linkCore() {
      const api = this._coreApi();
      if (!api || this._linked === api) return;
      this._linked = api;
      ${linkLines.join('\n      ')}
      // the button goes away. not on first load though, nothing is registered yet
      const manager = Scratch.vm.extensionManager;
      if (manager.isExtensionLoaded(EXT_ID)) manager.refreshBlocks?.(EXT_ID);
    }

    _addCore() {
      return Scratch.vm.extensionManager.loadExtensionURL(CORE_URL);
    }

${gettersText}
    get _lastActionOutput() { return this._coreApi()?.getLastAction().output ?? ''; }
    set _lastActionOutput(value) { const api = this._coreApi(); if (api) api.setLastAction(value, api.getLastAction().success); }
    get _lastActionSuccess() { return this._coreApi()?.getLastAction().success ?? false; }
    set _lastActionSuccess(value) { const api = this._coreApi(); if (api) api.setLastAction(api.getLastAction().output, value); }
${forwardText}
${baseWrap}
${peers.join('\n')}
${hookText}
`;
  }

  const ctorTail = cfg.core
    ? `      this._listeners = new Map();\n      this.api = this._makeApi();\n      runtime.ext_${CORE_ID} = this;\n`
    : `      runtime.ext_${cfg.id} = this;\n      this._linked = null;\n      runtime.on('EXTENSION_ADDED', () => this._linkCore());\n      this._linkCore();\n${cfg.init ? '      ' + cfg.init + '\n' : ''}`;

  const paletteText = list.map(b => '          ' + blockLit(b) + ',').join('\n');
  const menusText = Object.entries(menus).map(([k, v]) => `          ${k}: ${lit(v)},`).join('\n');
  const addButton = cfg.core ? '' : `      if (!this._coreApi()) blocks.unshift({ func: '_addCore', blockType: Scratch.BlockType.BUTTON, text: 'Add Nookara Login' });\n`;
  const getInfo = `
    getInfo() {
      const blocks = [
${paletteText}
      ];
${addButton}      return {
        id: EXT_ID,
        name: ${quote(cfg.name)},
        color1: ${quote(info.color1)},
        color2: ${quote(info.color2)},
        color3: ${quote(info.color3)},
        docsURI: 'https://nookara.cc/guides/nookara-extensions',
        blocks,
        menus: {
${menusText}
        },
      };
    }
`;

  const body = parts.pieces.join('\n')
    .replace(/const EXT_ID\s*= 'velora';/, `const EXT_ID = ${quote(cfg.id)};`);
  const head = `// Name: ${cfg.name}
// ID: ${cfg.id}
// Description: ${cfg.description}
// By: Ikelene
// License: MIT

// made by extensions/split/build.js from velora_extension.js, edit that one and rebuild
(function (Scratch) {
  'use strict';

  if (!Scratch.extensions.unsandboxed) throw new Error('${cfg.name} must run unsandboxed: it shares its sign-in with the other Nookara extensions.');

  const API_VERSION = 1;
${cfg.core ? '' : `  const CORE_URL = '${coreUrl}';\n`}`;
  const split = body.indexOf('const EXT_ID');
  const before = body.slice(0, body.indexOf('\n', split) + 1);
  const after = body.slice(body.indexOf('\n', split) + 1);
  const guard = cfg.core ? '' : `  // no core yet: every block says so, instead of a confusing 'not logged in'
  for (const block of veloraExt.getInfo().blocks) {
    if (!block?.opcode || block.blockType === Scratch.BlockType.HAT || block.blockType === Scratch.BlockType.EVENT) continue;
    const fn = veloraExt[block.opcode];
    veloraExt[block.opcode] = function (...args) { this._core(); return fn.apply(this, args); };
  }

`;
  const klass = `
  class NookaraExtension {
    constructor(runtime) {
${parts.ctorLines.join('\n')}
${ctorTail}    }
${getInfo}${glue}
${parts.classMethods.join('\n')}
  }
`;
  const tail = parts.tail.replace('const veloraExt = new VeloraExtension(Scratch.vm.runtime);\n', m => m + '\n' + wordsCode + guard);
  const out = head + before + klass + '\n' + after + '\n\n' + tail + '\n})(Scratch);\n';
  const final = out.replace(/\bVeloraExtension\b/g, 'NookaraExtension');
  return { key, cfg, code: final, opcodes: parts.opcodes, removed: parts.removed };
}

const PALETTE = readPalette();
const split = splitPalette(PALETTE);
const results = Object.keys(MODULES).map(key => buildModule(key, split));

// every block in exactly one place
const seen = new Map();
for (const r of results) for (const op of r.opcodes) { if (seen.has(op)) fail(`${op} is in both ${seen.get(op)} and ${r.key}`); seen.set(op, r.key); }
const total = PALETTE.blocks.filter(b => b.opcode).length;
if (seen.size !== total) fail(`placed ${seen.size} of ${total} blocks`);
for (const opcode of Object.keys(TEXT)) if (!seen.has(opcode)) fail(`plain-words: no block called ${opcode}`);
for (const [key, list] of Object.entries(split)) {
  const read = new Map();
  for (const block of list) {
    if (!block.opcode || block.hideFromPalette) continue;
    const words = block.text.replace(/\[[A-Z_0-9]+\]/g, '[]');
    if (read.has(words)) console.log(`note: ${key}: ${read.get(words)} and ${block.opcode} read the same: ${block.text}`);
    read.set(words, block.opcode);
  }
}

if (errors.length) {
  console.error([...new Set(errors)].join('\n'));
  console.error(`\n${new Set(errors).size} problem(s), nothing written`);
  process.exit(1);
}

fs.mkdirSync(OUT, { recursive: true });
const report = [];
for (const r of results) {
  fs.writeFileSync(path.join(OUT, r.cfg.file), r.code);
  report.push(`${r.cfg.file}: ${r.opcodes.size} blocks, ${r.code.split('\n').length} lines, ${Math.round(r.code.length / 1024)} KB`);
  if (process.argv.includes('--verbose')) report.push(...r.removed.map(line => '  - ' + line));
}
fs.copyFileSync(path.join(__dirname, 'forums.js'), path.join(OUT, 'nookara-forums.js'));
report.push('nookara-forums.js: written by hand, read only, not part of the split');
const map = JSON.stringify({ core: CORE_ID, modules: Object.fromEntries(results.map(r => [r.key, { id: r.cfg.id, file: r.cfg.file, url: `${HOSTED}/${r.cfg.file}` }])), blocks: Object.fromEntries([...seen].sort()) }) + '\n';
fs.writeFileSync(path.join(ROOT, 'public', 'assets', 'extensions', 'block-map.json'), map);
console.log(report.join('\n'));
console.log(`all ${total} blocks placed`);
