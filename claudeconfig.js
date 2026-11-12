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

module.exports = { NAME, isOurEntry, removeOurEntry };
