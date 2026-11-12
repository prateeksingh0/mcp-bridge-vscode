'use strict';
// Built-in text search. It reads files directly and starts no process, so nothing runs hidden.
const fs = require('fs');
const path = require('path');

const DEFAULT_IGNORE = new Set(['.git', 'node_modules', '.venv', 'venv', '__pycache__', '.next', 'target']);
const MAX_FILE = 1024 * 1024; // skip files larger than 1 MB
const MAX_FILES = 20000;

function globToRe(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === '*') {
      if (glob[i + 1] === '*') { re += '.*'; i++; if (glob[i + 1] === '/') i++; }
      else re += '[^/]*';
    } else if (ch === '?') {
      re += '[^/]';
    } else {
      re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp('^' + re + '$', 'i');
}

function isBinary(buf) {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

// Returns an array of "path:line: text" strings.
function searchText({ base, query, regex = false, ignoreCase = false, glob, max = 100, perFile = 20, ignore = DEFAULT_IGNORE }) {
  let re = null;
  if (regex) {
    try { re = new RegExp(query, ignoreCase ? 'i' : ''); } catch (e) { throw new Error('Invalid regex: ' + e.message); }
  }
  const needle = ignoreCase ? String(query).toLowerCase() : String(query);
  const globRe = glob ? globToRe(glob) : null;
  const out = [];
  let files = 0;

  const visit = p => {
    if (out.length >= max || files >= MAX_FILES) return;
    let st;
    try { st = fs.statSync(p); } catch { return; }
    if (st.isDirectory()) {
      let names;
      try { names = fs.readdirSync(p).sort(); } catch { return; }
      for (const n of names) {
        if (ignore.has(n)) continue;
        visit(path.join(p, n));
        if (out.length >= max) return;
      }
      return;
    }
    if (!st.isFile() || st.size > MAX_FILE) return;
    if (globRe) {
      const rel = path.relative(base, p).split(path.sep).join('/');
      if (!globRe.test(glob.includes('/') ? rel : path.basename(p))) return;
    }
    files++;
    let buf;
    try { buf = fs.readFileSync(p); } catch { return; }
    if (isBinary(buf)) return;
    const lines = buf.toString('utf8').split(/\r?\n/);
    let n = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const hit = re ? re.test(line) : (ignoreCase ? line.toLowerCase() : line).includes(needle);
      if (hit) {
        out.push(p + ':' + (i + 1) + ': ' + line.slice(0, 300));
        n++;
        if (n >= perFile || out.length >= max) break;
      }
    }
  };

  visit(base);
  return out;
}

module.exports = { searchText, globToRe };
