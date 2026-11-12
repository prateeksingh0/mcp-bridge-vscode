'use strict';
// Guard: on Windows a folder cannot be moved or deleted while a terminal sits inside it.
// Every tool that moves or deletes folders must first close the bridge's own terminals inside them.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'extension.js'), 'utf8');

test('delete_path, cleanup_session and move_path release terminals before they act', () => {
  const calls = (src.match(/await releaseTerminalsIn\(/g) || []).length;
  assert.ok(calls >= 3, 'expected at least 3 calls to releaseTerminalsIn, found ' + calls);
});

test('releaseTerminalsIn exists', () => {
  assert.ok(src.includes('async function releaseTerminalsIn('));
});
