'use strict';
// writes a small project that uses the core and every add-on, so you can open it in TurboWarp or PenguinMod and click the flag.
// run: node make-sample.js [output.sb3] [url base, defaults to where they get published]
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const JSZip = require('jszip');
const { MODULES, HOSTED } = require('./manifest');

const out = process.argv[2] || path.join(__dirname, '..', 'sample', 'nookara-split-sample.sb3');
const base = process.argv[3] || HOSTED;
const ids = { ...Object.fromEntries(Object.entries(MODULES).map(([k, m]) => [k, m.id])), forums: 'ikelenenookaraforums' };

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"/>';
const svgName = crypto.createHash('md5').update(SVG).digest('hex');

// each one sets a variable from a reporter, so the result is easy to read back
const checks = [
  ['login', 'serverOnline'],
  ['login', 'extensionVersion'],
  ['payments', 'getOutgoingSubs'],
  ['data', 'getStorageId'],
  ['social', 'connectedUsers'],
  ['profiles', 'hyperfocusDownload'],
  ['voice', 'inVoice'],
  ['chat', 'biConnectedList'],
  ['chat', 'bfPermissionBit', { input: 'PERMISSION', menu: 'bfPermissions', value: 'ADMIN' }],
  ['forums', 'categories'],
];

const blocks = {}, variables = {};
let n = 0;
const id = () => 'b' + (++n);
for (const [key, opcode, menu] of checks) {
  const hat = id(), set = id(), rep = id();
  const varId = `v_${key}_${opcode}`;
  variables[varId] = [`${key}: ${opcode}`, ''];
  blocks[hat] = { opcode: 'event_whenflagclicked', next: set, parent: null, inputs: {}, fields: {}, shadow: false, topLevel: true, x: 0, y: n * 20 };
  blocks[set] = { opcode: 'data_setvariableto', next: null, parent: hat, inputs: { VALUE: [3, rep, [10, '']] }, fields: { VARIABLE: [variables[varId][0], varId] }, shadow: false, topLevel: false };
  blocks[rep] = { opcode: `${ids[key]}_${opcode}`, next: null, parent: set, inputs: {}, fields: {}, shadow: false, topLevel: false };
  if (menu) {
    const shadow = id();
    blocks[rep].inputs[menu.input] = [1, shadow];
    blocks[shadow] = { opcode: `${ids[key]}_menu_${menu.menu}`, next: null, parent: rep, inputs: {}, fields: { [menu.menu]: [menu.value, null] }, shadow: true, topLevel: false };
  }
}

const used = Object.keys(ids);
const file = key => (MODULES[key] ? MODULES[key].file : 'nookara-forums.js');
const project = {
  targets: [{ isStage: true, name: 'Stage', variables, lists: {}, broadcasts: {}, blocks, comments: {}, currentCostume: 0,
    costumes: [{ name: 'blank', dataFormat: 'svg', assetId: svgName, md5ext: `${svgName}.svg`, rotationCenterX: 1, rotationCenterY: 1 }],
    sounds: [], volume: 100, layerOrder: 0, tempo: 60, videoTransparency: 50, videoState: 'off', textToSpeechLanguage: null }],
  monitors: [],
  extensions: used.map(key => ids[key]),
  extensionURLs: Object.fromEntries(used.map(key => [ids[key], `${base}/${file(key)}`])),
  meta: { semver: '3.0.0', vm: '0.2.0', agent: 'nookara split sample' },
};

(async () => {
  const zip = new JSZip();
  zip.file('project.json', JSON.stringify(project));
  zip.file(`${svgName}.svg`, SVG);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
  console.log('wrote', out);
})();
