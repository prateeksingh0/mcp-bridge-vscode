'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { snapshot, newEntries } = require('../ledger');

test('snapshot and newEntries notice what a command created, and ignore .git', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-snap-'));
  try {
    fs.writeFileSync(path.join(d, 'existing.txt'), 'x');
    const before = snapshot(d);
    fs.writeFileSync(path.join(d, 'created.txt'), 'x');
    fs.mkdirSync(path.join(d, 'newdir'));
    fs.mkdirSync(path.join(d, '.git'));
    const created = newEntries(before, snapshot(d)).sort();
    assert.deepEqual(created, ['created.txt', 'newdir']);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('snapshot gives up on unreadable or huge folders', () => {
  assert.equal(snapshot(path.join(os.tmpdir(), 'bridge-does-not-exist-' + Date.now())), null);
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-snap-'));
  try {
    for (let i = 0; i < 5; i++) fs.writeFileSync(path.join(d, 'f' + i), 'x');
    assert.equal(snapshot(d, 3), null);
    assert.equal(snapshot(d, 10).size, 5);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('newEntries is empty when a snapshot is missing', () => {
  assert.deepEqual(newEntries(null, new Set(['a'])), []);
  assert.deepEqual(newEntries(new Set(['a']), null), []);
});
