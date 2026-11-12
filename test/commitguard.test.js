'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { protectedInStatus, isBroadStage } = require('../commitguard');

test('protectedInStatus finds protected files in git status output', () => {
  const status = [
    '?? .env',
    ' M src/main.js',
    'A  keys/server.pem',
    '?? .env.example',
    '?? "my notes.txt"',
    'R  old.txt -> config/id_rsa',
  ].join('\n');
  assert.deepEqual(protectedInStatus(status), ['.env', 'keys/server.pem', 'config/id_rsa']);
});

test('protectedInStatus ignores ordinary files and empty output', () => {
  assert.deepEqual(protectedInStatus(' M src/main.js\n?? README.md\n'), []);
  assert.deepEqual(protectedInStatus(''), []);
  assert.deepEqual(protectedInStatus(undefined), []);
});

test('protectedInStatus honours the user protectedPaths patterns', () => {
  assert.deepEqual(protectedInStatus('?? secrets/notes.txt\n?? docs/a.md', ['secrets']), ['secrets/notes.txt']);
});

test('protectedInStatus copes with Windows line endings and exit-code noise', () => {
  assert.deepEqual(protectedInStatus('exit code 1\r\n?? .env\r\n'), ['.env']);
});

test('isBroadStage recognises commands that stage many files', () => {
  assert.equal(isBroadStage(['add', '-A']), true);
  assert.equal(isBroadStage(['add', '.']), true);
  assert.equal(isBroadStage(['add', '--all']), true);
  assert.equal(isBroadStage(['add', '-u']), true);
  assert.equal(isBroadStage(['commit', '-am', 'msg']), true);
  assert.equal(isBroadStage(['commit', '-a', '-m', 'msg']), true);
  assert.equal(isBroadStage(['commit', '--all', '-m', 'msg']), true);
});

test('isBroadStage leaves specific, narrow commands alone', () => {
  assert.equal(isBroadStage(['add', 'src/main.js']), false);
  assert.equal(isBroadStage(['commit', '-m', 'msg']), false);
  assert.equal(isBroadStage(['commit', '--amend']), false);
  assert.equal(isBroadStage(['status']), false);
  assert.equal(isBroadStage(undefined), false);
});
