// moves a saved project from the old all in one Nookara extension onto the split ones.
// only touches project.json, works in the browser and in extensions/split/check.js
(function (root) {
  'use strict';

  const OLD_IDS = ['velora', 'ikelenevelorapm'];

  function migrateProject(project, map) {
    const used = new Set();
    const unknown = new Set();
    let changed = 0;

    const owner = base => map.blocks[base];
    const rename = (oldId, base, moduleKey) => {
      used.add(moduleKey);
      changed++;
      return `${map.modules[moduleKey].id}_${base}`;
    };
    const split = opcode => {
      for (const id of OLD_IDS) if (typeof opcode === 'string' && opcode.startsWith(id + '_')) return [id, opcode.slice(id.length + 1)];
      return null;
    };

    for (const target of project.targets || []) {
      const blocks = target.blocks || {};
      for (const block of Object.values(blocks)) {
        if (!block || Array.isArray(block)) continue;
        const parts = split(block.opcode);
        if (!parts || parts[1].startsWith('menu_')) continue;
        const key = owner(parts[1]);
        if (!key) { unknown.add(parts[1]); continue; }
        block.opcode = rename(parts[0], parts[1], key);
      }
      for (const block of Object.values(blocks)) {
        if (!block || Array.isArray(block)) continue;
        const parts = split(block.opcode);
        if (!parts) continue;
        const parent = block.parent && blocks[block.parent];
        const parentKey = parent && Object.keys(map.modules).find(key => typeof parent.opcode === 'string' && parent.opcode.startsWith(map.modules[key].id + '_'));
        if (!parentKey) { unknown.add(parts[1]); continue; }
        block.opcode = rename(parts[0], parts[1], parentKey);
      }
      if (target.extensionStorage) moveStorage(target.extensionStorage, map, used);
    }

    for (const monitor of project.monitors || []) {
      const parts = split(monitor.opcode);
      if (!parts) continue;
      const key = owner(parts[1]);
      if (!key) { unknown.add(parts[1]); continue; }
      const from = monitor.opcode;
      monitor.opcode = rename(parts[0], parts[1], key);
      if (typeof monitor.id === 'string') monitor.id = monitor.id.split(from).join(monitor.opcode);
    }
    if (project.extensionStorage) moveStorage(project.extensionStorage, map, used);

    if (unknown.size) return { ok: false, unknown: [...unknown].sort(), used: [], changed: 0 };
    if (!changed && !(project.extensions || []).some(id => OLD_IDS.includes(id))) return { ok: false, unknown: [], used: [], changed: 0, none: true };

    used.add('login');
    const ids = [...used].sort((a, b) => (a === 'login' ? -1 : b === 'login' ? 1 : a.localeCompare(b)));
    project.extensions = (project.extensions || []).filter(id => !OLD_IDS.includes(id));
    for (const key of ids) if (!project.extensions.includes(map.modules[key].id)) project.extensions.push(map.modules[key].id);
    if (project.extensionURLs) for (const id of OLD_IDS) delete project.extensionURLs[id];
    project.extensionURLs = project.extensionURLs || {};
    for (const key of ids) project.extensionURLs[map.modules[key].id] = map.modules[key].url;
    return { ok: true, unknown: [], used: ids, changed };
  }

  function moveStorage(storage, map, used) {
    for (const id of OLD_IDS) {
      if (!storage[id]) continue;
      storage[map.modules.chat.id] = storage[id];
      delete storage[id];
      used.add('chat');
    }
  }

  root.NookaraMigrate = { migrateProject };
  if (typeof module !== 'undefined') module.exports = root.NookaraMigrate;
})(typeof window !== 'undefined' ? window : globalThis);
