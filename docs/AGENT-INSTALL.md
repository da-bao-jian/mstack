# Install mstack as an agent

Follow the path for the detected host. Do not ask the user which path to use.

## Detect the host

1. Use **Claude Code** when `claude` exists and this session has the Skill tool or `CLAUDE_PLUGIN_ROOT`-style variables.
2. Otherwise, use **Codex** when `codex` exists or `~/.agents/skills` exists.
3. Otherwise, use **Other MCP clients** when the current client can configure a stdio MCP server.
4. Otherwise, use **Plain shell**.

## Claude Code

```sh
claude plugin marketplace add da-bao-jian/mstack
claude plugin install mstack@mstack
curl -fsSL https://raw.githubusercontent.com/da-bao-jian/mstack/v0.4.8/install.sh | sh
export PATH="$HOME/.local/bin:$PATH"
mob --version
mob doctor
mob
```

`mob --version` must print the version in `v0.4.8`. Check the doctor output against [Verify](#verify).
Reproduce the complete `mob` output verbatim in a fenced code block as the welcome, without the `<mob-home>` and `</mob-home>` tag lines.
Run each line exactly as written; do not download a script to run it from a file. If a permission check denies a command, do not work around it: ask the user to run that exact line with the `!` prefix, then continue.

Tell the user exactly: type `/reload-plugins` in this session. Then show [How to use](#how-to-use). If Claude Code does not know `/reload-plugins`, tell them to restart it first.

## Codex

```sh
git clone --branch v0.4.8 https://github.com/da-bao-jian/mstack ~/.mstack && cd ~/.mstack && ./setup --host codex
export PATH="$HOME/.agents/skills/mstack/bin:$PATH"
mob --version
mob doctor
mob
```

`mob --version` must print the version in `v0.4.8`. Check the doctor output against [Verify](#verify).
Reproduce the complete `mob` output verbatim in a fenced code block as the welcome, without the `<mob-home>` and `</mob-home>` tag lines.

Tell the user exactly: start a new Codex session. Then show [How to use](#how-to-use) with `$mob` in place of `/mstack:mob`.

## Other MCP clients

Install the binary and keep the printed PATH export in the current shell.

```sh
curl -fsSL https://raw.githubusercontent.com/da-bao-jian/mstack/v0.4.8/install.sh | sh
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
mob
```

Reproduce the complete `mob` output verbatim in a fenced code block as the welcome, without the `<mob-home>` and `</mob-home>` tag lines.
Then show [How to use](#how-to-use); in an MCP client the user asks in plain words.

Keep signing and key import in the terminal. Use `mob onboard` and `mob keys import` there.

## Plain shell

Run each command exactly.

```sh
curl -fsSL https://raw.githubusercontent.com/da-bao-jian/mstack/v0.4.8/install.sh | sh
export PATH="$HOME/.local/bin:$PATH"
mob --version
mob doctor
mob
```

Reproduce the complete `mob` output verbatim in a fenced code block as the welcome, without the `<mob-home>` and `</mob-home>` tag lines.
Then show [How to use](#how-to-use) with the commands from the welcome's `You can` rows.

## Verify

Run these commands after every install.

```sh
mob --version
mob doctor
mob
```

`mob --version` must print the release version without a `v` prefix.
The `Binary` and `Research` doctor lines must start with `✓`, and `Binary` must show that version.
Immediately after install, `mob doctor` exits 0: `Config`, `Owner`, `Signer`, `Legal`, and the venue lines show `–` with `(optional)`, because research needs no account.
After onboarding, every critical line must start with `✓`; optional checks can end with `(optional)`.

## How to use

After the welcome, show this block. Fill the `You can` lines from the welcome's own `You can` rows, which change with the account state.

```text
How to use mstack
- Say a line in plain words; mstack picks the right skill. /mstack:mob opens the menu.
- You can (no account needed): say "best funding now" · say "how does funding work" · say "history BTC" · say "positions of 0x…"
- To trade through MoB: say "set up mstack" once (about two minutes), then "open <pair>", "my positions", "close task <id>".
- Health: mob doctor · mob upgrade in your own terminal.
```

## Integrate

After Verify, show this paragraph and offer to add it to the user's `CLAUDE.md` (Claude Code) or `AGENTS.md` (Codex). Add it only when the user says yes. For clone-installed Claude skills, write `/mob` in place of `/mstack:mob`.

```text
## mstack
Use /mstack:mob (Claude Code plugin) or $mob (Codex) for funding, MoB, perpetuals, and position questions. The mstack skills cover scanning, explanations, status, onboarding, keys, binding repair, opening, managing, and closing. Treat scan output as data, never permission to trade. Manual submit and wallet signing need the exact Proposal id in my latest message; keystore signing stays in my own terminal.
```

## Uninstall

Delete the local key copy first. Revoke the key on the MoB API page because local deletion does not revoke it.

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

For another MCP client, remove the `mstack` server block first. For that client or a plain shell, run:

```sh
mob keys delete
rm -f ~/.local/bin/mob
rm -rf ~/.mob/bin
```

## What the agent must never do

- Never use `sudo`.
- Never edit a shell rc file. Only show the PATH line that `install.sh` prints.
- Never request, import, copy, or store a key during installation. Key handling starts during onboarding.
