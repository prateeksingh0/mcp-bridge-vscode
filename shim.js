#!/usr/bin/env node
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const DIR = path.join(os.homedir(), '.mcp-bridge');
const WIN_DIR = path.join(DIR, 'windows');
const TOOLS = path.join(DIR, 'tools.json');
const INSTR = path.join(DIR, 'instructions.txt');
const VERSION = '0.3.0';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const pending = new Set(); // requests that are still being handled
const byFocus = (a, b) => (b.focusedAt || 0) - (a.focusedAt || 0);

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}
function windows() {
  let files;
  try { files = fs.readdirSync(WIN_DIR); } catch { return []; }
  const res = [];
  for (const f of files) {
    const p = path.join(WIN_DIR, f);
    try {
      const w = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (!alive(w.pid)) { try { fs.unlinkSync(p); } catch {} continue; }
      res.push(w);
    } catch {}
  }
  return res.sort(byFocus);
}
const describe = ws => ws.map((w, i) =>
  (i === 0 ? '* ' : '  ') + 'pid ' + w.pid + ' | ' + (w.folders.length ? w.folders.join(', ') : '(no folder open)') + (w.trusted ? '' : ' | RESTRICTED MODE') + (w.paused ? ' | PAUSED' : '')).join('\n');

function pick(target) {
  const ws = windows();
  if (!ws.length) return { none: true };
  if (!target) return { w: ws[0], count: ws.length };
  const t = String(target).toLowerCase();
  const m = ws.filter(w => String(w.pid) === t || w.folders.some(f => f.toLowerCase().includes(t)));
  if (m.length) return { w: m[0], count: ws.length };
  return { error: 'No VS Code window matches "' + target + '". Open windows (* = default):\n' + describe(ws) };
}

function request(w, method, route, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({
      host: '127.0.0.1', port: w.port, path: route, method,
      headers: { 'X-Token': w.token, 'Content-Type': 'application/json', ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) },
    }, res => {
      let b = '';
      res.setEncoding('utf8');
      res.on('data', c => (b += c));
      res.on('end', () => { try { resolve(JSON.parse(b)); } catch { reject(new Error('bad-response')); } });
    });
    req.on('error', reject);
    if (timeoutMs) req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')));
    if (data) req.write(data);
    req.end();
  });
}
const ping = w => request(w, 'GET', '/ping', null, 2000).then(() => true, () => false);

let launching = null;
function launchVsCode() {
  if (!launching) {
    launching = (async () => {
      try {
        // Inside VS Code's own runtime, start VS Code itself (no "code" command needed).
        // The variable that makes VS Code behave like Node must not be passed on, or the new process would just exit.
        const env = { ...process.env };
        delete env.ELECTRON_RUN_AS_NODE;
        const viaElectron = !!process.versions.electron;
        const launchCommand = viaElectron ? process.execPath : 'code';
        spawn(launchCommand, [], { shell: !viaElectron, detached: true, stdio: 'ignore', windowsHide: true, env }).unref();
      } catch {}
      for (let i = 0; i < 80; i++) {
        await sleep(500);
        const ws = windows();
        if (ws.length && (await ping(ws[0]))) return;
      }
    })().finally(() => { launching = null; });
  }
  return launching;
}

const TARGET_PROP = { type: 'string', description: 'Optional. Folder path (or part of it) or pid of the VS Code window to act in. Default: the most recently focused window. See list_windows.' };
const LIST_WINDOWS = {
  name: 'list_windows',
  description: 'List open VS Code windows (pid, folders, trust state). * marks the default window.',
  inputSchema: { type: 'object', properties: {}, required: [] },
  annotations: { title: 'list windows', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
};

async function listTools() {
  let tools = null;
  const s = pick(null);
  if (s.w) { try { tools = (await request(s.w, 'GET', '/tools', null, 3000)).tools; } catch {} }
  if (!tools) { try { tools = JSON.parse(fs.readFileSync(TOOLS, 'utf8')); } catch { tools = []; } }
  return [LIST_WINDOWS, ...tools.map(t => ({ ...t, inputSchema: { ...t.inputSchema, properties: { ...(t.inputSchema.properties || {}), target: TARGET_PROP } } }))];
}

const fail = text => ({ content: [{ type: 'text', text }], isError: true });

async function callTool(name, args) {
  args = { ...(args || {}) };
  const target = args.target;
  delete args.target;
  if (name === 'list_windows') {
    const ws = windows();
    return { content: [{ type: 'text', text: ws.length ? describe(ws) : 'No VS Code windows are open.' }] };
  }
  try {
    let sel = pick(target);
    if (sel.none) { await launchVsCode(); sel = pick(target); }
    if (sel.none) return fail('VS Code did not start in time. Open VS Code (with the MCP Bridge extension installed) and try again.');
    if (sel.error) return fail(sel.error);
    const r = await request(sel.w, 'POST', '/call', { name, arguments: args });
    let text = String(r.text);
    if (sel.count > 1 && !target) {
      text += '\n\n[Handled by window: ' + (sel.w.folders.join(', ') || '(no folder)') + ' | ' + sel.count + ' windows open. Use target to choose, or call list_windows.]';
    }
    return { content: [{ type: 'text', text }], isError: !!r.isError };
  } catch (e) {
    return fail('Could not reach VS Code (' + e.message + '). Make sure the MCP Bridge extension is installed and the window is open.');
  }
}

const send = m => process.stdout.write(JSON.stringify(m) + '\n');

async function handle(msg) {
  const { id, method, params } = msg;
  const reply = result => id !== undefined && send({ jsonrpc: '2.0', id, result });
  const error = (code, message) => id !== undefined && send({ jsonrpc: '2.0', id, error: { code, message } });
  try {
    switch (method) {
      case 'initialize': {
        try { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(path.join(DIR, 'client.json'), JSON.stringify(params || {}, null, 2)); } catch {}
        let instructions = '';
        try { instructions = fs.readFileSync(INSTR, 'utf8'); } catch {}
        return reply({
          protocolVersion: (params && params.protocolVersion) || '2025-03-26',
          capabilities: { tools: {} },
          serverInfo: { name: 'vscode-bridge', version: VERSION },
          ...(instructions ? { instructions } : {}),
        });
      }
      case 'ping': return reply({});
      case 'tools/list': return reply({ tools: await listTools() });
      case 'tools/call': return reply(await callTool(params.name, params.arguments));
      case 'resources/list': return reply({ resources: [] });
      case 'resources/templates/list': return reply({ resourceTemplates: [] });
      case 'prompts/list': return reply({ prompts: [] });
      default: if (id !== undefined) return error(-32601, 'Method not found: ' + method);
    }
  } catch (e) { error(-32603, String((e && e.message) || e)); }
}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    try { const p = handle(JSON.parse(line)); pending.add(p); p.finally(() => pending.delete(p)); } catch (e) { console.error('bad message', e.message); }
  }
});
process.stdin.on('end', () => { Promise.allSettled([...pending]).then(() => process.exit(0)); });
