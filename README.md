# MCP Bridge for VS Code

Let an MCP client such as **Claude Desktop** work inside your VS Code: read and edit files, run commands in a terminal you can watch, use git, see language-server errors, and more. Risky actions need your approval.

> **Not affiliated with or endorsed by Anthropic.** It works with Claude Desktop through the open Model Context Protocol (MCP).

## Read this first: risks

This extension gives an AI assistant real control of your VS Code. It can read and change files, run shell commands, use git and GitHub, change settings and install extensions. That is powerful and it can go wrong:

- The AI can make mistakes and break or delete things.
- **Prompt injection:** text inside a file, web page or issue can try to trick the AI into doing something you did not ask for.
- Approvals reduce the risk but do not remove it. See [How approvals work](#how-approvals-work) for exactly what is and is not enforced.

Recommendations: use it in projects under version control, keep approvals on, do not choose "Always allow" for risky tools in Claude Desktop, only trust folders you trust, and review the [audit log](#safety-features) now and then. The software is provided as is, with no warranty (see [LICENSE](LICENSE)).

## Features

- About 50 tools: files (read, write, edit, move, copy, delete to trash), search, a live terminal, git and GitHub CLI, diagnostics, go to definition, references, rename, tasks, debugging, extensions, settings and any VS Code command.
- **Every command runs in a visible VS Code terminal, with no hidden processes.** That includes git, the GitHub CLI and virtualenv commands. Each terminal is titled after what it runs (for example "MCP: git status"), and the output and exit code go back to the AI. The only program the bridge starts outside a terminal is VS Code itself, when the small shim has to open it because it is closed. A test in the repository fails if hidden process code is ever added.
- **Several windows:** each VS Code window registers itself. `list_windows` shows them and any tool can pick one with `target`.
- **Safety:** approvals, a pause switch, an audit log, secret redaction and protected paths.
- Works with Restricted Mode: tools stay off in untrusted folders.
- No network exposure and no telemetry.

## Requirements

- VS Code 1.93 or newer.
- Claude Desktop.
- Node.js on your PATH (Claude Desktop runs a small Node script, the "shim").
- Optional: the `code` command on PATH, so the shim can start VS Code if it is closed.

Tested on Windows 11. macOS and Linux paths are written but **not tested yet**.

## Install

The extension is not on the Marketplace yet. Install from the `.vsix` file:

```
code --install-extension mcp-bridge-vscode-<version>.vsix
```

Then reload VS Code (Ctrl+Shift+P, "Developer: Reload Window").

## Connect to Claude Desktop

1. Press Ctrl+Shift+P and run **MCP Bridge: Connect to Claude Desktop**.
2. Check the config path in the confirmation box and click **Update**. The command only edits a file named `claude_desktop_config.json`, saves a `.bak` copy first, and only adds one `vscode-bridge` entry.
3. Fully quit Claude Desktop (tray icon, Quit) and reopen it. Start a new chat.

To undo it, run **MCP Bridge: Disconnect from Claude Desktop**. It removes only its own entry.

## How approvals work

Risky tools reply `APPROVAL_REQUIRED`. The AI must then call `request_approval` with the exact action and show you an approval card in the chat (Approve / Deny). The approval is tied to those exact arguments, works once and expires after 10 minutes.

| Action | What is required |
| --- | --- |
| Delete, install or uninstall an extension, run an arbitrary VS Code command, risky git commands (push, reset, clean, rebase...), `gh` commands that change things, dangerous shell patterns, touching a protected path | Approval in chat **and** a VS Code confirmation box |
| Writing outside your workspace folders, changing a user-level setting | Approval in chat |
| Everything else | Nothing from the bridge, but Claude Desktop shows its own "Needs approval" prompt for tools marked as destructive, such as `terminal_run` |

Be aware of the limits:

- The chat approval depends on the AI following the server's instructions. **The VS Code confirmation box is the part that cannot be bypassed**, so the highest-risk actions always get one.
- Ordinary terminal commands are not blocked by the bridge. Only a short list of dangerous patterns is gated. Claude Desktop's own approval prompt is your main protection there.
- Setting `mcpBridge.approvalMode` changes this: `chat-and-vscode` (default), `chat-only`, `vscode-only` or `off`.

## Safety features

- **Pause switch:** click **MCP Bridge** in the status bar to pause or resume AI access. While paused, every tool except `get_workspace` is refused. The state resets when VS Code reloads.
- **Audit log:** every call, including refused ones, is written as one JSON line to `~/.mcp-bridge/audit.log` (rotated at 5 MB). File contents and approval IDs are logged as sizes only. Open it with **MCP Bridge: Show Audit Log**.
- **Secret redaction:** tool output is scrubbed before the AI sees it: private keys, AWS keys, GitHub, Slack and `sk-` style tokens, JWTs and `password = ...` style values. This is a heuristic and can miss secrets or mask harmless values.
- **Protected paths:** `.ssh`, `.aws`, `.gnupg`, `.kube`, `.env` files (not `.env.example`), `*.pem`, `*.key`, `credentials.json`, the Claude Desktop config and the bridge's own window registry need full approval even to read. Add your own patterns with `mcpBridge.protectedPaths`. This guards the file tools, **not shell commands**.
- **Trusted folders only:** in Restricted Mode the tools are disabled.
- **Local only:** the bridge listens on `127.0.0.1` with a random per-window token. The tokens are stored in `~/.mcp-bridge/windows/`, so any program running as your user could read them.

## Rules for the AI

The bridge tells the AI how to behave in your VS Code. There are four layers, because not every client passes server instructions to the model:

1. **Enforced by the extension** (works whatever the AI does): approvals, pause, protected paths, secret redaction, and every command running in a visible terminal.
2. **Rules inside the tool descriptions.** The AI always sees these, for example "delete temporary files you create" on the file tools.
3. **The instructions**, written to `~/.mcp-bridge/instructions.txt` and sent when Claude Desktop connects. The AI can also read them on demand with the `get_instructions` tool.
4. **Your own rules:** type them, one per line, in the setting `mcpBridge.extraInstructions` (user settings only). They are added to the instructions, but they cannot switch off approvals or protections.

**Keeping the workspace clean.** The bridge remembers files and folders it creates. `list_session_files` shows what is left, and `cleanup_session` moves the ones you approve to the trash. It refuses any path the bridge did not create. Files created by shell commands are not tracked.

**Check that your client delivers the instructions.** Start a new chat and ask: "What is the vscode-bridge check phrase?" If the AI answers `copper-lantern-4821`, it received the instructions. If not, it relies on the tool descriptions and `get_instructions`.

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `mcpBridge.approvalMode` | `chat-and-vscode` | How risky actions are approved (user settings only) |
| `mcpBridge.allowedRoots` | `[]` | Extra folders where writes need no approval |
| `mcpBridge.allowInUntrustedWorkspace` | `false` | Let tools run in Restricted Mode (not recommended) |
| `mcpBridge.redactSecrets` | `true` | Mask secrets in tool output |
| `mcpBridge.protectedPaths` | `[]` | Extra protected paths or patterns (`*` wildcard) |
| `mcpBridge.extraInstructions` | empty | Your own rules for the AI, one per line (user settings only) |
| `mcpBridge.maxTerminals` | `3` | Maximum terminals the bridge keeps open |
| `mcpBridge.idleMinutes` | `30` | Close idle bridge terminals after this long |

The security-related settings are machine-scoped, so a project's own `.vscode/settings.json` cannot weaken them.

## Commands

- **MCP Bridge: Connect to Claude Desktop**
- **MCP Bridge: Disconnect from Claude Desktop**
- **MCP Bridge: Pause / Resume AI Access**
- **MCP Bridge: Show Log**
- **MCP Bridge: Show Audit Log**

## Troubleshooting

- **No tools in Claude Desktop:** fully quit and reopen Claude Desktop after connecting, and check the status bar shows **MCP Bridge**. A chat that was open before an update keeps its old tool list, so start a new chat.
- **Status bar says "restricted":** the folder is in Restricted Mode. Click Restricted Mode and choose Trust.
- **Wrong window:** call `list_windows`, then pass `target` (a folder path or pid). By default the most recently focused window is used.
- **"Output NOT captured":** VS Code's shell integration had not started in that terminal, which can happen right after a window opens. The command still ran. Check the terminal or verify through files.
- **Connect command picked the wrong file:** it refuses any file not named `claude_desktop_config.json`. If it cannot find your config, choose the file by hand when asked.
- **Windows PowerShell 5.1:** chain commands with `;` instead of `&&`.

## Uninstall

1. Run **MCP Bridge: Disconnect from Claude Desktop** and restart Claude Desktop.
2. Uninstall the extension: `code --uninstall-extension local.mcp-bridge-vscode`.
3. Delete the `.mcp-bridge` folder in your home folder.

## Files and data

Everything lives in `~/.mcp-bridge/`: the shim, the tool list, the AI instructions, `audit.log`, `client.json` (what Claude Desktop advertised) and `windows/`. Nothing is sent anywhere.

## Development

```
node --test          # unit tests for the safety and config helpers
npx @vscode/vsce package --allow-missing-repository
```

- `extension.js`: the VS Code side (tools, approvals, status bar, commands)
- `shim.js`: the MCP server that Claude Desktop runs over stdio
- `safety.js`, `claudeconfig.js`, `termutil.js`, `search.js`, `runner.js`, `ledger.js`, `rules.js`: helpers with tests in `test/`

## License

MIT. See [LICENSE](LICENSE).
