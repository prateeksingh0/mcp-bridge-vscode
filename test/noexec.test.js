'use strict';
// Guard: the bridge must never run a command hidden. Every command goes through a visible terminal.
// If this test fails, someone added code that starts a process outside the terminal.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const forbidden = /child_process|\bexecFile(Sync)?\b|\bexecSync\b|\bspawn(Sync)?\b|\bfork\(/;

for (const file of ['extension.js', 'safety.js', 'claudeconfig.js', 'termutil.js', 'search.js', 'runner.js', 'ledger.js', 'rules.js', 'commitguard.js', 'launchenv.js']) {
  test(file + ' starts no hidden processes', () => {
    const src = fs.readFileSync(path.join(root, file), 'utf8');
    assert.ok(!forbidden.test(src), file + ' must not start processes outside a visible terminal');
  });
}

test('shim.js only starts VS Code itself, and nothing else', () => {
  const src = fs.readFileSync(path.join(root, 'shim.js'), 'utf8');
  assert.equal((src.match(/\bspawn\(/g) || []).length, 1);
  assert.ok(src.includes('spawn(launchCommand,'));
  assert.ok(!/\bexec(File)?(Sync)?\(/.test(src));
});
