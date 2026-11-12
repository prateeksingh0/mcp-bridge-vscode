'use strict';
const vscode = require('vscode');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const termutil = require('./termutil');
const search = require('./search');
const runner = require('./runner');
const crypto = require('crypto');
const safety = require('./safety');
const claudeConfig = require('./claudeconfig');

const DIR = path.join(os.homedir(), '.mcp-bridge');
const WIN_DIR = path.join(DIR, 'windows');
const TOOLS = path.join(DIR, 'tools.json');
const INSTR = path.join(DIR, 'instructions.txt');
const WIN_FILE = path.join(WIN_DIR, process.pid + '.json');
const TOKEN = crypto.randomBytes(24).toString('hex');
const MAX_RESULT = 60000;
const APPROVAL_TTL = 10 * 60 * 1000;
const IGNORE = new Set(['.git', 'node_modules', '.venv', 'venv', '__pycache__', '.next', 'target']);
const BLOCK = /\b(rm\s+-\w*[rf]\w*\s|rmdir\s+\/s|del\s+\/[sqf]|rd\s+\/s|Remove-Item\b[^\n]*-Recurse|format\s+[a-z]:|mkfs|shutdown|git\s+push\b[^\n]*(--force|\s-f\b)|git\s+reset\s+--hard|git\s+clean\s+-\w*f|curl\b[^\n|]*\|\s*(sh|bash)|iwr\b[^\n]*\|\s*iex)/i;
const DANGEROUS_GIT = /(^|\s)(push|reset|clean|rebase|restore|filter-branch|update-ref|gc)(\s|$)|checkout\s+--|branch\s+-D|stash\s+(drop|clear)|tag\s+-d/;
const GH_READ = ['list', 'view', 'status', 'diff', 'checks'];
const SEV = ['Error', 'Warning', 'Info', 'Hint'];

let out, statusItem, port = 0, started = 0, focusedAt = 0, paused = false;
const T = {}; // tool registry
const terms = new Map(); // name -> { t, cwd, buf, running, last }
const approvals = new Map(); // id -> { key, expires }

// ---------- helpers ----------
const sleep = ms => new Promise(r => setTimeout(r, ms));
const idleText = () => (paused ? '$(debug-pause) MCP Bridge (paused)' : vscode.workspace.isTrusted ? '$(plug) MCP Bridge' : '$(shield) MCP Bridge (restricted)');
const log = m => out && out.appendLine('[' + new Date().toLocaleTimeString() + '] ' + m);
const clean = s => s.replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '').replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '');
const same = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
const cfg = () => vscode.workspace.getConfiguration('mcpBridge');
const str = d => ({ type: 'string', description: d });
const num = d => ({ type: 'number', description: d });
const bool = d => ({ type: 'boolean', description: d });
const P = str('Path: absolute, ~ or relative to the first workspace folder');

function canon(v) {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') return Object.keys(v).sort().reduce((o, k) => { o[k] = canon(v[k]); return o; }, {});
  return v;
}
function keyOf(name, args) {
  const rest = { ...(args || {}) };
  delete rest.approval_id;
  delete rest.target;
  return name + '|' + JSON.stringify(canon(rest));
}

function tool(name, description, props, required, handler) {
  T[name] = { description, inputSchema: { type: 'object', properties: props, required }, handler };
}
function root() {
  const f = vscode.workspace.workspaceFolders;
  return f && f.length ? f[0].uri.fsPath : os.homedir();
}
function abs(p) {
  if (!p) return root();
  p = p.replace(/^~(?=$|[\\/])/, os.homedir());
  return path.resolve(path.isAbsolute(p) ? p : path.join(root(), p));
}
const uri = p => vscode.Uri.file(abs(p));
const pos = (line, col = 1) => new vscode.Position(Math.max(0, line - 1), Math.max(0, col - 1));
const openDoc = p => vscode.workspace.openTextDocument(uri(p));

function allowedRoots() {
  const roots = (vscode.workspace.workspaceFolders || []).map(f => f.uri.fsPath);
  return roots.concat((cfg().get('allowedRoots', []) || []).map(r => abs(r)));
}
function outside(p) {
  const t = abs(p);
  return !allowedRoots().some(r => {
    const rel = path.relative(r, t);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  });
}

async function confirm(msg) {
  const pick = await Promise.race([
    vscode.window.showWarningMessage('An AI assistant wants to: ' + msg, { modal: true }, 'Allow'),
    sleep(120000).then(() => undefined),
  ]);
  if (pick !== 'Allow') throw new Error('Denied (or no answer) in VS Code');
}

// Every command goes through a visible, command-named VS Code terminal (see runner.js). Nothing runs hidden.
const sh = runner.makeSh({ vscode, termRun: (command, opts) => termRun(command, opts), termutil, path });
async function cli(file, args, cwd, timeout) {
  const r = await sh(file, file === 'git' ? ['--no-pager', ...args] : args, abs(cwd), timeout);
  if (r.missing) throw new Error(file + ' not found on PATH');
  const body = (r.stdout + r.stderr).trim() || '(no output)';
  return (r.code === 0 ? '' : 'exit code ' + r.code + '\n') + body;
}

function getText(p) {
  const f = abs(p);
  const open = vscode.workspace.textDocuments.find(d => d.uri.scheme === 'file' && same(d.uri.fsPath, f));
  if (open) return open.getText();
  if (fs.statSync(f).size > 5 * 1024 * 1024) throw new Error('File is larger than 5MB');
  return fs.readFileSync(f, 'utf8');
}

async function setContent(p, text, show = true) {
  const u = uri(p);
  const exists = fs.existsSync(u.fsPath);
  if (!exists) {
    fs.mkdirSync(path.dirname(u.fsPath), { recursive: true });
    fs.writeFileSync(u.fsPath, text);
  }
  try {
    const doc = await vscode.workspace.openTextDocument(u);
    if (exists) {
      const edit = new vscode.WorkspaceEdit();
      edit.replace(u, new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)), text);
      await vscode.workspace.applyEdit(edit);
      await doc.save();
    }
    if (show) await vscode.window.showTextDocument(doc, { preview: true, preserveFocus: true });
  } catch (e) {
    if (exists) fs.writeFileSync(u.fsPath, text);
  }
}

function walk(dir, depth, max, outl, base) {
  if (depth < 0 || outl.length >= max) return;
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  ents.sort((a, b) => a.name.localeCompare(b.name));
  for (const e of ents) {
    if (IGNORE.has(e.name)) continue;
    const full = path.join(dir, e.name);
    outl.push(path.relative(base, full) + (e.isDirectory() ? '/' : ''));
    if (outl.length >= max) return;
    if (e.isDirectory()) walk(full, depth - 1, max, outl, base);
  }
}



const fmtLoc = l => {
  const u = l.targetUri || l.uri;
  const r = l.targetSelectionRange || l.targetRange || l.range;
  return u.fsPath + ':' + (r.start.line + 1) + ':' + (r.start.character + 1);
};
function flat(syms, depth = 0, outl = []) {
  for (const s of syms || []) {
    const r = s.range || s.location.range;
    outl.push('  '.repeat(depth) + vscode.SymbolKind[s.kind] + ' ' + s.name + ' :' + (r.start.line + 1));
    if (s.children) flat(s.children, depth + 1, outl);
  }
  return outl;
}

// ---------- terminals ----------
function makeRoom() {
  const max = cfg().get('maxTerminals', 3);
  while (terms.size >= max) {
    const idle = [...terms.entries()].filter(([, x]) => !x.running).sort((a, b) => a[1].last - b[1].last)[0];
    if (!idle) throw new Error('Too many running terminals (' + terms.size + '). Close one with terminal_close or stop it with terminal_interrupt.');
    idle[1].t.dispose();
    terms.delete(idle[0]);
  }
}
function getTerm(name, cwd, title) {
  let e = terms.get(name);
  if (!e || e.t.exitStatus) {
    if (e && !e.t.exitStatus) e.t.dispose();
    terms.delete(name);
    makeRoom();
    const dir = cwd || root();
    const t = vscode.window.createTerminal({ name: title || (name === 'main' ? 'MCP Bridge' : 'MCP Bridge: ' + name), cwd: dir });
    e = { t, cwd: dir, title, buf: '', running: false, last: Date.now() };
    terms.set(name, e);
  }
  e.last = Date.now();
  return e;
}
// Terminal titles follow the command being run. VS Code has no API to rename a terminal directly,
// so the terminal is selected and renamed through its rename command.
async function renameTerm(e, title) {
  try {
    e.t.show(true);
    await vscode.commands.executeCommand('workbench.action.terminal.renameWithArg', { name: title });
  } catch {}
  e.title = title;
}
function waitSI(t, ms) {
  return new Promise(resolve => {
    if (t.shellIntegration) return resolve(t.shellIntegration);
    const timer = setTimeout(() => { d.dispose(); resolve(undefined); }, ms);
    const d = vscode.window.onDidChangeTerminalShellIntegration(ev => {
      if (ev.terminal === t) { clearTimeout(timer); d.dispose(); resolve(ev.shellIntegration); }
    });
  });
}
async function acquire(name, cwd, title) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const e = getTerm(name, cwd, title);
    if (title && e.title !== title) await renameTerm(e, title);
    e.t.show(true);
    const si = e.t.shellIntegration || (await waitSI(e.t, attempt === 0 ? 20000 : 15000));
    if (si) return { e, si };
    if (attempt === 0) { e.t.dispose(); terms.delete(name); } else return { e, si: undefined };
  }
}
function withVenv(cmd, venv) {
  const v = abs(venv);
  const bin = path.join(v, process.platform === 'win32' ? 'Scripts' : 'bin');
  const shell = (vscode.env.shell || '').toLowerCase();
  if (/pwsh|powershell/.test(shell)) return "$env:VIRTUAL_ENV='" + v + "'; $env:Path='" + bin + ";' + $env:Path; " + cmd;
  if (/cmd\.exe$/.test(shell)) return 'set "VIRTUAL_ENV=' + v + '" && set "PATH=' + bin + ';%PATH%" && ' + cmd;
  return "export VIRTUAL_ENV='" + v + "'; export PATH='" + bin + "':\"$PATH\"; " + cmd;
}
async function termRun(command, opts) {
  const { cwd, name = 'main', timeout = 60, venv, label } = opts;
  const title = 'MCP: ' + termutil.labelFor(label || command);
  if (venv) command = withVenv(command, venv);
  const ex = terms.get(name);
  if (ex && ex.running) throw new Error('Terminal "' + name + '" is still running a command. Use terminal_read, terminal_interrupt, or another name.');
  const { e, si } = await acquire(name, cwd ? abs(cwd) : undefined, title);
  if (!si) {
    e.t.sendText(command);
    return 'WARNING: output NOT captured. VS Code shell integration did not start in terminal "' + name + '" (waited about 35s). The command was sent to that terminal and may still be running. Check the terminal panel, or verify the result through files.';
  }
  let exec;
  e.running = true;
  e.buf = '';
  const ended = new Promise(resolve => {
    const d = vscode.window.onDidEndTerminalShellExecution(ev => {
      if (ev.execution === exec) { d.dispose(); e.running = false; resolve(ev.exitCode); }
    });
  });
  const want = cwd ? abs(cwd) : undefined;
  if (want && e.cwd !== want) {
    command = termutil.withCwd(command, want, termutil.shellKind(vscode.env.shell));
    e.cwd = want;
  }
  exec = si.executeCommand(command);
  (async () => {
    for await (const c of exec.read()) { e.buf += c; if (e.buf.length > 200000) e.buf = e.buf.slice(-100000); }
  })().catch(() => {});
  const code = await Promise.race([ended, sleep(timeout * 1000).then(() => 'timeout')]);
  await sleep(300);
  const text = clean(e.buf).trim().slice(-20000);
  if (code === 'timeout') return 'Still running after ' + timeout + 's (use terminal_read / terminal_interrupt). Output so far:\n' + text;
  return 'exit code: ' + (code === undefined ? 'unknown' : code) + '\n' + text;
}

// ---------- TOOLS: workspace ----------
tool('get_workspace', 'Overview: workspace folders, active file, open tabs, terminals, git branch, trust state, OS. Call this first to confirm the window.', {}, [], async () => {
  const folders = (vscode.workspace.workspaceFolders || []).map(f => f.uri.fsPath);
  const active = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.document.uri.fsPath : null;
  const tabs = vscode.window.tabGroups.all.flatMap(g => g.tabs.map(t => t.input && t.input.uri && t.input.uri.fsPath).filter(Boolean));
  const branch = folders[0] ? termutil.gitBranch(folders[0]) : null;
  return { pid: process.pid, folders, active, tabs, terminals: [...terms.keys()], branch, trusted: vscode.workspace.isTrusted, platform: process.platform, shell: vscode.env.shell, vscode: vscode.version };
});
tool('open_folder', 'Open a folder in VS Code. Reuses the current window unless new_window is true.',
  { path: P, new_window: bool('Default false') }, ['path'], async ({ path: p, new_window = false }) => {
    const target = abs(p);
    if (!fs.existsSync(target)) throw new Error('Folder not found: ' + target);
    setTimeout(() => vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(target), { forceNewWindow: new_window }), 200);
    return 'Opening ' + target + (new_window ? ' in a new window' : ' in this window');
  });

// ---------- TOOLS: files (CRUD) ----------
tool('list_files', 'List files/folders recursively (skips .git, node_modules, venvs). Folders end with /.',
  { path: P, depth: num('Max depth, default 3'), max: num('Max entries, default 500') }, [],
  async ({ path: p, depth = 3, max = 500 }) => {
    const base = abs(p), outl = [];
    walk(base, depth - 1, max, outl, base);
    return outl.join('\n') || '(empty)';
  });
tool('find_files', 'Find files by glob in the workspace, e.g. **/*.py', { glob: str('Glob pattern'), max: num('Default 200') }, ['glob'],
  async ({ glob, max = 200 }) => {
    const r = await vscode.workspace.findFiles(glob, '**/{node_modules,.git,.venv,venv,target}/**', max);
    return r.map(u => u.fsPath).join('\n') || 'No matches (needs an open workspace folder)';
  });
tool('read_file', 'Read a text file with line numbers (includes unsaved editor changes).',
  { path: P, start_line: num('1-based, default 1'), end_line: num('Default: end of file') }, ['path'],
  async ({ path: p, start_line = 1, end_line = 0 }) => {
    const lines = getText(p).split(/\r?\n/);
    const end = end_line || lines.length;
    return lines.slice(start_line - 1, end).map((l, i) => (start_line + i) + ': ' + l).join('\n');
  });
tool('write_file', 'Create or overwrite a file (parent folders auto-created). Shown live in the editor.',
  { path: P, content: str('Full file content') }, ['path', 'content'], async ({ path: p, content }) => {
    await setContent(p, content);
    return 'Wrote ' + content.length + ' chars to ' + abs(p);
  });
tool('append_file', 'Append text to a file.', { path: P, content: str('Text to append') }, ['path', 'content'],
  async ({ path: p, content }) => {
    await setContent(p, (fs.existsSync(abs(p)) ? getText(p) : '') + content);
    return 'Appended to ' + abs(p);
  });
tool('edit_file', 'Apply find/replace edits. Each "old" must match exactly once unless replace_all is true.',
  {
    path: P,
    edits: { type: 'array', items: { type: 'object', properties: { old: str('Exact text to find'), new: str('Replacement'), replace_all: bool('Replace every match') }, required: ['old', 'new'] } },
  }, ['path', 'edits'], async ({ path: p, edits }) => {
    let text = getText(p);
    for (const [i, e] of edits.entries()) {
      if (!e.old) throw new Error('edit ' + (i + 1) + ': "old" is empty');
      const n = text.split(e.old).length - 1;
      if (n === 0) throw new Error('edit ' + (i + 1) + ': text not found');
      if (n > 1 && !e.replace_all) throw new Error('edit ' + (i + 1) + ': ' + n + ' matches; add more context or set replace_all');
      text = e.replace_all ? text.split(e.old).join(e.new) : text.replace(e.old, () => e.new);
    }
    await setContent(p, text);
    return 'Applied ' + edits.length + ' edit(s) to ' + abs(p);
  });
tool('create_dir', 'Create a folder (and parents).', { path: P }, ['path'], async ({ path: p }) => {
  await vscode.workspace.fs.createDirectory(uri(p));
  return 'Created ' + abs(p);
});
tool('move_path', 'Move/rename a file or folder (VS Code updates imports where it can).',
  { src: P, dest: P, overwrite: bool('Default false') }, ['src', 'dest'], async ({ src, dest, overwrite = false }) => {
    fs.mkdirSync(path.dirname(abs(dest)), { recursive: true });
    const e = new vscode.WorkspaceEdit();
    e.renameFile(uri(src), uri(dest), { overwrite });
    if (!(await vscode.workspace.applyEdit(e))) throw new Error('Move failed');
    return 'Moved to ' + abs(dest);
  });
tool('copy_path', 'Copy a file or folder.', { src: P, dest: P, overwrite: bool('Default false') }, ['src', 'dest'],
  async ({ src, dest, overwrite = false }) => {
    fs.mkdirSync(path.dirname(abs(dest)), { recursive: true });
    await vscode.workspace.fs.copy(uri(src), uri(dest), { overwrite });
    return 'Copied to ' + abs(dest);
  });
tool('delete_path', 'Delete a file or folder (moved to the trash, so it is recoverable). Needs approval.',
  { path: P, recursive: bool('Required for non-empty folders') }, ['path'], async ({ path: p, recursive = false }) => {
    const t = abs(p);
    if (t === path.parse(t).root || same(t, os.homedir())) throw new Error('Refusing to delete a drive root or the home folder');
    if (!fs.existsSync(t)) throw new Error('Not found: ' + t);
    await vscode.workspace.fs.delete(vscode.Uri.file(t), { recursive, useTrash: true });
    return 'Moved to trash: ' + t;
  });
tool('search', 'Search text in files with the built-in search (no external program).',
  { query: str('Text or regex'), path: P, glob: str('e.g. *.py'), regex: bool('Treat query as regex'), ignore_case: bool(''), max: num('Max lines, default 100') }, ['query'],
  async ({ query, path: p, glob, regex = false, ignore_case = false, max = 100 }) => {
    const r = { stdout: search.searchText({ base: abs(p), query, regex, ignoreCase: ignore_case, glob, max }).join(String.fromCharCode(10)) };
    return r.stdout.split('\n').slice(0, max).join('\n') || 'No matches';
  });

// ---------- TOOLS: editor ----------
tool('open_file', 'Open a file in the editor, optionally at a line.', { path: P, line: num('1-based') }, ['path'], async ({ path: p, line }) => {
  const ed = await vscode.window.showTextDocument(await openDoc(p), { preview: false });
  if (line) { const ps = pos(line); ed.selection = new vscode.Selection(ps, ps); ed.revealRange(new vscode.Range(ps, ps), vscode.TextEditorRevealType.InCenter); }
  return 'Opened ' + abs(p);
});
tool('get_active_editor', 'Active file, cursor line, selected text, language, dirty state.', {}, [], async () => {
  const ed = vscode.window.activeTextEditor;
  if (!ed) return 'No active editor';
  return { file: ed.document.uri.fsPath, language: ed.document.languageId, dirty: ed.document.isDirty, line: ed.selection.active.line + 1, selection: ed.document.getText(ed.selection).slice(0, 5000) };
});
tool('save_all', 'Save all open files.', {}, [], async () => { await vscode.workspace.saveAll(false); return 'Saved all'; });
tool('format_document', 'Format a file with the default formatter and save it.', { path: P }, ['path'], async ({ path: p }) => {
  const doc = await openDoc(p);
  await vscode.window.showTextDocument(doc, { preview: false });
  await vscode.commands.executeCommand('editor.action.formatDocument');
  await doc.save();
  return 'Formatted ' + abs(p);
});

// ---------- TOOLS: code intelligence ----------
tool('get_diagnostics', 'Errors/warnings from language servers for one file, or all open files.',
  { path: P, max: num('Default 100') }, [], async ({ path: p, max = 100 }) => {
    let all;
    if (p) { await openDoc(p); await sleep(1000); all = [[uri(p), vscode.languages.getDiagnostics(uri(p))]]; }
    else all = vscode.languages.getDiagnostics();
    const lines = [];
    for (const [u, ds] of all) for (const d of ds)
      lines.push(u.fsPath + ':' + (d.range.start.line + 1) + ':' + (d.range.start.character + 1) + ' ' + SEV[d.severity] + ' ' + d.message.split('\n')[0] + (d.source ? ' [' + d.source + ']' : ''));
    return lines.slice(0, max).join('\n') || 'No problems found';
  });
tool('go_to_definition', 'Find the definition of the symbol at a position (1-based line/column).', { path: P, line: num(''), column: num('') }, ['path', 'line'],
  async ({ path: p, line, column = 1 }) => {
    await openDoc(p);
    const r = await vscode.commands.executeCommand('vscode.executeDefinitionProvider', uri(p), pos(line, column));
    return (r || []).map(fmtLoc).join('\n') || 'No definition found';
  });
tool('find_references', 'Find all references to the symbol at a position.', { path: P, line: num(''), column: num('') }, ['path', 'line'],
  async ({ path: p, line, column = 1 }) => {
    await openDoc(p);
    const r = await vscode.commands.executeCommand('vscode.executeReferenceProvider', uri(p), pos(line, column));
    return (r || []).map(fmtLoc).join('\n') || 'No references found';
  });
tool('hover', 'Type/docs info for the symbol at a position.', { path: P, line: num(''), column: num('') }, ['path', 'line'],
  async ({ path: p, line, column = 1 }) => {
    await openDoc(p);
    const r = await vscode.commands.executeCommand('vscode.executeHoverProvider', uri(p), pos(line, column));
    return (r || []).flatMap(h => h.contents.map(c => (typeof c === 'string' ? c : c.value))).join('\n---\n') || 'No info';
  });
tool('document_symbols', 'Outline of a file (classes, functions, ...).', { path: P }, ['path'], async ({ path: p }) => {
  await openDoc(p);
  return flat(await vscode.commands.executeCommand('vscode.executeDocumentSymbolProvider', uri(p))).join('\n') || 'No symbols';
});
tool('workspace_symbols', 'Search symbols across the workspace by name.', { query: str('Name or part of it') }, ['query'], async ({ query }) => {
  const r = await vscode.commands.executeCommand('vscode.executeWorkspaceSymbolProvider', query);
  return (r || []).slice(0, 100).map(s => vscode.SymbolKind[s.kind] + ' ' + s.name + ' ' + s.location.uri.fsPath + ':' + (s.location.range.start.line + 1)).join('\n') || 'No symbols';
});
tool('rename_symbol', 'Rename a symbol everywhere using the language server.', { path: P, line: num(''), column: num(''), new_name: str('') }, ['path', 'line', 'new_name'],
  async ({ path: p, line, column = 1, new_name }) => {
    await openDoc(p);
    const edit = await vscode.commands.executeCommand('vscode.executeDocumentRenameProvider', uri(p), pos(line, column), new_name);
    if (!edit) return 'Rename not available at that position';
    await vscode.workspace.applyEdit(edit);
    await vscode.workspace.saveAll(false);
    return 'Renamed in ' + edit.size + ' file(s)';
  });

// ---------- TOOLS: terminal ----------
tool('terminal_run', 'Run a command in a VS Code terminal the user can watch live; returns output and exit code. Reuse the default terminal; use a different "name" only for long-running jobs like dev servers.',
  { command: str('Command line'), cwd: P, name: str('Terminal name, default "main"'), timeout: num('Seconds to wait, default 60'), venv: str('Optional venv folder to use for this command, e.g. .venv') },
  ['command'], async args => termRun(args.command, args));
tool('terminal_read', 'Latest output of a terminal started with terminal_run.', { name: str('Default "main"') }, [], async ({ name = 'main' }) => {
  const e = terms.get(name);
  if (!e) throw new Error('No terminal named ' + name);
  return (e.running ? '[still running]\n' : '[finished]\n') + clean(e.buf).trim().slice(-20000);
});
tool('terminal_interrupt', 'Send Ctrl+C to a terminal.', { name: str('Default "main"') }, [], async ({ name = 'main' }) => {
  const e = terms.get(name);
  if (!e) throw new Error('No terminal named ' + name);
  e.t.sendText('\x03', false);
  return 'Sent Ctrl+C to ' + name;
});
tool('terminal_close', 'Close a bridge terminal.', { name: str('Default "main"') }, [], async ({ name = 'main' }) => {
  const e = terms.get(name);
  if (e) e.t.dispose();
  terms.delete(name);
  return 'Closed ' + name;
});
tool('terminal_list', 'List bridge terminals.', {}, [], async () => [...terms.entries()].map(([k, e]) => k + ' (' + (e.running ? 'running' : 'idle') + ') cwd=' + e.cwd).join('\n') || 'None');

// ---------- TOOLS: python ----------
tool('python_create_venv', 'Create a Python virtualenv. Use the "venv" option of terminal_run to run commands inside it.',
  { path: str('Venv folder, e.g. .venv'), python: str('Python executable, default python/python3') }, ['path'],
  async ({ path: p, python }) => {
    const exe = python || (process.platform === 'win32' ? 'python' : 'python3');
    const r = await sh(exe, ['-m', 'venv', abs(p)], root(), 300000);
    if (r.missing) throw new Error(exe + ' not found');
    return r.code === 0 ? 'Created venv at ' + abs(p) : 'Failed: ' + (r.stderr || r.stdout);
  });
tool('python_use_venv', 'Set a venv as the workspace Python interpreter (needs the Python extension and an open folder).', { path: str('Venv folder') }, ['path'],
  async ({ path: p }) => {
    const py = path.join(abs(p), process.platform === 'win32' ? 'Scripts' : 'bin', process.platform === 'win32' ? 'python.exe' : 'python');
    if (!fs.existsSync(py)) throw new Error('No Python found at ' + py);
    await vscode.workspace.getConfiguration('python').update('defaultInterpreterPath', py, vscode.ConfigurationTarget.Workspace);
    return 'Interpreter set to ' + py;
  });

// ---------- TOOLS: git / GitHub ----------
tool('git_status', 'git status (short, with branch).', { cwd: P }, [], async ({ cwd }) => cli('git', ['status', '--short', '--branch'], cwd));
tool('git_diff', 'git diff, optionally for one path or staged changes.', { cwd: P, path: str('Optional file'), staged: bool('') }, [],
  async ({ cwd, path: p, staged }) => cli('git', ['diff', ...(staged ? ['--staged'] : []), ...(p ? ['--', p] : [])], cwd));
tool('git_log', 'Recent commits.', { cwd: P, n: num('Default 10') }, [], async ({ cwd, n = 10 }) => cli('git', ['log', '--oneline', '--decorate', '-n', String(n)], cwd));
tool('git_commit', 'Stage everything (unless add_all=false) and commit.', { cwd: P, message: str('Commit message'), add_all: bool('Default true') }, ['message'],
  async ({ cwd, message, add_all = true }) => {
    if (add_all) await cli('git', ['add', '-A'], cwd);
    return cli('git', ['commit', '-m', message], cwd);
  });
tool('checkpoint', 'Save a restorable snapshot of tracked changes as a git stash entry without touching the working tree. Use before big edits.', { cwd: P, label: str('') }, ['label'],
  async ({ cwd, label }) => {
    const r = await sh('git', ['stash', 'create'], abs(cwd));
    const sha = termutil.extractSha(r.stdout);
    if (!sha) return 'Nothing to checkpoint (no changes to tracked files)';
    await cli('git', ['stash', 'store', '-m', 'checkpoint: ' + label, sha], cwd);
    return 'Checkpoint saved: ' + sha.slice(0, 8) + ' (see git stash list)';
  });
tool('git', 'Run any git command with an args array, e.g. ["checkout","-b","feature"]. Risky ones (push, reset, clean, rebase, restore...) need approval.',
  { args: { type: 'array', items: { type: 'string' } }, cwd: P }, ['args'], async ({ args, cwd }) => cli('git', args, cwd, 300000));
tool('gh', 'Run the GitHub CLI with an args array, e.g. ["pr","list"]. Needs gh installed and logged in. Non-read-only commands need approval.',
  { args: { type: 'array', items: { type: 'string' } }, cwd: P }, ['args'], async ({ args, cwd }) => cli('gh', args, cwd, 300000));

// ---------- TOOLS: extensions, settings, commands, tasks, debug ----------
tool('extension_list', 'List installed (non-built-in) extensions.', {}, [], async () =>
  vscode.extensions.all.filter(e => !(e.packageJSON && e.packageJSON.isBuiltin) && !e.id.startsWith('vscode.'))
    .map(e => e.id + '@' + e.packageJSON.version + (e.isActive ? ' (active)' : '')).join('\n') || 'None');
tool('extension_install', 'Install an extension by id (publisher.name) or a .vsix path. Needs approval.', { id: str('e.g. ms-python.python, or path to .vsix') }, ['id'],
  async ({ id }) => {
    await vscode.commands.executeCommand('workbench.extensions.installExtension', /\.vsix$/i.test(id) ? uri(id) : id);
    return 'Installed (or already installed): ' + id;
  });
tool('extension_uninstall', 'Uninstall an extension by id. Needs approval.', { id: str('publisher.name') }, ['id'], async ({ id }) => {
  await vscode.commands.executeCommand('workbench.extensions.uninstallExtension', id);
  return 'Uninstalled ' + id + ' (reload may be needed)';
});
tool('get_setting', 'Read a VS Code setting, e.g. editor.fontSize.', { key: str('Setting key') }, ['key'], async ({ key }) => vscode.workspace.getConfiguration().get(key));
tool('update_setting', 'Change a VS Code setting (workspace by default; user scope needs approval).',
  { key: str('Setting key'), value: {}, scope: str('"workspace" (default) or "user"') }, ['key', 'value'], async ({ key, value, scope = 'workspace' }) => {
    await vscode.workspace.getConfiguration().update(key, value, scope === 'user' ? vscode.ConfigurationTarget.Global : vscode.ConfigurationTarget.Workspace);
    return 'Updated ' + key;
  });
tool('list_vscode_commands', 'Search VS Code command ids by substring.', { filter: str('e.g. git.'), max: num('Default 100') }, [], async ({ filter = '', max = 100 }) =>
  (await vscode.commands.getCommands(true)).filter(c => c.toLowerCase().includes(filter.toLowerCase())).slice(0, max).join('\n'));
tool('run_vscode_command', 'Run any VS Code command by id. Needs approval.', { command: str('Command id'), args: { type: 'array', items: {} } }, ['command'],
  async ({ command, args = [] }) => vscode.commands.executeCommand(command, ...args));
tool('list_tasks', 'List VS Code tasks.', {}, [], async () => (await vscode.tasks.fetchTasks()).map(t => t.name + ' (' + t.source + ')').join('\n') || 'None');
tool('run_task', 'Run a VS Code task by name.', { name: str('Task name') }, ['name'], async ({ name }) => {
  const t = (await vscode.tasks.fetchTasks()).find(x => x.name === name);
  if (!t) throw new Error('Task not found: ' + name);
  await vscode.tasks.executeTask(t);
  return 'Started task ' + name;
});
tool('debug_start', 'Start debugging with a launch.json config name, or an inline config object.', { name: str('Launch config name'), config: { type: 'object' } }, [],
  async ({ name, config }) => {
    const ok = await vscode.debug.startDebugging((vscode.workspace.workspaceFolders || [])[0], config || name);
    return ok ? 'Debug session started' : 'Could not start debugging';
  });
tool('debug_stop', 'Stop the debug session.', {}, [], async () => { await vscode.debug.stopDebugging(); return 'Stopped'; });

// ---------- TOOLS: approvals + batch ----------
tool('request_approval', 'Step 1 for risky actions. Describe the exact tool call you intend to make; returns an approval_id and the text for the approval card to show the user.',
  { tool: str('Name of the tool you want to call'), args: { type: 'object', description: 'The exact arguments of the intended call' } }, ['tool', 'args'],
  async ({ tool: name, args }) => {
    if (!T[name]) throw new Error('Unknown tool: ' + name);
    const a = args || {};
    const g = GATES[name] && GATES[name](a);
    if (!g) return 'No approval needed for this call. Just call ' + name + '.';
    for (const [k, v] of approvals) if (v.expires < Date.now()) approvals.delete(k);
    const id = crypto.randomBytes(6).toString('hex');
    approvals.set(id, { key: keyOf(name, a), expires: Date.now() + APPROVAL_TTL });
    return JSON.stringify({
      approval_id: id,
      risk: g.level === 'high' ? 'high' : 'medium',
      what_will_happen: g.summary,
      valid_minutes: 10,
      next: 'Ask the user to approve with a multiple-choice question (Approve / Deny). Only if they clearly approve, call ' + name + ' again with the same arguments plus approval_id.',
    }, null, 2);
  });
tool('batch', 'Run several tools in ONE call (faster). Each call is {tool, args}. Runs in order; risky calls inside still need their own approval_id.',
  { calls: { type: 'array', items: { type: 'object', properties: { tool: str('Tool name'), args: { type: 'object' } }, required: ['tool'] } }, stop_on_error: bool('Default true') }, ['calls'],
  async ({ calls, stop_on_error = true }) => {
    const res = [];
    for (const [i, c] of calls.entries()) {
      if (c.tool === 'batch') { res.push('#' + (i + 1) + ' batch: nested batch not allowed'); continue; }
      try { res.push('#' + (i + 1) + ' ' + c.tool + ':\n' + (await callTool(c.tool, c.args))); }
      catch (e) { res.push('#' + (i + 1) + ' ' + c.tool + ' ERROR: ' + e.message); if (stop_on_error) break; }
    }
    return res.join('\n\n');
  });

// ---------- classification, gates, dispatcher ----------
// read = never changes anything. crit = irreversible or runs arbitrary code. everything else = reversible writes
// (editor undo, git, trash, checkpoint).
const READ = new Set(['get_workspace', 'list_files', 'find_files', 'read_file', 'search', 'get_active_editor', 'get_diagnostics', 'go_to_definition', 'find_references', 'hover', 'document_symbols', 'workspace_symbols', 'terminal_read', 'terminal_list', 'git_status', 'git_diff', 'git_log', 'extension_list', 'get_setting', 'list_vscode_commands', 'list_tasks', 'request_approval']);
const CRIT = new Set(['delete_path', 'terminal_run', 'git', 'gh', 'extension_install', 'extension_uninstall', 'run_vscode_command', 'update_setting', 'run_task', 'debug_start', 'batch']);
const OPEN = new Set(['gh', 'git', 'extension_install']);

const protectedGate = paths => a => {
  const bad = paths.map(k => a[k]).filter(v => typeof v === 'string').find(v => safety.isProtected(abs(v), cfg().get('protectedPaths', [])));
  return bad ? { level: 'high', summary: 'Access PROTECTED path (credentials or keys): ' + abs(bad) } : null;
};
const guard = (paths, writes) => a => protectedGate(paths)(a) || (writes ? outsideGate(paths)(a) : null);
const outsideGate = paths => a => {
  const bad = paths.map(k => a[k]).filter(v => v !== undefined).find(v => outside(v));
  return bad ? { level: 'chat', summary: 'Write outside your workspace folders: ' + abs(bad) } : null;
};
const GATES = {
  delete_path: a => ({ level: 'high', summary: 'Move to trash: ' + abs(a.path) + (a.recursive ? ' (recursive)' : '') }),
  extension_install: a => ({ level: 'high', summary: 'Install extension: ' + a.id }),
  extension_uninstall: a => ({ level: 'high', summary: 'Uninstall extension: ' + a.id }),
  run_vscode_command: a => ({ level: 'high', summary: 'Run VS Code command: ' + a.command + ' ' + JSON.stringify(a.args || []).slice(0, 200) }),
  update_setting: a => (a.scope === 'user' ? { level: 'chat', summary: 'Change USER setting ' + a.key + ' = ' + JSON.stringify(a.value) } : null),
  git: a => (DANGEROUS_GIT.test((a.args || []).join(' ')) ? { level: 'high', summary: 'git ' + (a.args || []).join(' ') + ' (in ' + abs(a.cwd) + ')' } : null),
  gh: a => (GH_READ.includes((a.args || [])[1]) ? null : { level: 'high', summary: 'gh ' + (a.args || []).join(' ') }),
  terminal_run: a => (BLOCK.test(a.command || '') ? { level: 'high', summary: 'Risky command: ' + a.command } : null),
  write_file: guard(['path'], true),
  append_file: guard(['path'], true),
  edit_file: guard(['path'], true),
  create_dir: guard(['path'], true),
  move_path: guard(['src', 'dest'], true),
  copy_path: a => guard(['src', 'dest'], false)(a) || outsideGate(['dest'])(a),
  read_file: guard(['path'], false),
  list_files: guard(['path'], false),
  search: guard(['path'], false),
  open_file: guard(['path'], false),
  document_symbols: guard(['path'], false),
  hover: guard(['path'], false),
  go_to_definition: guard(['path'], false),
  find_references: guard(['path'], false),
  get_diagnostics: guard(['path'], false),
  git_diff: guard(['path'], false),
  format_document: guard(['path'], true),
};

async function enforceApproval(name, args) {
  const g = GATES[name] && GATES[name](args);
  if (!g) return;
  const mode = cfg().get('approvalMode', 'chat-and-vscode');
  if (mode === 'off') return;
  if (mode !== 'vscode-only') {
    const id = args.approval_id;
    const rec = id && approvals.get(id);
    if (!rec || rec.key !== keyOf(name, args) || rec.expires < Date.now()) {
      throw new Error('APPROVAL_REQUIRED: ' + g.summary + '\nCall request_approval with tool="' + name + '" and exactly these arguments, show the user the approval card and wait for a clear Approve. Then call ' + name + ' again with the same arguments plus the approval_id.');
    }
    approvals.delete(id);
  }
  if (mode === 'vscode-only' || (mode === 'chat-and-vscode' && g.level === 'high')) await confirm(g.summary);
}

function toText(r) {
  if (r === undefined || r === null) return 'OK';
  if (typeof r === 'string') return r;
  try { return JSON.stringify(r, null, 2); } catch { return String(r); }
}
async function callTool(name, args) {
  const t = T[name];
  if (!t) throw new Error('Unknown tool: ' + name);
  args = args || {};
  if (!vscode.workspace.isTrusted && name !== 'get_workspace' && name !== 'request_approval' && !cfg().get('allowInUntrustedWorkspace', false)) {
    throw new Error('This VS Code window is in Restricted Mode (workspace not trusted), so MCP Bridge tools are disabled for safety. Ask the user to click Restricted Mode in the status bar and choose Trust.');
  }
  if (paused && name !== 'get_workspace') throw new Error('MCP Bridge is PAUSED by the user. Do not retry or look for workarounds; tell the user and ask them to resume it (click MCP Bridge in the status bar).');
  const t0 = Date.now();
  log(name + ' ' + JSON.stringify(args).slice(0, 300));
  statusItem.text = '$(sync~spin) ' + name;
  try {
    await enforceApproval(name, args);
    let text = toText(await t.handler(args));
    safety.audit({ tool: name, args: safety.summarize(name, args), ok: true, ms: Date.now() - t0 });
    if (cfg().get('redactSecrets', true)) text = safety.redact(text);
    if (text.length > MAX_RESULT) text = text.slice(0, MAX_RESULT) + '\n...[truncated ' + (text.length - MAX_RESULT) + ' chars]';
    return text;
  } catch (e) { log(name + ' failed: ' + e.message); safety.audit({ tool: name, args: safety.summarize(name, args), ok: false, error: String(e.message).split('\n')[0].slice(0, 300), ms: Date.now() - t0 }); throw e; }
  finally { statusItem.text = idleText(); }
}
function manifest() {
  return Object.entries(T).map(([name, t]) => {
    const props = { ...t.inputSchema.properties };
    if (GATES[name]) props.approval_id = str('From request_approval. Needed only when the server replies APPROVAL_REQUIRED.');
    return {
      name,
      description: t.description,
      inputSchema: { ...t.inputSchema, properties: props },
      annotations: { title: name.replace(/_/g, ' '), readOnlyHint: READ.has(name), destructiveHint: CRIT.has(name), idempotentHint: READ.has(name), openWorldHint: OPEN.has(name) },
    };
  });
}

function buildInstructions() {
  const shell = vscode.env.shell || 'unknown';
  const hint = /powershell\.exe$/i.test(shell) ? 'This is Windows PowerShell 5.1: chain commands with ; and do not use &&.' : /pwsh/i.test(shell) ? 'PowerShell 7: && works.' : '';
  return [
    'You control the user\'s VS Code through this server. Follow these rules.',
    '',
    'WINDOWS',
    '- Start each session with get_workspace (or list_windows) and confirm you are in the intended window. If several windows are open, pass target (a folder path) to choose.',
    '- Do not open new windows. open_folder reuses the current window unless the user asks for a new one.',
    '',
    'TERMINALS',
    '- Run every command with terminal_run so the user can watch it. Never run commands any other way: the git, gh and venv tools also type their command into a visible terminal, and each terminal is titled after its command. Reuse the default "main" terminal. Use a separate name only for long-running processes (dev servers) and close them with terminal_close when done. At most ' + cfg().get('maxTerminals', 3) + ' terminals.',
    '- Shell: ' + shell + '. ' + hint,
    '- If a result says output was NOT captured, do not assume success. Verify through files or rerun.',
    '',
    'APPROVALS',
    '- Risky calls reply APPROVAL_REQUIRED. Then call request_approval with the exact tool and arguments, show the user an approval card as a multiple-choice question (Approve / Deny) that includes what_will_happen, and only after a clear Approve call the tool again with the same arguments plus approval_id. Never invent or reuse an approval_id. Never ask for approval in plain text only.',
    '- Prefer reversible actions. Use checkpoint before large edits. delete_path goes to the trash.',
    '- Never read or print secrets (.env, keys, tokens, password files) unless the user explicitly asks.',
    '',
    'SAFETY',
    '- The user can pause you at any time. If a tool says MCP Bridge is PAUSED, stop and tell the user; do not retry or look for workarounds.',
    '- Credentials, keys and .env files are PROTECTED paths and need approval to touch. Tool output has secrets redacted; never try to get around the redaction.',
    '- Every call is written to an audit log that the user can open.',
    '',
    'KEEP THE WORKSPACE CLEAN',
    '- Do not leave scratch or test files behind. Delete temporary files you created (ask first if unsure).',
    '- Work inside the user\'s project folder. Ask before writing elsewhere.',
    '- Prefer edit_file over rewriting whole files. Use batch for multi-step work. Keep outputs small.',
    '- Finish with a short summary of what you changed.',
  ].join('\n');
}

// ---------- HTTP server, window registry ----------
async function handle(req, res) {
  const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
  if (req.headers['x-token'] !== TOKEN) return send(403, { error: 'forbidden' });
  if (req.method === 'GET' && req.url === '/ping') return send(200, { ok: true });
  if (req.method === 'GET' && req.url === '/tools') return send(200, { tools: manifest() });
  if (req.method === 'POST' && req.url === '/call') {
    let body = '';
    for await (const c of req) body += c;
    try {
      const { name, arguments: a } = JSON.parse(body);
      return send(200, { text: await callTool(name, a) });
    } catch (e) { return send(200, { text: 'Error: ' + ((e && e.message) || e), isError: true }); }
  }
  send(404, {});
}
function publish() {
  if (!port) return;
  try {
    fs.mkdirSync(WIN_DIR, { recursive: true });
    const folders = (vscode.workspace.workspaceFolders || []).map(f => f.uri.fsPath);
    fs.writeFileSync(WIN_FILE, JSON.stringify({ pid: process.pid, port, token: TOKEN, folders, trusted: vscode.workspace.isTrusted, paused, focusedAt, started }), { mode: 0o600 });
  } catch (e) { log('publish failed: ' + e.message); }
}
function installShim(ctx) {
  fs.mkdirSync(DIR, { recursive: true });
  const dst = path.join(DIR, 'shim.js');
  fs.copyFileSync(path.join(ctx.extensionPath, 'shim.js'), dst);
  return dst;
}

// Finds claude_desktop_config.json in the usual places and in per-install data folders (e.g. Claude-Data/<id>/).
function findConfigs() {
  const found = new Set();
  const scan = (dir, depth) => {
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const full = path.join(dir, e.name);
      if (e.isFile() && e.name === 'claude_desktop_config.json') found.add(full);
      else if (e.isDirectory() && depth > 0) scan(full, depth - 1);
    }
  };
  const bases = process.platform === 'win32' ? [process.env.APPDATA, process.env.LOCALAPPDATA]
    : process.platform === 'darwin' ? [path.join(os.homedir(), 'Library', 'Application Support')]
      : [path.join(os.homedir(), '.config')];
  for (const b of bases.filter(Boolean)) {
    let names = [];
    try { names = fs.readdirSync(b); } catch {}
    for (const n of names) if (/^claude/i.test(n)) scan(path.join(b, n), 3);
  }
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    const pk = path.join(process.env.LOCALAPPDATA, 'Packages');
    let names = [];
    try { names = fs.readdirSync(pk); } catch {}
    for (const n of names) if (/^Claude_|AnthropicPBC/i.test(n)) scan(path.join(pk, n), 5);
  }
  return [...found];
}

async function connectClaudeDesktop(ctx) {
  const shim = installShim(ctx);
  const c = [];
  if (process.platform === 'win32') {
    c.push(path.join(process.env.APPDATA || '', 'Claude', 'claude_desktop_config.json'));
    const pk = path.join(process.env.LOCALAPPDATA || '', 'Packages');
    try { for (const d of fs.readdirSync(pk)) if (/^Claude_|AnthropicPBC/i.test(d)) c.push(path.join(pk, d, 'LocalCache', 'Roaming', 'Claude', 'claude_desktop_config.json')); } catch {}
  } else if (process.platform === 'darwin') {
    c.push(path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'));
  } else {
    c.push(path.join(os.homedir(), '.config', 'Claude', 'claude_desktop_config.json'));
  }
  const found = [...new Set([...c.filter(f => fs.existsSync(f)), ...findConfigs()])];
  let cfgPath;
  if (found.length === 1) cfgPath = found[0];
  else if (found.length > 1) cfgPath = await vscode.window.showQuickPick(found, { placeHolder: 'Which Claude Desktop config should I update?' });
  else {
    const pick = await vscode.window.showOpenDialog({ canSelectMany: false, defaultUri: vscode.Uri.file(process.env.LOCALAPPDATA || process.env.APPDATA || os.homedir()), filters: { JSON: ['json'] }, title: 'Select claude_desktop_config.json (the file must have exactly this name)' });
    cfgPath = pick && pick[0] && pick[0].fsPath;
  }
  if (!cfgPath) return;
  if (path.basename(cfgPath).toLowerCase() !== 'claude_desktop_config.json') {
    return vscode.window.showErrorMessage('That file is not claude_desktop_config.json, so nothing was changed: ' + cfgPath);
  }
  const ok = await vscode.window.showInformationMessage('Add the MCP Bridge entry to this file? ' + cfgPath, { modal: true }, 'Update');
  if (ok !== 'Update') return;
  let conf = {};
  const raw = fs.readFileSync(cfgPath, 'utf8');
  if (raw.trim()) {
    try { conf = JSON.parse(raw); } catch { return vscode.window.showErrorMessage('That config is not valid JSON. Fix it first: ' + cfgPath); }
  }
  fs.copyFileSync(cfgPath, cfgPath + '.bak');
  conf.mcpServers = conf.mcpServers || {};
  conf.mcpServers['vscode-bridge'] = { command: 'node', args: [shim] };
  fs.writeFileSync(cfgPath, JSON.stringify(conf, null, 2));
  vscode.window.showInformationMessage('Connected (backup saved as .bak). Fully quit and reopen Claude Desktop.');
}

async function disconnectClaudeDesktop() {
  const hits = [];
  const foreign = [];
  for (const f of findConfigs()) {
    try {
      const conf = JSON.parse(fs.readFileSync(f, 'utf8'));
      const e = conf.mcpServers && conf.mcpServers[claudeConfig.NAME];
      if (!e) continue;
      (claudeConfig.isOurEntry(e) ? hits : foreign).push({ f, conf });
    } catch {}
  }
  if (!hits.length) {
    return foreign.length
      ? vscode.window.showWarningMessage('A vscode-bridge entry exists but does not point to MCP Bridge, so I left it alone: ' + foreign.map(h => h.f).join(', '))
      : vscode.window.showInformationMessage('No Claude Desktop config with an MCP Bridge entry was found. Nothing to disconnect.');
  }
  let target = hits[0];
  if (hits.length > 1) {
    const pick = await vscode.window.showQuickPick(hits.map(h => h.f), { placeHolder: 'Which Claude Desktop config should I remove the entry from?' });
    if (!pick) return;
    target = hits.find(h => h.f === pick);
  }
  const ok = await vscode.window.showInformationMessage('Remove the MCP Bridge entry from this Claude Desktop config? ' + target.f, { modal: true }, 'Remove');
  if (ok !== 'Remove') return;
  fs.copyFileSync(target.f, target.f + '.bak');
  fs.writeFileSync(target.f, JSON.stringify(claudeConfig.removeOurEntry(target.conf).conf, null, 2));
  safety.audit({ tool: '(user)', args: {}, ok: true, note: 'disconnected from Claude Desktop config' });
  vscode.window.showInformationMessage('Disconnected (backup saved as .bak). Fully quit and reopen Claude Desktop. To remove MCP Bridge completely, also uninstall the extension and delete the .mcp-bridge folder in your home folder.');
}

function activate(ctx) {
  out = vscode.window.createOutputChannel('MCP Bridge');
  statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusItem.tooltip = 'MCP Bridge is running. Click to pause or resume AI access.';
  statusItem.command = 'mcpBridge.togglePause';
  statusItem.text = idleText();
  statusItem.show();
  started = Date.now();
  focusedAt = vscode.window.state.focused ? Date.now() : 0;

  if (!vscode.workspace.isTrusted) {
    vscode.window.showWarningMessage('MCP Bridge is paused: this window is in Restricted Mode. Trust the workspace to let an AI assistant use VS Code tools here.', 'Trust Workspace')
      .then(c => { if (c) vscode.commands.executeCommand('workbench.trust.manage'); });
  }

  try {
    fs.mkdirSync(WIN_DIR, { recursive: true });
    installShim(ctx);
    fs.writeFileSync(TOOLS, JSON.stringify(manifest()));
    fs.writeFileSync(INSTR, buildInstructions());
  } catch (e) { log('setup failed: ' + e.message); }

  const server = http.createServer((req, res) => handle(req, res).catch(() => { try { res.writeHead(500); res.end(); } catch {} }));
  server.on('error', e => log('server error: ' + e.message));
  server.listen(0, '127.0.0.1', () => { port = server.address().port; publish(); log('listening on ' + port); });

  const sweep = setInterval(() => {
    const ms = cfg().get('idleMinutes', 30) * 60000;
    for (const [k, e] of terms) if (!e.running && Date.now() - e.last > ms) { e.t.dispose(); terms.delete(k); }
  }, 60000);

  ctx.subscriptions.push(
    out, statusItem, { dispose: () => server.close() }, { dispose: () => clearInterval(sweep) },
    vscode.window.onDidChangeWindowState(s => { if (s.focused) { focusedAt = Date.now(); publish(); } }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => publish()),
    vscode.workspace.onDidGrantWorkspaceTrust(() => {
      statusItem.text = idleText();
      publish();
      vscode.window.showInformationMessage('Workspace trusted. MCP Bridge tools are now enabled.');
    }),
    vscode.window.onDidCloseTerminal(t => { for (const [k, e] of terms) if (e.t === t) terms.delete(k); }),
    vscode.commands.registerCommand('mcpBridge.connectClaudeDesktop', () => connectClaudeDesktop(ctx)),
    vscode.commands.registerCommand('mcpBridge.disconnectClaudeDesktop', () => disconnectClaudeDesktop()),
    vscode.commands.registerCommand('mcpBridge.showLog', () => out.show()),
    vscode.commands.registerCommand('mcpBridge.showAuditLog', () => safety.openAudit(vscode)),
    vscode.commands.registerCommand('mcpBridge.togglePause', () => {
      paused = !paused;
      statusItem.text = idleText();
      publish();
      safety.audit({ tool: '(user)', args: {}, ok: true, note: paused ? 'paused' : 'resumed' });
      vscode.window.showInformationMessage(paused ? 'MCP Bridge paused: the AI cannot use VS Code tools until you resume (click the status bar item again).' : 'MCP Bridge resumed.');
    }),
  );
}
function deactivate() {
  try { fs.unlinkSync(WIN_FILE); } catch {}
}
module.exports = { activate, deactivate };
