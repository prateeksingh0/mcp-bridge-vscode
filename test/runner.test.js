'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const termutil = require('../termutil');
const { makeSh, parseResult } = require('../runner');

test('parseResult reads the exit code and output', () => {
  assert.deepEqual(parseResult('exit code: 0\nhello'), { code: 0, missing: false, stdout: 'hello', stderr: '' });
  assert.equal(parseResult('exit code: 1\nfatal: bad').code, 1);
  assert.equal(parseResult('exit code: 1\nfatal: bad').missing, false);
  assert.equal(parseResult('exit code: unknown\nfoo').code, 0);
});

test('parseResult detects a missing program', () => {
  assert.equal(parseResult("exit code: 1\nThe term 'gh' is not recognized as the name of a cmdlet").missing, true);
  assert.equal(parseResult('exit code: 127\nbash: gh: command not found').missing, true);
});

test('parseResult handles long-running and uncaptured commands', () => {
  assert.equal(parseResult('Still running after 60s (use terminal_read). Output so far:\nx').code, 124);
  assert.throws(() => parseResult('WARNING: output NOT captured. Shell integration did not start.'), /NOT captured/);
});

function fakeSh(shellPath, reply = 'exit code: 0\nok') {
  const calls = [];
  const sh = makeSh({
    vscode: { env: { shell: shellPath } },
    termRun: async (command, opts) => { calls.push({ command, opts }); return reply; },
    termutil,
    path,
  });
  return { sh, calls };
}

test('makeSh types a readable command into a terminal titled after it', async () => {
  const { sh, calls } = fakeSh('C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  const r = await sh('git', ['--no-pager', 'status', '--short'], 'C:\\proj', 60000);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'git --no-pager status --short');
  assert.equal(calls[0].opts.name, 'tools');
  assert.equal(calls[0].opts.label, 'git status --short');
  assert.equal(calls[0].opts.timeout, 60);
  assert.equal(calls[0].opts.cwd, 'C:\\proj');
  assert.deepEqual(r, { code: 0, missing: false, stdout: 'ok', stderr: '' });
});

test('makeSh turns the pager off for gh', async () => {
  const { sh, calls } = fakeSh('C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  await sh('gh', ['pr', 'list'], 'C:\\proj');
  assert.equal(calls[0].command, "$env:GH_PAGER='cat'; gh pr list");
  assert.equal(calls[0].opts.label, 'gh pr list');
});

test('makeSh quotes awkward arguments for the shell in use', async () => {
  const { sh, calls } = fakeSh('/bin/bash');
  await sh('git', ['commit', '-m', "it's done"], '/proj');
  assert.equal(calls[0].command, "git commit -m 'it'\\''s done'");
});
