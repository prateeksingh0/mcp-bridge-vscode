'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { NAME, isOurEntry, removeOurEntry } = require('../claudeconfig');

test('isOurEntry recognises our shim on Windows and Unix paths', () => {
  assert.equal(isOurEntry({ command: 'node', args: ['C:\\Users\\me\\.mcp-bridge\\shim.js'] }), true);
  assert.equal(isOurEntry({ command: 'node', args: ['/home/me/.mcp-bridge/shim.js'] }), true);
});

test('isOurEntry rejects other entries', () => {
  assert.equal(isOurEntry({ command: 'node', args: ['C:\\Users\\me\\.claude-vscode-bridge\\shim.js'] }), false);
  assert.equal(isOurEntry({ command: 'node', args: ['/opt/other/server.js'] }), false);
  assert.equal(isOurEntry({ command: 'npx', args: [] }), false);
  assert.equal(isOurEntry({}), false);
  assert.equal(isOurEntry(undefined), false);
});

test('removeOurEntry removes only our entry and keeps everything else', () => {
  const conf = {
    preferences: { theme: 'dark' },
    mcpServers: {
      [NAME]: { command: 'node', args: ['C:\\Users\\me\\.mcp-bridge\\shim.js'] },
      other: { command: 'npx', args: ['some-server'] },
    },
  };
  const { conf: out, removed } = removeOurEntry(conf);
  assert.equal(removed, true);
  assert.deepEqual(out.preferences, { theme: 'dark' });
  assert.deepEqual(Object.keys(out.mcpServers), ['other']);
  assert.ok(conf.mcpServers[NAME], 'input must not be mutated');
});

test('removeOurEntry leaves a same-named foreign entry alone', () => {
  const conf = { mcpServers: { [NAME]: { command: 'node', args: ['/somewhere/else.js'] } } };
  const { conf: out, removed } = removeOurEntry(conf);
  assert.equal(removed, false);
  assert.deepEqual(out, conf);
});

test('removeOurEntry handles configs without mcpServers', () => {
  assert.equal(removeOurEntry({}).removed, false);
  assert.equal(removeOurEntry({ mcpServers: {} }).removed, false);
  assert.equal(removeOurEntry(null).removed, false);
});
