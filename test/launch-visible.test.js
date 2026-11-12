'use strict';
// Guards for the "VS Code is closed" scenario: the shim must start VS Code visibly, with display settings on Linux,
// and the extension must supply what the shim needs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('the shim never hides the VS Code window it starts', () => {
  const shim = read('shim.js');
  assert.ok(shim.includes('windowsHide: !viaElectron'), 'windowsHide must only apply to the helper command');
  assert.ok(!shim.includes('windowsHide: true'), 'windowsHide: true would hide the VS Code window on Windows');
});

test('the shim passes display settings to VS Code on Linux and waits long enough', () => {
  const shim = read('shim.js');
  assert.ok(shim.includes("require('./launchenv')"));
  assert.ok(shim.includes('display-env.json'));
  assert.ok(shim.includes('/proc/'));
  assert.ok(shim.includes('i < 180'), 'the shim should wait about 90 seconds for VS Code to start');
});

test('the extension saves the display settings and installs launchenv.js beside the shim', () => {
  const ext = read('extension.js');
  assert.ok(ext.includes('display-env.json'));
  assert.ok(ext.includes("'launchenv.js'"));
});
