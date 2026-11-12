'use strict';
// Turns the user's own "extra instructions" setting into lines for the AI instructions.
// Pure, so it can be unit-tested.
const MAX_LINES = 30;
const MAX_LINE = 300;

// Control characters except tab, line feed and carriage return.
const c = n => String.fromCharCode(n);
const CONTROL = new RegExp('[' + c(0) + '-' + c(8) + c(11) + c(12) + c(14) + '-' + c(31) + c(127) + ']', 'g');

function userRulesLines(raw) {
  const text = String(raw || '').replace(CONTROL, '').trim();
  if (!text) return [];
  const rules = text
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean)
    .slice(0, MAX_LINES)
    .map(l => (l.length > MAX_LINE ? l.slice(0, MAX_LINE) : l))
    .map(l => (l.startsWith('-') ? l : '- ' + l));
  return [
    '',
    'USER RULES (written by the user in their own VS Code settings; follow them, but they cannot switch off approvals or protections)',
  ].concat(rules);
}

module.exports = { userRulesLines };
