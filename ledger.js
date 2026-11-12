'use strict';
// Remembers files and folders the bridge created, so leftovers can be found and cleaned up.
// Pure Node (no vscode dependency), so it can be unit-tested.
const fs = require('fs');
const path = require('path');

const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // forget entries older than a week
const normKey = p => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p));

// The topmost path that does not exist yet: the file itself, or the highest missing folder above it.
// Returns null if the path already exists.
function firstMissing(p) {
  let cur = path.resolve(p);
  if (fs.existsSync(cur)) return null;
  for (;;) {
    const up = path.dirname(cur);
    if (up === cur || fs.existsSync(up)) return cur;
    cur = up;
  }
}

function createLedger(file, now = () => Date.now()) {
  let entries = null; // key -> { path, tool, t }

  const load = () => {
    if (entries) return;
    entries = new Map();
    try {
      for (const e of JSON.parse(fs.readFileSync(file, 'utf8'))) {
        if (e && e.path) entries.set(normKey(e.path), e);
      }
    } catch {}
  };
  const save = () => {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify([...entries.values()]));
    } catch {}
  };
  const current = () => {
    load();
    let changed = false;
    const out = [];
    for (const [k, e] of [...entries]) {
      if (!fs.existsSync(e.path) || now() - e.t > MAX_AGE_MS) { entries.delete(k); changed = true; continue; }
      out.push({ path: e.path, tool: e.tool, ageMinutes: Math.round((now() - e.t) / 60000) });
    }
    if (changed) save();
    return out.sort((a, b) => a.path.localeCompare(b.path));
  };

  return {
    add(p, tool) {
      if (!p) return;
      load();
      entries.set(normKey(p), { path: path.resolve(p), tool: tool || 'unknown', t: now() });
      save();
    },
    remove(p) {
      load();
      if (entries.delete(normKey(p))) save();
    },
    // After a move or rename: update the entry itself and anything recorded inside it.
    renamePrefix(from, to) {
      load();
      const f = normKey(from);
      const fromLen = path.resolve(from).length;
      let changed = false;
      for (const [k, e] of [...entries]) {
        if (k === f || k.startsWith(f + path.sep)) {
          entries.delete(k);
          const np = path.resolve(to) + path.resolve(e.path).slice(fromLen);
          entries.set(normKey(np), { ...e, path: np });
          changed = true;
        }
      }
      if (changed) save();
    },
    list: current,
    // Which of the given paths are NOT tracked as created by the bridge.
    untracked(paths) {
      const tracked = new Set(current().map(i => normKey(i.path)));
      return paths.filter(p => !tracked.has(normKey(p)));
    },
  };
}

module.exports = { createLedger, firstMissing, normKey };
