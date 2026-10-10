# mstack

An open-source funding-rate scanner and Mobius agent stack, with public reads and explicit Proposal signing.

`mob open` and the manage commands stage a Proposal, print its preview, and stop. Stored Proposals can be signed explicitly through `mob sign <id>`. See the [CLI commands](apps/cli/README.md). MCP and the current skills remain read-only.

| Signer backend | Human approval | Can launch from an agent's shell? |
|---|---|---|
| `keystore` | Passphrase through a human terminal (`/dev/tty`) | No; requires that terminal |
| `browser` | Review the local page and approve in the wallet extension | Yes |

Set `mob config set owner 0x…` and `mob config set signer browser`, or select `mob sign <id> --with browser`. The browser bridge serves one Proposal on a random loopback port and closes after signing, rejection, or expiry. It creates no daemon or token file. Compare the page's digest with the terminal before approval.

## 30-second install

Install Bun 1.3 or newer first. The repository is private; cloning and marketplace installation require GitHub access.

```sh
git clone https://github.com/da-bao-jian/mstack.git ~/.claude/skills/mstack
cd ~/.claude/skills/mstack
./setup --host codex
export PATH="$HOME/.codex/skills/mstack/bin:$PATH"
mob scan --size 1000 --top 5
mob explain funding --simple
```

For Claude Code, clone outside its skill directory (for example, into `~/dev/mstack`), use `./setup --host claude`, and add `$HOME/.claude/skills/mstack/bin` to PATH. Setup builds the binary and prints a paragraph to paste into AGENTS.md or CLAUDE.md. Start with `/mob` in either host.

Install the Claude Code plugin from GitHub:

```text
/plugin marketplace add da-bao-jian/mstack
/plugin install mstack
```

For a local checkout, use its absolute path instead:

```text
/plugin marketplace add /absolute/path/to/mstack
/plugin install mstack
```

On Claude Code versions supporting one-step marketplace installation, use `/plugin install mstack --marketplace da-bao-jian/mstack`. The plugin ships the same four Claude skills. Its preamble adds the plugin's `bin/` shim to PATH; with Bun installed, the shim builds the binary on first use. Build logs go to stderr. API settings are read from `mob config`; apply a custom plugin `api_base` choice with `mob config set api_base <URL>`.

For development, install Bun 1.3 or newer, then run:

```sh
bun install
bun run check
bun run lint
bun test
bun run deadcode
```

Funding annualization is simple, not compounded: `ratePerInterval / intervalHours × 24 × 365 × 100`.

## Funding and opportunity libraries

`@mstack/funding` provides public venue adapters and fresh snapshots. `@mstack/opportunities` ranks positive funding spreads, estimates round-trip fees and mark-based entry cost, and reports break-even hours. Fee defaults are estimates that callers should override. Native market names remain on every leg; unmatched symbols are listed explicitly.

```ts
import { rankOpportunities } from "@mstack/opportunities";

const result = rankOpportunities(snapshot, { sizeUsd: 1_000 });
```

See [funding](packages/funding/README.md) and [opportunities](packages/opportunities/README.md) for the APIs, assumptions, and fee defaults. The `mob open` commands in ranked output run local preflight and stage a Proposal. They stop before signing.

## Public reads

The compiled `mob` binary supports `scan`, `rates`, `history`, `explain`, `status`, and `config`. It runs without Bun or `node_modules` installed. [CLI documentation](apps/cli/README.md) describes flags, output, exit codes, and config. The ten [knowledge topics](docs/knowledge/) are embedded at build time.

| Command | Purpose |
|---|---|
| `mob scan --size 5000` | Rank funding pairs with estimated fees, mark entry cost, and a per-leg volume gate |
| `mob rates --venue hl --market BTC` | Read raw current rates |
| `mob history BTC --days 7` | Compare settled funding history and coverage |
| `mob explain funding --simple` | Read bundled explanations |
| `mob status --owner 0x…` | Read public tasks and estimated funding accrued |
| `mob config get api_base` | Read or set local settings, including the public owner address |

Scans show Executable on Mobius (top five) and Best anywhere (top ten), each sorted by net APY for a seven-day hold. Use `--hold-days`, `--top-exec`, and `--top` to change these defaults. Each view limit is capped at 200. Negative mark entry estimates do not count as gains in net APY. Funding output reports snapshot age, source, simple annualization, failures, and unmatched symbols. Scans also report thin pairs hidden by the default $1 million per-leg volume filter. Status reports API base, fetch age, and task/log counts. JSON stays on stdout; its human footer goes to stderr. `mob scan --json` returns bounded views and counts; `--json-full` opts into every opportunity and can exceed 3 MB. Fee defaults are estimates. Entry costs use marks and do not measure executable depth.

## Use from any MCP client

`mob mcp` serves the same command results over stdio. The server is read-only: it never signs, trades, holds keys, or changes config. The Claude Code plugin registers it through the bundled `.mcp.json`.

For a separate Claude Code registration, with `mob` on PATH:

```sh
claude mcp add mstack -- mob mcp
```

For Cursor, Claude Desktop, or Windsurf, add this to the client's MCP server settings. Replace the command with the absolute path to the compiled binary or installed shim; GUI clients may not inherit your shell's PATH.

```json
{
  "mcpServers": {
    "mstack": {
      "command": "/absolute/path/to/mstack/bin/mob",
      "args": ["mcp"]
    }
  }
}
```

The seven tools are `funding_scan`, `funding_rates`, `funding_history`, `explain`, `task_list`, `task_get`, and `config_get`. Task tools use the public `owner` config key when an owner is omitted; set it yourself with `mob config set owner 0x…`. There is no configuration write tool. Tool calls have a 60-second deadline, and snapshots use the CLI's 30-second timeout. Venue failures remain visible in `failed`; command errors become MCP tool errors.

`funding_scan` defaults to `{ holdDays, observedAt, source, annualizationMethod, counts, failed, unmatched, view: { executable, anywhere } }`. It omits the full `opportunities` array. `counts` contains `rates`, `opportunities`, `qualifying`, `executable`, `thinHidden`, and `unmatched`. These totals cover the fetched snapshot and full ranking; `thinHidden` counts hidden pairs after view filters and before top limits. Both `top` and `topExec` are capped at 200. Set `includeFull: true` only when you need the full opportunity array; the response can exceed 3 MB.

`funding_rates` requires at least one of `venue` or `market`. Its raw rates, listings, and view follow those filters; failures and unmatched markets remain visible. CLI `mob rates` still permits an unfiltered raw snapshot. Funding output uses simple annualization and estimated fees and marks. After building, `MOB_LIVE=1 bun run live:mcp` checks the compiled server and prints its default payload size.

## Skills and installation maintenance

`/mob` routes questions to `/mob-scan`, `/mob-explain`, or `/mob-status`. Skills ask for an unstated size or missing public owner address. They never request credentials or execute the future P1 command strings in scan output. Trading requests point to [the Mobius app](https://app.mob.exchange).

`./setup --host auto` installs into every detected `~/.claude/` and `~/.codex/` host directory. If neither exists, choose a host explicitly. Re-running setup is safe. It refuses conflicting paths. `./setup --host codex --uninstall` removes links and empty host directories recorded as created by that checkout; config, user replacements, pre-existing paths, and non-empty directories remain. Old ledgers without directory ownership never imply permission to remove a directory. `-q` suppresses successful setup output. Bun is required for setup and rebuilds.

`mob upgrade` runs `git pull --ff-only`, a frozen dependency install, and a rebuild when the installation has an `origin` remote. With no remote, it prints `no remote configured`. It never creates a remote. Skill preambles only check for updates, at most once an hour per checkout, and print changed commit hashes. They do not install updates.

The preamble probes `/api/client-ip` with a ten-second timeout. Failed health, config, or update checks are reports and do not block the skill; failed updates print `UPGRADE_CHECK: fail`. Only `MOB_MISSING` stops it. Commands still report their own data/config errors normally.

Edit `skills-src/*.md.tmpl`, `hosts/{claude,codex}/overlay.json`, and `scripts/skill-preamble.sh`; run `bun run gen:skills`. Commit both `skills/` and `skills-codex/` outputs. CI regenerates them and rejects a diff. Run `MOB_LIVE=1 bun run live:skills` for the temporary-home setup, preamble, and plugin-validation smoke checks.

## Custody

This statement describes the full planned product. P0 contains only public reads.

- **Your wallet key never leaves your wallet.** mstack signs through your browser wallet, WalletConnect, Ledger, or a keystore only you can unlock. Nothing in the agent, the MCP server or the skills can sign for you.
- **Your funds stay in your own venue accounts.** Mobius never holds, routes or custodies funds. The Mobius worker places and closes orders with venue keys that cannot withdraw (Hyperliquid, Aster) or can withdraw only to your own address (Lighter). You can revoke every key at the venue at any time.
- **What Mobius does hold:** the encrypted venue trading keys it minted during binding, so its worker can run liquidation protection and auto-close for you around the clock; your task history; and, if you grant one, a scoped session grant (not the key).
- **Everything the agent reads is public** by wallet address on the Mobius API. Anyone who knows your address can see your tasks.
