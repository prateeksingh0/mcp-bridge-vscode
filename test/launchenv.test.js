'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { pickDisplayVars, parseEnviron, displayEnvToAdd } = require('../launchenv');

const NUL = String.fromCharCode(0);

test('pickDisplayVars keeps only the display settings', () => {
  const env = { PATH: '/usr/bin', DISPLAY: ':0', WAYLAND_DISPLAY: 'wayland-0', HOME: '/home/me', XDG_RUNTIME_DIR: '/run/user/1000' };
  assert.deepEqual(pickDisplayVars(env), { DISPLAY: ':0', WAYLAND_DISPLAY: 'wayland-0', XDG_RUNTIME_DIR: '/run/user/1000' });
  assert.deepEqual(pickDisplayVars(undefined), {});
});

test('parseEnviron reads NUL separated entries', () => {
  const text = 'DISPLAY=:0' + NUL + 'HOME=/home/me' + NUL + 'EMPTY=' + NUL + 'WITH_EQUALS=a=b' + NUL;
  assert.deepEqual(parseEnviron(text), { DISPLAY: ':0', HOME: '/home/me', EMPTY: '', WITH_EQUALS: 'a=b' });
  assert.deepEqual(parseEnviron(''), {});
});

test('nothing is added when the environment already has a display', () => {
  const add = displayEnvToAdd({ env: { DISPLAY: ':1', XDG_RUNTIME_DIR: '/run/user/1000' }, saved: { DISPLAY: ':0' }, parentEnv: {}, uid: 1000, exists: () => false });
  assert.equal(add.DISPLAY, undefined);
  assert.equal(add.WAYLAND_DISPLAY, undefined);
});

test('the saved settings are used first, then the parent process', () => {
  const add = displayEnvToAdd({
    env: {},
    saved: { WAYLAND_DISPLAY: 'wayland-0', XDG_RUNTIME_DIR: '/run/user/1000' },
    parentEnv: { WAYLAND_DISPLAY: 'wayland-9', DISPLAY: ':0', XAUTHORITY: '/run/user/1000/xauth' },
    uid: 1000,
    exists: () => false,
  });
  assert.equal(add.WAYLAND_DISPLAY, 'wayland-0'); // saved wins over the parent
  assert.equal(add.DISPLAY, ':0'); // missing from saved, taken from the parent
  assert.equal(add.XAUTHORITY, '/run/user/1000/xauth');
  assert.equal(add.XDG_RUNTIME_DIR, '/run/user/1000');
});

test('safe defaults are used when nothing else knows the display', () => {
  const sockets = ['/run/user/1000/wayland-0', '/run/user/1000/bus'];
  const add = displayEnvToAdd({ env: {}, saved: {}, parentEnv: {}, uid: 1000, exists: p => sockets.includes(p) });
  assert.deepEqual(add, {
    XDG_RUNTIME_DIR: '/run/user/1000',
    WAYLAND_DISPLAY: 'wayland-0',
    DISPLAY: ':0',
    DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus',
  });
});

test('without sockets the defaults still provide an X11 display', () => {
  const add = displayEnvToAdd({ env: {}, saved: {}, parentEnv: {}, uid: 1000, exists: () => false });
  assert.deepEqual(add, { XDG_RUNTIME_DIR: '/run/user/1000', DISPLAY: ':0' });
});

test('existing values are never overridden', () => {
  const add = displayEnvToAdd({ env: { XDG_RUNTIME_DIR: '/run/user/42', WAYLAND_DISPLAY: 'wayland-1' }, saved: { XDG_RUNTIME_DIR: '/run/user/1000', WAYLAND_DISPLAY: 'wayland-0' }, parentEnv: {}, uid: 1000, exists: () => false });
  assert.equal(add.XDG_RUNTIME_DIR, undefined);
  assert.equal(add.WAYLAND_DISPLAY, undefined);
});
