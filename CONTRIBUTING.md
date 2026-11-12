# Contributing

Thanks for your interest. Bug reports, ideas and pull requests are welcome.

## Ground rules

- **No hidden processes.** Every command must run in a visible VS Code terminal. A test (`test/noexec.test.js`) fails if code that starts a process is added to the extension.
- **Security settings are machine-scoped,** so a project's own settings file cannot weaken them.
- **No telemetry** and no network calls to anything other than the user's own machine.
- **Add tests** for new behaviour, and keep the existing ones passing.
- Keep the README and `CHANGELOG.md` up to date.

## Set up

```
git clone https://github.com/prateeksingh0/mcp-bridge-vscode.git
cd mcp-bridge-vscode
node --test
npx @vscode/vsce package
code --install-extension mcp-bridge-vscode-<version>.vsix
```

Then reload VS Code and run **MCP Bridge: Connect to Claude Desktop**. There are no runtime dependencies to install.

## Project layout

- `extension.js`: the VS Code side (tools, approvals, status bar, commands)
- `shim.js`: the MCP server that Claude Desktop runs over stdio
- `safety.js`, `claudeconfig.js`, `termutil.js`, `search.js`, `runner.js`, `ledger.js`, `rules.js`, `commitguard.js`: helpers that do not depend on VS Code
- `test/`: unit tests, run with `node --test`

## Pull requests

1. Describe what changed and why.
2. Run `node --test` and make sure it passes.
3. If the behaviour changes, update the README and the changelog.

By contributing you agree that your work is released under the MIT license.
