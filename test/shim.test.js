'use strict';
// Runs the real shim as a child process and speaks MCP to it over stdio.
// It uses a temporary home folder, so it never touches the real ~/.mcp-bridge.
// This also runs in CI on Windows, macOS and Linux.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const shim = path.join(__dirname, '..', 'shim.js');

function runShim(messages) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-shim-'));
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [shim], {
      env: { ...process.env, HOME: home, USERPROFILE: home },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('shim did not exit in time')); }, 15000);
    child.stdout.on('data', d => { out += d; });
    child.on('error', reject);
    child.on('close', code => {
      clearTimeout(timer);
      fs.rmSync(home, { recursive: true, force: true });
      resolve({ code, replies: out.split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l)) });
    });
    for (const m of messages) child.stdin.write(JSON.stringify(m) + '\n');
    child.stdin.end(); // the shim must still answer everything already sent, then exit
  });
}

const byId = (replies, id) => replies.find(r => r.id === id);

test('the shim answers initialize, tools/list and ping, then exits when input ends', async () => {
  const { code, replies } = await runShim([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'ping' },
  ]);
  assert.equal(code, 0);
  assert.equal(byId(replies, 1).result.serverInfo.name, 'vscode-bridge');
  assert.equal(byId(replies, 1).result.protocolVersion, '2025-03-26');
  const names = byId(replies, 2).result.tools.map(t => t.name);
  assert.ok(names.includes('list_windows'));
  assert.deepEqual(byId(replies, 3).result, {});
});

test('list_windows says so when no VS Code window is open', async () => {
  const { replies } = await runShim([
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_windows', arguments: {} } },
  ]);
  assert.match(byId(replies, 1).result.content[0].text, /No VS Code windows are open/);
});

test('an unknown method is answered with an error, and notifications get no reply', async () => {
  const { replies } = await runShim([
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 7, method: 'no/such/method' },
  ]);
  assert.equal(replies.length, 1);
  assert.equal(byId(replies, 7).error.code, -32601);
});
