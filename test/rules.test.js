'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { userRulesLines } = require('../rules');

test('an empty setting adds nothing', () => {
  assert.deepEqual(userRulesLines(''), []);
  assert.deepEqual(userRulesLines('   \n  '), []);
  assert.deepEqual(userRulesLines(undefined), []);
});

test('each line becomes a bullet under a clear heading', () => {
  const out = userRulesLines('Always ask before git push\n- Use pnpm, not npm\n\n');
  assert.equal(out[0], '');
  assert.match(out[1], /^USER RULES/);
  assert.deepEqual(out.slice(2), ['- Always ask before git push', '- Use pnpm, not npm']);
});

test('control characters are removed', () => {
  const bell = String.fromCharCode(7);
  assert.deepEqual(userRulesLines('say' + bell + ' hi').slice(2), ['- say hi']);
});

test('the number and length of rules are capped', () => {
  const many = Array.from({ length: 40 }, (_, i) => 'rule ' + i).join('\n');
  assert.equal(userRulesLines(many).length, 2 + 30);
  const long = userRulesLines('x'.repeat(1000)).slice(2)[0];
  assert.ok(long.length <= 302);
});

test('the heading says user rules cannot switch off protections', () => {
  assert.match(userRulesLines('anything')[1], /cannot switch off approvals or protections/);
});
