'use strict';
// Guard: the key rules must stay inside the tool descriptions, because Claude always sees descriptions
// even if the client does not pass the server instructions along.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'extension.js'), 'utf8');

function descriptionOf(name) {
  const m = new RegExp("tool\\('" + name + "', '([^']*)'").exec(src);
  assert.ok(m, 'could not find the description line of tool ' + name);
  return m[1];
}

const required = {
  write_file: /list_session_files/,
  append_file: /list_session_files/,
  create_dir: /list_session_files/,
  copy_path: /list_session_files/,
  python_create_venv: /list_session_files/,
  terminal_run: /Never run commands any other way/,
  read_file: /Do not read secrets/,
  open_folder: /Do not open new windows/,
  get_workspace: /get_instructions/,
};

for (const [name, re] of Object.entries(required)) {
  test('the ' + name + ' description carries its rule', () => {
    assert.match(descriptionOf(name), re);
  });
}

test('the session cleanup and instruction tools exist', () => {
  for (const name of ['list_session_files', 'cleanup_session', 'get_instructions']) {
    assert.ok(src.includes("tool('" + name + "'"), name + ' is missing');
  }
});

test('the instructions contain the delivery check phrase', () => {
  assert.ok(src.includes('copper-lantern-4821'));
});
