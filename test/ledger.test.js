'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createLedger, firstMissing, normKey } = require('../ledger');

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-ledger-')); }
const rm = d => fs.rmSync(d, { recursive: true, force: true });

test('firstMissing returns the highest folder that does not exist yet', () => {
  const d = tmp();
  try {
    assert.equal(firstMissing(path.join(d, 'a', 'b', 'c.txt')), path.join(d, 'a'));
    assert.equal(firstMissing(path.join(d, 'new.txt')), path.join(d, 'new.txt'));
    assert.equal(firstMissing(d), null);
  } finally { rm(d); }
});

test('list shows tracked paths that still exist and forgets deleted ones', () => {
  const d = tmp();
  try {
    const ledger = createLedger(path.join(d, 'ledger.json'));
    const f = path.join(d, 'temp.txt');
    fs.writeFileSync(f, 'x');
    ledger.add(f, 'write_file');
    const items = ledger.list();
    assert.equal(items.length, 1);
    assert.equal(items[0].path, f);
    assert.equal(items[0].tool, 'write_file');
    fs.rmSync(f);
    assert.deepEqual(ledger.list(), []);
  } finally { rm(d); }
});

test('entries survive a restart', () => {
  const d = tmp();
  try {
    const file = path.join(d, 'ledger.json');
    const f = path.join(d, 'keep.txt');
    fs.writeFileSync(f, 'x');
    createLedger(file).add(f, 'create_dir');
    const again = createLedger(file);
    assert.equal(again.list().length, 1);
    again.remove(f);
    assert.equal(createLedger(file).list().length, 0);
  } finally { rm(d); }
});

test('renamePrefix follows a moved folder and the entries inside it', () => {
  const d = tmp();
  try {
    const ledger = createLedger(path.join(d, 'ledger.json'));
    const from = path.join(d, 'old');
    const to = path.join(d, 'renamed');
    fs.mkdirSync(path.join(from, 'sub'), { recursive: true });
    ledger.add(from, 'create_dir');
    ledger.add(path.join(from, 'sub'), 'create_dir');
    fs.renameSync(from, to);
    ledger.renamePrefix(from, to);
    assert.deepEqual(ledger.list().map(i => i.path), [to, path.join(to, 'sub')]);
  } finally { rm(d); }
});

test('entries older than a week are dropped', () => {
  const d = tmp();
  try {
    let t = 1000;
    const ledger = createLedger(path.join(d, 'ledger.json'), () => t);
    const f = path.join(d, 'old.txt');
    fs.writeFileSync(f, 'x');
    ledger.add(f, 'write_file');
    assert.equal(ledger.list().length, 1);
    t += 8 * 24 * 60 * 60 * 1000;
    assert.equal(ledger.list().length, 0);
  } finally { rm(d); }
});

test('untracked reports paths the bridge did not create', () => {
  const d = tmp();
  try {
    const ledger = createLedger(path.join(d, 'ledger.json'));
    const mine = path.join(d, 'mine.txt');
    const yours = path.join(d, 'yours.txt');
    fs.writeFileSync(mine, 'x');
    fs.writeFileSync(yours, 'x');
    ledger.add(mine, 'write_file');
    assert.deepEqual(ledger.untracked([mine, yours]), [yours]);
    assert.equal(normKey(mine), normKey(path.join(d, '.', 'mine.txt')));
  } finally { rm(d); }
});
