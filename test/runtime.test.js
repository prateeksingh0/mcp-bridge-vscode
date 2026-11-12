'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeEntry, isStaleEntry, isOurEntry } = require('../claudeconfig');

const shim = 'C:\\Users\\me\\.mcp-bridge\\shim.js';

test('makeEntry runs the shim with the VS Code runtime by default', () => {
  const e = makeEntry({ runtime: 'vscode', execPath: 'C:\\Program Files\\VS Code\\Code.exe', shimPath: shim });
  assert.deepEqual(e, { command: 'C:\\Program Files\\VS Code\\Code.exe', args: [shim], env: { ELECTRON_RUN_AS_NODE: '1' } });
  assert.equal(isOurEntry(e), true);
});

test('makeEntry can use node from PATH instead', () => {
  const e = makeEntry({ runtime: 'node', execPath: 'C:\\VS Code\\Code.exe', shimPath: shim });
  assert.deepEqual(e, { command: 'node', args: [shim] });
  assert.equal(isOurEntry(e), true);
});

test('makeEntry falls back to node when the VS Code path is unknown', () => {
  assert.deepEqual(makeEntry({ runtime: 'vscode', execPath: '', shimPath: shim }), { command: 'node', args: [shim] });
});

test('isStaleEntry only flags a full path that no longer exists', () => {
  const missing = () => false;
  const present = () => true;
  assert.equal(isStaleEntry({ command: 'node', args: [shim] }, missing), false);
  assert.equal(isStaleEntry({ command: 'C:\\Old\\Code.exe', args: [shim] }, missing), true);
  assert.equal(isStaleEntry({ command: '/usr/share/code/code', args: [shim] }, missing), true);
  assert.equal(isStaleEntry({ command: 'C:\\VS Code\\Code.exe', args: [shim] }, present), false);
  assert.equal(isStaleEntry({}, missing), false);
  assert.equal(isStaleEntry(undefined, missing), false);
});
