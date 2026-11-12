'use strict';
// Safety helpers: secret redaction, protected paths, audit log.
// This module has no dependency on the vscode API so it can be unit-tested with plain Node.
const fs = require('fs');
const os = require('os');
const path = require('path');

const DIR = path.join(os.homedir(), '.mcp-bridge');
const AUDIT = path.join(DIR, 'audit.log');
const MAX_AUDIT = 5 * 1024 * 1024;

// ---------- secret redaction ----------
// A heuristic: it masks well-known token formats and "name = value" style secrets.
// It can miss unusual secrets and can mask harmless values, so it is a safety net, not a guarantee.
const SECRET_PATTERNS = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[REDACTED PRIVATE KEY]'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED AWS KEY]'],
  [/\bgh[pousr]_[A-Za-z0-9]{36,}\b/g, '[REDACTED GITHUB TOKEN]'],
  [/\bgithub_pat_[A-Za-z0-9_]{50,}\b/g, '[REDACTED GITHUB TOKEN]'],
  [/\bglpat-[A-Za-z0-9_-]{20,}/g, '[REDACTED GITLAB TOKEN]'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}/g, '[REDACTED SLACK TOKEN]'],
  [/\bAIza[0-9A-Za-z_-]{35}\b/g, '[REDACTED GOOGLE API KEY]'],
  [/\b[sr]k_live_[0-9A-Za-z]{16,}\b/g, '[REDACTED STRIPE KEY]'],
  [/\bnpm_[A-Za-z0-9]{36}\b/g, '[REDACTED NPM TOKEN]'],
  [/\bsk-[A-Za-z0-9_-]{20,}/g, '[REDACTED API KEY]'],
  [/\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '[REDACTED JWT]'],
  [/\b(Bearer\s+)[A-Za-z0-9._~+/-]{20,}=*/gi, '$1[REDACTED]'],
  [/([a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:)[^\s@/]+(@)/gi, '$1[REDACTED]$2'],
  [/((?:api[_-]?key|secret|token|passw(?:or)?d|pwd)["']?\s*[:=]\s*["']?)(?!process\.env|os\.environ|getenv|\$|<|\[REDACTED)[^\s"',;]{8,}/gi, '$1[REDACTED]'],
];

function redact(text) {
  let out = String(text);
  for (const [re, rep] of SECRET_PATTERNS) out = out.replace(re, rep);
  return out;
}

// ---------- protected paths ----------
const PROTECTED_DIRS = ['.ssh', '.aws', '.gnupg', '.kube', '.azure'];
const PROTECTED_FILE = /^(\.env(\.(?!example$|sample$|template$).+)?|\.npmrc|\.pypirc|\.netrc|id_rsa.*|id_ed25519.*|id_ecdsa.*|.*\.(pem|key|pfx|p12|kdbx)|credentials(\.(json|ya?ml|xml|csv|ini|txt))?|claude_desktop_config\.json)$/i;

function globToRe(g) {
  return new RegExp('^' + g.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$', 'i');
}

function isProtected(absPath, extra) {
  const norm = String(absPath).replace(/\\/g, '/');
  const parts = norm.split('/');
  const base = parts[parts.length - 1];
  if (parts.some(p => PROTECTED_DIRS.includes(p.toLowerCase()))) return true;
  if (PROTECTED_FILE.test(base)) return true;
  if (/\/\.mcp-bridge\/windows(\/|$)/i.test(norm)) return true;
  if (/\/\.config\/gcloud(\/|$)/i.test(norm)) return true;
  for (const g of extra || []) {
    if (!g) continue;
    const gn = String(g).replace(/\\/g, '/');
    if (globToRe(gn).test(norm) || globToRe('*' + gn + '*').test(norm)) return true;
  }
  return false;
}

// Best-effort check of a shell command for obvious references to protected files.
// Returns the first offending token, or null. It cannot catch everything (variables, wildcards,
// built-up strings), so it is a safety net and not a sandbox.
function commandTouchesProtected(command, extra) {
  const home = os.homedir();
  const expand = t => t
    .replace(/^~(?=$|[\\/])/, home)
    .replace(/^(\$HOME|\$env:USERPROFILE|%USERPROFILE%)/i, home);
  const looksLikePath = t => /[\\/~$]/.test(t) || t.includes('.');
  const tokens = String(command || '')
    .split(/[\s;|&<>()`]+/)
    .map(t => t.replace(/^['"@]+|['"]+$/g, ''))
    .filter(Boolean);
  for (const t of tokens) {
    const candidates = [t];
    const eq = t.indexOf('=');
    if (eq > 0) candidates.push(t.slice(eq + 1).replace(/^['"@]+|['"]+$/g, ''));
    for (const c of candidates) {
      if (c && looksLikePath(c) && isProtected(expand(c), extra)) return t;
    }
  }
  return null;
}

// ---------- audit log ----------
function audit(entry) {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    try { if (fs.statSync(AUDIT).size > MAX_AUDIT) fs.renameSync(AUDIT, AUDIT + '.1'); } catch {}
    fs.appendFileSync(AUDIT, JSON.stringify({ t: new Date().toISOString(), ...entry }) + '\n');
  } catch {}
}

// Short, redacted description of a call's arguments. Big or sensitive fields are logged as sizes only.
function summarize(name, args) {
  const out = {};
  for (const [k, v] of Object.entries(args || {})) {
    if (k === 'approval_id') { out[k] = '(used)'; continue; }
    if (['content', 'old', 'new', 'value', 'edits', 'calls'].includes(k)) {
      out[k] = '[' + (typeof v === 'string' ? v.length : JSON.stringify(v).length) + ' chars]';
      continue;
    }
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    out[k] = redact(s.length > 300 ? s.slice(0, 300) + '...' : s);
  }
  return out;
}

async function openAudit(vscode) {
  fs.mkdirSync(DIR, { recursive: true });
  if (!fs.existsSync(AUDIT)) fs.writeFileSync(AUDIT, '');
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(AUDIT));
  await vscode.window.showTextDocument(doc);
}

module.exports = { redact, isProtected, commandTouchesProtected, audit, summarize, openAudit, AUDIT };
