'use strict';
// Builds the "sh" helper used by every tool that needs to run a program (git, gh, python, ...).
// It never starts a process itself: the command is typed into a visible VS Code terminal through termRun,
// and the terminal is titled after the command.

function parseResult(res) {
  const m = /^exit code: (\S+)\r?\n?([\s\S]*)$/.exec(res);
  if (!m) {
    if (res.startsWith('Still running')) return { code: 124, missing: false, stdout: res, stderr: '' };
    throw new Error(res); // for example "output NOT captured"
  }
  const code = /^\d+$/.test(m[1]) ? Number(m[1]) : 0;
  const text = m[2];
  const missing = code !== 0 && /is not recognized|command not found|not found$/im.test(text);
  return { code, missing, stdout: text, stderr: '' };
}

function makeSh({ vscode, termRun, termutil, path }) {
  const exeName = file => path.basename(String(file)).replace(/\.exe$/i, '');
  return async function sh(file, args, cwd, timeout = 60000) {
    const kind = termutil.shellKind(vscode.env.shell);
    let command = termutil.commandLine(file, args, kind);
    if (exeName(file) === 'gh') command = termutil.withEnv(command, { GH_PAGER: 'cat' }, kind);
    const label = [exeName(file), ...args.filter(a => a !== '--no-pager')].join(' ');
    const res = await termRun(command, { cwd, name: 'tools', timeout: Math.ceil(timeout / 1000), label });
    return parseResult(res);
  };
}

module.exports = { makeSh, parseResult };
