'use strict';
// Stops "stage everything" from committing protected files (keys, .env files, credentials).
// Pure helpers, so they can be unit-tested.
const { isProtected } = require('./safety');

// Protected paths listed by `git status --porcelain`.
function protectedInStatus(text, extra) {
  const out = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    if (raw.length < 4) continue;
    let p = raw.slice(3).trim();
    const arrow = p.indexOf(' -> ');
    if (arrow >= 0) p = p.slice(arrow + 4); // a rename: look at the new name
    if (p.startsWith('"') && p.endsWith('"')) p = p.slice(1, -1);
    if (isProtected(p, extra)) out.push(p);
  }
  return out;
}

// True for git commands that stage or commit many files at once.
function isBroadStage(args) {
  const a = args || [];
  if (a[0] === 'add') return a.some(x => x === '-A' || x === '--all' || x === '.' || x === '-u' || x === '--update');
  if (a[0] === 'commit') return a.some(x => /^-[a-zA-Z]*a[a-zA-Z]*$/.test(x) || x === '--all');
  return false;
}

module.exports = { protectedInStatus, isBroadStage };
