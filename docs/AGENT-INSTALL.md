# Install mstack as an agent

Follow the path for the detected host. Do not ask the user which path to use.

## Detect the host

1. Use **Claude Code** when `claude` exists and this session has the Skill tool or `CLAUDE_PLUGIN_ROOT`-style variables.
2. Otherwise, use **Codex** when `codex` exists or `~/.agents/skills` exists.
3. Otherwise, use **Other MCP clients** when the current client can configure a stdio MCP server.
4. Otherwise, use **Plain shell**.

## Claude Code

Run each command exactly.

```sh
claude plugin marketplace add da-bao-jian/mstack
claude plugin install mstack@mstack
curl -fsSL https://raw.githubusercontent.com/da-bao-jian/mstack/v0.4.0/install.sh | sh
export PATH="$HOME/.local/bin:$PATH"
mob --version
mob doctor
```

`mob --version` must print the version in `v0.4.0`. Check the doctor output against [Verify](#verify).

Tell the user exactly: restart Claude Code, then say "set me up".

## Codex

Run each command exactly.

```sh
git clone --branch v0.4.0 https://github.com/da-bao-jian/mstack ~/.mstack && cd ~/.mstack && ./setup --host codex
export PATH="$HOME/.agents/skills/mstack/bin:$PATH"
mob --version
mob doctor
```

`mob --version` must print the version in `v0.4.0`. Check the doctor output against [Verify](#verify).

Tell the user exactly: start a new Codex session and say "set me up".

## Other MCP clients

Install the binary and keep the printed PATH export in the current shell.

```sh
curl -fsSL https://raw.githubusercontent.com/da-bao-jian/mstack/v0.4.0/install.sh | sh
export PATH="$HOME/.local/bin:$PATH"
mob --version
mob doctor
```

Add `{"mstack": {"command": "<path-to-mob>", "args": ["mcp"]}}` inside the client's MCP server map.
Replace `<path-to-mob>` with the absolute path printed by `command -v mob`.

| Client | MCP config file |
|---|---|
| Cursor | `~/.cursor/mcp.json` |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` |
| Claude Desktop | `~/Library/Application Support/Claude/claude_desktop_config.json` |

Verify the server response contains a `tools` array.

```sh
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | mob mcp
```

Keep signing and key import in the terminal. Use `mob onboard` and `mob keys import` there.

## Plain shell

Run each command exactly.

```sh
curl -fsSL https://raw.githubusercontent.com/da-bao-jian/mstack/v0.4.0/install.sh | sh
export PATH="$HOME/.local/bin:$PATH"
mob --version
mob doctor
mob onboard
```

## Verify

Run these commands after every install.

```sh
mob --version
mob doctor
```

`mob --version` must print the release version without a `v` prefix.
The `Binary` doctor line must start with `✓` and show that version.
Immediately after install, `Config`, `Owner`, and `Signer` can name the required onboarding action.
After onboarding, every critical line must start with `✓`; optional checks can end with `(optional)`.

## Uninstall

Delete the local key copy first. Revoke the key on the Mobius API page because local deletion does not revoke it.

For Claude Code, run:

```sh
mob keys delete
claude plugin uninstall mstack@mstack
rm -f ~/.local/bin/mob
rm -rf ~/.mob/bin
```

For Codex, run:

```sh
mob keys delete
cd ~/.mstack && ./setup --host codex --uninstall
rm -f ~/.local/bin/mob
rm -rf ~/.mob/bin
```

For another MCP client, remove the `mstack` server block, then run:

```sh
mob keys delete
rm -f ~/.local/bin/mob
rm -rf ~/.mob/bin
```

For a plain shell, run:

```sh
mob keys delete
rm -f ~/.local/bin/mob
rm -rf ~/.mob/bin
```

## What the agent must never do

- Never use `sudo`.
- Never edit a shell rc file. Only show the PATH line that `install.sh` prints.
- Never request, import, copy, or store a key during installation. Key handling starts during onboarding.
