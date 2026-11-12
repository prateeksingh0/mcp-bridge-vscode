# Security policy

## What this software can do

MCP Bridge for VS Code lets an AI assistant read and change files, run terminal commands, use git and install extensions in your VS Code. Treat it like giving someone access to your editor. Read "Read this first: risks" in the [README](README.md) before using it.

## Reporting a vulnerability

Please report security problems **privately**, not in a public issue.

1. Open the **Security** tab of this repository.
2. Choose **Report a vulnerability** (GitHub private vulnerability reporting).

If that button is not available, open a public issue titled "Security contact request" with **no details**, and the maintainer will arrange a private way to talk.

Please include the version, your operating system, what you did, what happened, and why you think it matters.

This is a personal project maintained in spare time. There is no guaranteed response time, but reports are taken seriously.

## Supported versions

Only the latest release receives fixes.

## What counts as a vulnerability

- A way around approvals, pause, protected paths or secret redaction.
- A way for a web page, a file, or another program to call the bridge without its token.
- A leak of tokens or secrets through logs, files or tool output.
- An unsafe edit of the Claude Desktop configuration.

## Known limits (not vulnerabilities)

These are documented trade-offs:

- The approval card in chat depends on the AI following the server's instructions. The VS Code confirmation box is the part the AI cannot skip.
- Terminal commands are not sandboxed. The check for protected paths inside commands is best effort and cannot catch every trick (variables, wildcards, built-up strings).
- Secret redaction is a heuristic. It can miss secrets and can mask harmless values.
- The per-window tokens are stored in `~/.mcp-bridge/windows/`, so any program running as your user can read them.
- The shim starts VS Code itself when it is closed. That is the one program the bridge starts outside a terminal.
