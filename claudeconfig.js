'use strict';
// Pure helpers for editing a Claude Desktop config. No vscode dependency, so they can be unit-tested.
const NAME = 'vscode-bridge';

// True only if an mcpServers entry launches this extension's shim (~/.mcp-bridge/shim.js).
// An entry that merely has the same name but points somewhere else is NOT ours.
function isOurEntry(entry) {
  const arg = String((entry && entry.args && entry.args[0]) || '');
  return arg.split('\\').join('/').toLowerCase().endsWith('/.mcp-bridge/shim.js');
}

// Returns { conf, removed }. Removes only our entry and leaves every other key untouched.
function removeOurEntry(conf) {
  const servers = conf && conf.mcpServers;
  if (!servers || !servers[NAME] || !isOurEntry(servers[NAME])) return { conf, removed: false };
  const rest = { ...servers };
  delete rest[NAME];
  return { conf: { ...conf, mcpServers: rest }, removed: true };
}

// The Claude Desktop entry that launches the shim.
//  - 'vscode': run the shim with VS Code's own bundled runtime, so no Node.js install is needed
//  - 'node':   run it with the node program found on PATH
function makeEntry({ runtime, execPath, shimPath }) {
  if (runtime === 'node' || !execPath) return { command: 'node', args: [shimPath] };
  return { command: execPath, args: [shimPath], env: { ELECTRON_RUN_AS_NODE: '1' } };
}

// True if the entry runs a program by full path and that program no longer exists
// (for example after VS Code was moved or reinstalled elsewhere).
function isStaleEntry(entry, exists) {
  const cmd = entry && entry.command;
  if (!cmd) return false;
  if (!cmd.includes('/') && !cmd.includes(String.fromCharCode(92))) return false; // a bare command such as node
  return !exists(cmd);
}

module.exports = { NAME, isOurEntry, removeOurEntry, makeEntry, isStaleEntry };
