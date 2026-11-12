'use strict';
// Display settings that VS Code needs to open a window on Linux.
// Claude Desktop starts the shim with a trimmed environment that lacks them, so when the shim has to start
// VS Code it borrows them from elsewhere. Pure functions, so they can be unit-tested on any system.

const KEYS = ['DISPLAY', 'WAYLAND_DISPLAY', 'XAUTHORITY', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS', 'XDG_SESSION_TYPE'];

// The display variables found in an environment object.
function pickDisplayVars(env) {
  const out = {};
  for (const k of KEYS) if (env && env[k]) out[k] = env[k];
  return out;
}

// Parses the contents of /proc/<pid>/environ (KEY=VALUE entries separated by NUL characters).
function parseEnviron(text) {
  const env = {};
  for (const part of String(text || '').split(String.fromCharCode(0))) {
    const i = part.indexOf('=');
    if (i > 0) env[part.slice(0, i)] = part.slice(i + 1);
  }
  return env;
}

// The variables to add when launching VS Code: only the ones missing from `env`.
// Sources, in order: the file the extension saved, the parent process (Claude Desktop), then safe defaults.
function displayEnvToAdd({ env, saved, parentEnv, uid, exists }) {
  const have = pickDisplayVars(env);
  const add = {};
  for (const src of [saved, parentEnv]) {
    const p = pickDisplayVars(src);
    for (const k of Object.keys(p)) if (!have[k] && !add[k]) add[k] = p[k];
  }
  const now = k => have[k] || add[k];
  if (!now('XDG_RUNTIME_DIR') && uid !== null && uid !== undefined) add.XDG_RUNTIME_DIR = '/run/user/' + uid;
  const rt = now('XDG_RUNTIME_DIR');
  if (!now('DISPLAY') && !now('WAYLAND_DISPLAY')) {
    if (rt && exists && exists(rt + '/wayland-0')) add.WAYLAND_DISPLAY = 'wayland-0';
    add.DISPLAY = ':0'; // X11 / XWayland fallback
  }
  if (!now('DBUS_SESSION_BUS_ADDRESS') && rt && exists && exists(rt + '/bus')) {
    add.DBUS_SESSION_BUS_ADDRESS = 'unix:path=' + rt + '/bus';
  }
  return add;
}

module.exports = { KEYS, pickDisplayVars, parseEnviron, displayEnvToAdd };
