'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { redact, isProtected, summarize } = require('../safety');

// Fake secrets are built at runtime so this file never contains real-looking credentials.
const fake = {
  aws: 'AKIA' + 'B'.repeat(16),
  github: 'ghp_' + 'a'.repeat(36),
  openai: 'sk-' + 'c'.repeat(24),
  slack: 'xoxb-' + '1234567890' + '-abcdef',
  jwt: 'eyJ' + 'a'.repeat(10) + '.eyJ' + 'b'.repeat(10) + '.' + 'c'.repeat(10),
  key: '-----BEGIN ' + 'RSA PRIVATE KEY-----\nMIIabc123\n-----END ' + 'RSA PRIVATE KEY-----',
};

test('redact masks known token formats', () => {
  for (const [name, value] of Object.entries(fake)) {
    const out = redact('before ' + value + ' after');
    assert.ok(!out.includes(value), name + ' should be redacted');
    assert.match(out, /\[REDACTED/, name + ' should leave a marker');
  }
});

test('redact masks key=value style secrets but keeps the key', () => {
  assert.equal(redact('password = "hunter2hunter2"'), 'password = "[REDACTED]"');
  assert.equal(redact('{"api_key": "abcd1234efgh"}'), '{"api_key": "[REDACTED]"}');
  assert.equal(redact('TOKEN=abcdefgh12345'), 'TOKEN=[REDACTED]');
});

test('redact leaves normal code and env references alone', () => {
  const samples = [
    'token = process.env.API_TOKEN',
    'password = os.environ["DB_PASSWORD"]',
    'const tokenizer = new Tokenizer()',
    'secret = $SECRET_VALUE',
    'just some normal text',
  ];
  for (const s of samples) assert.equal(redact(s), s);
});

test('isProtected flags credential locations', () => {
  const yes = [
    'C:\\Users\\me\\.ssh\\id_rsa',
    '/home/me/.aws/credentials',
    'C:\\proj\\.env',
    'C:\\proj\\.env.production',
    'C:\\proj\\server.pem',
    'C:\\Users\\me\\.mcp-bridge\\windows\\123.json',
    '/home/me/.config/gcloud/application_default_credentials.json',
    'C:\\x\\claude_desktop_config.json',
  ];
  for (const p of yes) assert.equal(isProtected(p), true, p + ' should be protected');
});

test('isProtected allows ordinary files', () => {
  const no = [
    'C:\\proj\\src\\main.py',
    'C:\\proj\\.env.example',
    'C:\\proj\\src\\credentials.py',
    'C:\\Users\\me\\.mcp-bridge\\client.json',
    '/home/me/project/README.md',
  ];
  for (const p of no) assert.equal(isProtected(p), false, p + ' should be allowed');
});

test('isProtected honours user patterns', () => {
  assert.equal(isProtected('C:\\proj\\secrets\\a.txt', ['secrets']), true);
  assert.equal(isProtected('C:\\proj\\notes\\a.txt', ['secrets']), false);
  assert.equal(isProtected('C:\\proj\\prod-config.yml', ['prod-*.yml']), true);
});

test('summarize hides big fields, approval ids and secrets', () => {
  const s = summarize('write_file', {
    path: 'a.txt',
    content: 'x'.repeat(1000),
    approval_id: 'abc123',
    note: 'password = "hunter2hunter2"',
  });
  assert.equal(s.path, 'a.txt');
  assert.equal(s.content, '[1000 chars]');
  assert.equal(s.approval_id, '(used)');
  assert.ok(!s.note.includes('hunter2hunter2'));
});
