# mobstack

An open-source funding-rate scanner and Mobius agent stack. The current P0 scope is read-only: no wallet, signing, or key handling.

## 30-second install

Install Bun 1.3 or newer first. The intended repository, `lu-bann/mobstack`, is **not published yet**. These clone commands become available when it is published; today, run setup from this checkout.

```sh
git clone https://github.com/lu-bann/mobstack.git
cd mobstack
./setup --host codex
export PATH="$HOME/.codex/skills/mobstack/bin:$PATH"
mob scan --size 1000 --top 5
mob explain funding --simple
```

For Claude Code, use `./setup --host claude` and add `$HOME/.claude/skills/mobstack/bin` to PATH instead. Setup builds the binary and prints a paragraph to paste into AGENTS.md or CLAUDE.md. Start with `/mob` in either host.

The Claude Code plugin path works against this local checkout:

```text
/plugin marketplace add /absolute/path/to/mobstack
/plugin install mobstack
```

After publication, the intended marketplace path is:

```text
/plugin marketplace add lu-bann/mobstack
/plugin install mobstack
```

On Claude Code versions supporting one-step marketplace installation, use `/plugin install mobstack --marketplace lu-bann/mobstack` after publication. The plugin ships the same four Claude skills. Its preamble adds the plugin's `bin/` shim to PATH; with Bun installed, the shim builds the binary on first use. Build logs go to stderr. API settings are read from `mob config`; apply a custom plugin `api_base` choice with `mob config set api_base <URL>`.

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

`@mobstack/funding` provides public venue adapters and fresh snapshots. `@mobstack/opportunities` ranks positive funding spreads, estimates round-trip fees and mark-based entry cost, and reports break-even hours. Fee defaults are estimates that callers should override. Native market names remain on every leg; unmatched symbols are listed explicitly.

```ts
import { rankOpportunities } from "@mobstack/opportunities";

const result = rankOpportunities(snapshot, { sizeUsd: 1_000 });
```

See [funding](packages/funding/README.md) and [opportunities](packages/opportunities/README.md) for the APIs, assumptions, and fee defaults. `mob open` strings in ranked output are suggestions for the future execution phase; no current command executes them.

## What it does today (P0, read-only)

The compiled `mob` binary supports `scan`, `rates`, `history`, `explain`, `status`, and `config`. It runs without Bun or `node_modules` installed. [CLI documentation](apps/cli/README.md) describes flags, output, exit codes, and config. The ten [knowledge topics](docs/knowledge/) are embedded at build time.

| Command | Purpose |
|---|---|
| `mob scan --size 5000` | Rank funding pairs with estimated fees, mark entry cost, and a per-leg volume gate |
| `mob rates --venue hl --market BTC` | Read raw current rates |
| `mob history BTC --days 7` | Compare settled funding history and coverage |
| `mob explain funding --simple` | Read bundled explanations |
| `mob status --owner 0x…` | Read public tasks and estimated funding accrued |
| `mob config get api_base` | Read or set local settings, including the public owner address |

Scans show Executable on Mobius (top five) and Best anywhere (top ten), each sorted by net APY for a seven-day hold. Use `--hold-days`, `--top-exec`, and `--top` to change these defaults. Negative mark entry estimates do not count as gains in net APY. Funding output reports snapshot age, source, simple annualization, failures, and unmatched symbols. Scans also report thin pairs hidden by the default $1 million per-leg volume filter. Status reports API base, fetch age, and task/log counts. JSON stays on stdout; its human footer goes to stderr. Fee defaults are estimates. Entry costs use marks and do not measure executable depth.

## Use from any MCP client

`mob mcp` serves the same command results over stdio. The server is read-only: it never signs, trades, holds keys, or changes config. The Claude Code plugin registers it through the bundled `.mcp.json`.

For a separate Claude Code registration, with `mob` on PATH:

```sh
claude mcp add mobstack -- mob mcp
```

For Cursor, Claude Desktop, or Windsurf, add this to the client's MCP server settings. Replace the command with the absolute path to the compiled binary or installed shim; GUI clients may not inherit your shell's PATH.

```json
{
  "mcpServers": {
    "mobstack": {
      "command": "/absolute/path/to/mobstack/bin/mob",
      "args": ["mcp"]
    }
  }
}
```

The seven tools are `funding_scan`, `funding_rates`, `funding_history`, `explain`, `task_list`, `task_get`, and `config_get`. Task tools use the public `owner` config key when an owner is omitted; set it yourself with `mob config set owner 0x…`. There is no configuration write tool. Tool calls have a 60-second deadline, and snapshots use the CLI's 30-second timeout. Venue failures remain visible in `failed`; command errors become MCP tool errors.

`funding_scan` returns the full ranked result plus the two selected views, even when `top` is small. A small `top` limits the display, not the response size. Funding output uses simple annualization and estimated fees and marks. After building, `MOB_LIVE=1 bun run live:mcp` checks the compiled server with the SDK stdio client.

## Skills and installation maintenance

`/mob` routes questions to `/mob-scan`, `/mob-explain`, or `/mob-status`. Skills ask for an unstated size or missing public owner address. They never request credentials or execute the future P1 command strings in scan output. Trading requests point to [the Mobius app](https://app.mob.exchange).

`./setup --host auto` installs into every detected `~/.claude/` and `~/.codex/` host directory. If neither exists, choose a host explicitly. Re-running setup is safe. It refuses conflicting paths. `./setup --host codex --uninstall` removes links and empty host directories recorded as created by that checkout; config, user replacements, pre-existing paths, and non-empty directories remain. Old ledgers without directory ownership never imply permission to remove a directory. `-q` suppresses successful setup output. Bun is required for setup and rebuilds.

`mob upgrade` runs `git pull --ff-only`, a frozen dependency install, and a rebuild when the installation has an `origin` remote. With no remote, it prints `no remote configured`. It never creates a remote. Skill preambles only check for updates, at most once an hour per checkout, and print changed commit hashes. They do not install updates.

The preamble probes `/api/client-ip` with a ten-second timeout. Failed health, config, or update checks are reports and do not block the skill; failed updates print `UPGRADE_CHECK: fail`. Only `MOB_MISSING` stops it. Commands still report their own data/config errors normally.

Edit `skills-src/*.md.tmpl`, `hosts/{claude,codex}/overlay.json`, and `scripts/skill-preamble.sh`; run `bun run gen:skills`. Commit both `skills/` and `skills-codex/` outputs. CI regenerates them and rejects a diff. Run `MOB_LIVE=1 bun run live:skills` for the temporary-home setup, preamble, and plugin-validation smoke checks.

## Custody

This statement describes the full planned product. P0 contains only public reads.

- **Your wallet key never leaves your wallet.** mobstack signs through your browser wallet, WalletConnect, Ledger, or a keystore only you can unlock. Nothing in the agent, the MCP server or the skills can sign for you.
- **Your funds stay in your own venue accounts.** Mobius never holds, routes or custodies funds. The Mobius worker places and closes orders with venue keys that cannot withdraw (Hyperliquid, Aster) or can withdraw only to your own address (Lighter). You can revoke every key at the venue at any time.
- **What Mobius does hold:** the encrypted venue trading keys it minted during binding, so its worker can run liquidation protection and auto-close for you around the clock; your task history; and, if you grant one, a scoped session grant (not the key).
- **Everything the agent reads is public** by wallet address on the Mobius API. Anyone who knows your address can see your tasks.
