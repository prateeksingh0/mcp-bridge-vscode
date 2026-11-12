'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { searchText } = require('../search');

function makeTree() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-search-'));
  fs.writeFileSync(path.join(dir, 'a.txt'), 'hello world\nFoo bar\n');
  fs.mkdirSync(path.join(dir, 'sub'));
  fs.writeFileSync(path.join(dir, 'sub', 'b.py'), 'def hello():\n    pass\n');
  fs.mkdirSync(path.join(dir, 'node_modules'));
  fs.writeFileSync(path.join(dir, 'node_modules', 'x.js'), 'hello from a dependency\n');
  fs.writeFileSync(path.join(dir, 'bin.dat'), Buffer.concat([Buffer.from('hello'), Buffer.from([0, 1, 2])]));
  return dir;
}
const names = (dir, lines) => lines.map(l => path.relative(dir, /^(.*?):(\d+): /.exec(l)[1]).split(path.sep).join('/'));

test('literal search finds matches and skips ignored folders and binary files', () => {
  const dir = makeTree();
  try {
    const r = searchText({ base: dir, query: 'hello' });
    assert.deepEqual(names(dir, r).sort(), ['a.txt', 'sub/b.py']);
    assert.match(r[0], /:1: hello world$/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('ignoreCase, regex and glob options work', () => {
  const dir = makeTree();
  try {
    assert.equal(searchText({ base: dir, query: 'FOO' }).length, 0);
    assert.equal(searchText({ base: dir, query: 'FOO', ignoreCase: true }).length, 1);
    assert.equal(searchText({ base: dir, query: 'def \\w+', regex: true }).length, 1);
    assert.deepEqual(names(dir, searchText({ base: dir, query: 'hello', glob: '*.py' })), ['sub/b.py']);
    assert.deepEqual(names(dir, searchText({ base: dir, query: 'hello', glob: 'sub/*.py' })), ['sub/b.py']);
    assert.deepEqual(names(dir, searchText({ base: dir, query: 'hello', glob: '**/*.txt' })), ['a.txt']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('max limits the number of results and a bad regex is reported', () => {
  const dir = makeTree();
  try {
    assert.equal(searchText({ base: dir, query: 'hello', max: 1 }).length, 1);
    assert.throws(() => searchText({ base: dir, query: '(', regex: true }), /Invalid regex/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a single file can be searched directly', () => {
  const dir = makeTree();
  try {
    const r = searchText({ base: path.join(dir, 'a.txt'), query: 'bar' });
    assert.equal(r.length, 1);
    assert.match(r[0], /:2: Foo bar$/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
