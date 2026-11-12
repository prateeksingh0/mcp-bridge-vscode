'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const t = require('../termutil');

test('shellKind detects the common shells', () => {
  assert.equal(t.shellKind('C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'), 'powershell5');
  assert.equal(t.shellKind('C:\\Program Files\\PowerShell\\7\\pwsh.exe'), 'pwsh');
  assert.equal(t.shellKind('C:\\Windows\\system32\\cmd.exe'), 'cmd');
  assert.equal(t.shellKind('/bin/bash'), 'posix');
  assert.equal(t.shellKind('/usr/bin/zsh'), 'posix');
  assert.equal(t.shellKind(undefined), 'posix');
});

test('quoteArg leaves plain words alone so commands stay readable', () => {
  for (const kind of ['powershell5', 'pwsh', 'cmd', 'posix']) {
    assert.equal(t.quoteArg('status', kind), 'status');
    assert.equal(t.quoteArg('--short', kind), '--short');
  }
  assert.equal(t.quoteArg('C:\\proj\\.venv', 'powershell5'), 'C:\\proj\\.venv');
});

test('quoteArg quotes per shell', () => {
  assert.equal(t.quoteArg("it's", 'powershell5'), "'it''s'");
  assert.equal(t.quoteArg('say "hi"', 'powershell5'), "'say \\\"hi\\\"'");
  assert.equal(t.quoteArg('say "hi"', 'pwsh'), "'say \"hi\"'");
  assert.equal(t.quoteArg("it's", 'posix'), "'it'\\''s'");
  assert.equal(t.quoteArg('say "hi"', 'cmd'), '"say ""hi"""');
  assert.equal(t.quoteArg('', 'posix'), "''");
  assert.equal(t.quoteArg('a b', 'posix'), "'a b'");
});

test('quoteArg protects a trailing backslash in Windows PowerShell', () => {
  assert.equal(t.quoteArg('C:\\my dir\\', 'powershell5'), "'C:\\my dir\\\\'");
});

test('commandLine builds a readable command', () => {
  assert.equal(t.commandLine('git', ['status', '--short'], 'powershell5'), 'git status --short');
  assert.equal(t.commandLine('git', ['commit', '-m', 'Fix the bug'], 'posix'), "git commit -m 'Fix the bug'");
  assert.equal(t.commandLine('C:\\Program Files\\Git\\git.exe', ['log'], 'powershell5'), "& 'C:\\Program Files\\Git\\git.exe' log");
  assert.equal(t.commandLine('/usr/bin/my tool', ['a b'], 'posix'), "'/usr/bin/my tool' 'a b'");
  assert.equal(t.commandLine('node', [], 'posix'), 'node');
});

test('withEnv prefixes environment variables per shell', () => {
  assert.equal(t.withEnv('gh pr list', { GH_PAGER: 'cat' }, 'powershell5'), "$env:GH_PAGER='cat'; gh pr list");
  assert.equal(t.withEnv('gh pr list', { GH_PAGER: 'cat' }, 'posix'), "export GH_PAGER='cat'; gh pr list");
  assert.equal(t.withEnv('gh pr list', { GH_PAGER: 'cat' }, 'cmd'), 'set "GH_PAGER=cat" && gh pr list');
  assert.equal(t.withEnv('gh pr list', {}, 'posix'), 'gh pr list');
});

test('labelFor names a terminal after its command', () => {
  assert.equal(t.labelFor('git status --short'), 'git status --short');
  assert.equal(t.labelFor("git 'status' '--short'"), 'git status --short');
  assert.equal(t.labelFor("& 'C:\\Users\\x\\.cargo\\bin\\cargo.exe' run"), 'cargo run');
  assert.equal(t.labelFor("cd 'C:\\x'; npm test"), 'npm test');
  assert.equal(t.labelFor('python hello.py\nsecond line'), 'python hello.py');
  assert.equal(t.labelFor(''), 'command');
  assert.equal(t.labelFor('a'.repeat(50)), 'a'.repeat(27) + '...');
});

test('gitBranch reads .git/HEAD without running git', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-git-'));
  try {
    assert.equal(t.gitBranch(dir, 0), null);
    fs.mkdirSync(path.join(dir, '.git'));
    fs.writeFileSync(path.join(dir, '.git', 'HEAD'), 'ref: refs/heads/feature/x\n');
    assert.equal(t.gitBranch(dir), 'feature/x');
    fs.mkdirSync(path.join(dir, 'src'));
    assert.equal(t.gitBranch(path.join(dir, 'src')), 'feature/x');
    fs.writeFileSync(path.join(dir, '.git', 'HEAD'), 'abcdef1234567890abcdef1234567890abcdef12\n');
    assert.equal(t.gitBranch(dir), 'abcdef12 (detached)');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('withCwd changes folder first and stops if that fails', () => {
  assert.equal(t.withCwd('git status', 'C:\\proj', 'powershell5'), 'Set-Location -LiteralPath C:\\proj -ErrorAction Stop; git status');
  assert.equal(t.withCwd('git status', 'C:\\my proj', 'pwsh'), "Set-Location -LiteralPath 'C:\\my proj' -ErrorAction Stop; git status");
  assert.equal(t.withCwd('git status', 'C:\\my proj', 'cmd'), 'cd /d "C:\\my proj" && git status');
  assert.equal(t.withCwd('git status', '/home/me/my proj', 'posix'), "cd '/home/me/my proj' && git status");
  assert.equal(t.withCwd('git status', '', 'posix'), 'git status');
});

test('extractSha finds a 40 character object id', () => {
  const sha = 'a'.repeat(40);
  assert.equal(t.extractSha('\n' + sha + '\n'), sha);
  assert.equal(t.extractSha('nothing here'), '');
  assert.equal(t.extractSha('abc123'), '');
});
