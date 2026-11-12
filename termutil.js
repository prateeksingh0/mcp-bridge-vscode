'use strict';
// Pure helpers for running commands in visible terminals. No vscode dependency, so they can be unit-tested.
const fs = require('fs');
const path = require('path');

// 'powershell5' (Windows PowerShell), 'pwsh' (PowerShell 7+), 'cmd' or 'posix' (bash, zsh, sh, Git Bash).
function shellKind(shellPath) {
  const s = String(shellPath || '').toLowerCase();
  if (/pwsh(\.exe)?$/.test(s)) return 'pwsh';
  if (/powershell(\.exe)?$/.test(s)) return 'powershell5';
  if (/cmd(\.exe)?$/.test(s)) return 'cmd';
  return 'posix';
}

// Quotes an argument for the given shell. Plain words are left unquoted so the visible command stays readable.
function quoteArg(arg, kind) {
  const a = String(arg);
  const safe = kind === 'posix' ? /^[A-Za-z0-9_@+=:,./-]+$/ : /^[A-Za-z0-9_@+=:,.\\/-]+$/;
  if (safe.test(a)) return a;
  if (kind === 'powershell5') {
    let q = a.replace(/'/g, "''").replace(/"/g, '\\"');
    if (/\s/.test(a)) q = q.replace(/(\\+)$/, '$1$1'); // a trailing backslash would swallow the closing quote
    return "'" + q + "'";
  }
  if (kind === 'pwsh') return "'" + a.replace(/'/g, "''") + "'";
  if (kind === 'cmd') return '"' + a.replace(/"/g, '""') + '"';
  return "'" + a.replace(/'/g, "'\\''") + "'";
}

// Builds a single command line: executable plus quoted arguments.
function commandLine(exe, args, kind) {
  const e = quoteArg(exe, kind);
  const call = e !== exe && (kind === 'powershell5' || kind === 'pwsh') ? '& ' : '';
  return call + e + (args && args.length ? ' ' + args.map(a => quoteArg(a, kind)).join(' ') : '');
}

// Prefixes a command with environment variables for the given shell.
function withEnv(command, env, kind) {
  const entries = Object.entries(env || {});
  if (!entries.length) return command;
  if (kind === 'powershell5' || kind === 'pwsh') {
    return entries.map(([k, v]) => '$env:' + k + "='" + String(v).replace(/'/g, "''") + "'; ").join('') + command;
  }
  if (kind === 'cmd') return entries.map(([k, v]) => 'set "' + k + '=' + v + '" && ').join('') + command;
  return entries.map(([k, v]) => 'export ' + k + "='" + String(v).replace(/'/g, "'\\''") + "'; ").join('') + command;
}

// Prefixes a command with a visible folder change. If the folder change fails, the command does not run.
function withCwd(command, cwd, kind) {
  if (!cwd) return command;
  if (kind === 'powershell5' || kind === 'pwsh') return 'Set-Location -LiteralPath ' + quoteArg(cwd, kind) + ' -ErrorAction Stop; ' + command;
  if (kind === 'cmd') return 'cd /d ' + quoteArg(cwd, 'cmd') + ' && ' + command;
  return 'cd ' + quoteArg(cwd, 'posix') + ' && ' + command;
}

// Short title for a terminal, taken from the command it runs, e.g. "git status" or "cargo run".
function labelFor(command, max = 30) {
  let c = String(command || '').split(/\r?\n/)[0].trim();
  c = c.replace(/^cd\s+("[^"]*"|'[^']*'|\S+)\s*(;|&&)\s*/i, '');
  c = c.replace(/^&\s*/, '');
  c = c.replace(/^(["'])(.+?)\1/, (m, q, p) => path.basename(p.replace(/\\/g, '/')).replace(/\.exe$/i, ''));
  c = c.replace(/["']/g, '').replace(/\s+/g, ' ').trim();
  if (!c) return 'command';
  return c.length > max ? c.slice(0, max - 3) + '...' : c;
}

// Current git branch, read from .git/HEAD. No process is started.
function gitBranch(dir, maxUp = 20) {
  let d = path.resolve(dir);
  for (let i = 0; i <= maxUp; i++) {
    try {
      const t = fs.readFileSync(path.join(d, '.git', 'HEAD'), 'utf8').trim();
      const m = /^ref: refs\/heads\/(.+)$/.exec(t);
      return m ? m[1] : t.slice(0, 8) + ' (detached)';
    } catch {}
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  return null;
}

// First 40-character hex id (a git object id) found in text, or ''.
function extractSha(text) {
  const m = /\b[0-9a-f]{40}\b/.exec(String(text));
  return m ? m[0] : '';
}

module.exports = { shellKind, quoteArg, commandLine, withEnv, withCwd, labelFor, gitBranch, extractSha };
