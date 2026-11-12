# Changelog

All notable changes to this project are listed here. The project follows [Semantic Versioning](https://semver.org/).

## 0.7.2

### Added
- A guard that asks for approval when a terminal command obviously refers to a protected file (SSH keys, `.env` files, cloud credentials and similar).
- A commit guard: `git_commit` and broad commands such as `git add .` or `git commit -a` refuse to run if they would stage a protected file (keys, `.env` files, credentials). The `git` tool also asks for approval when its arguments name a protected file.
- Tracking of items that terminal commands create in their folder, so `list_session_files` and `cleanup_session` can find them.
- More secret patterns in output redaction: Google, Stripe, npm and GitLab tokens, Bearer tokens and passwords inside URLs.
- `keep_session_files`, to mark real deliverables so they are not listed as leftovers.
- A test that runs the shim itself over stdio on Windows, macOS and Linux.
- Issue templates, a security policy, a contributing guide and a release workflow that attaches the `.vsix` to a GitHub Release.

### Changed
- Pause now survives a window reload, and VS Code reminds you when a window starts paused.
- The README was rewritten.

### Fixed
- Deleting, cleaning up or moving a folder no longer fails on Windows when one of the bridge's own terminals is sitting inside it. The bridge closes that terminal first.

## 0.6.1
- The shim finishes requests that are already in flight before it exits.

## 0.6.0
- Bundled runtime: Claude Desktop starts the shim with VS Code's own runtime, so Node.js is not needed. New setting `mcpBridge.shimRuntime`.
- The shim can start VS Code itself without the `code` command.
- The extension offers to repair the Claude Desktop entry if VS Code moved.

## 0.5.0
- Rules inside the tool descriptions, the `get_instructions` tool and a check phrase to test delivery.
- Session file tracking with `list_session_files` and `cleanup_session`.
- The `mcpBridge.extraInstructions` setting for your own rules.

## 0.4.x
- Every command runs in a visible terminal, with no hidden processes. Terminals are titled after their command and keep their history.
- Built-in search replaces ripgrep. `terminal_list` shows real terminal names.

## 0.3.x and earlier
- Pause switch, audit log, secret redaction and protected paths.
- Connect and Disconnect commands for Claude Desktop. Connect only edits a file named `claude_desktop_config.json`, after confirmation.
- A registry of VS Code windows, `list_windows` and the `target` option.
- Approvals in chat plus a VS Code confirmation box for high-risk actions.
- Tool safety annotations and server instructions.
