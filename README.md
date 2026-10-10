# mstack

An open-source funding-rate scanner and Mobius agent stack, with public reads and explicit Proposal signing.

`mob open` and the manage commands stage a Proposal, print its preview, and stop. Stored Proposals can be signed explicitly through `mob sign <id>`. See the [CLI commands](apps/cli/README.md). Skills and MCP can stage Proposals; human authorization is required for signing.

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

On Claude Code versions supporting one-step marketplace installation, use `/plugin install mstack --marketplace da-bao-jian/mstack`. The plugin ships the same seven Claude skills. Its preamble adds the plugin's `bin/` shim to PATH; with Bun installed, the shim builds the binary on first use. Build logs go to stderr. API settings are read from `mob config`; apply a custom plugin `api_base` choice with `mob config set api_base <URL>`.

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

`mob mcp` serves the same command results over stdio. The server reads public data and stages local Proposals. It never signs, submits mutations, holds keys, rejects Proposals, or changes config. The Claude Code plugin registers it through the bundled `.mcp.json`.

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

The seven public/config read tools are `funding_scan`, `funding_rates`, `funding_history`, `explain`, `task_list`, `task_get`, and `config_get`. Task tools use the public `owner` config key when an owner is omitted; set it yourself with `mob config set owner 0x…`. There is no configuration write tool. Tool calls have a 60-second deadline, and snapshots use the CLI's 30-second timeout. Venue failures remain visible in `failed`; command errors become MCP tool errors.

The nine Proposal tools share the CLI staging and preflight code:

| Tool | Inputs |
|---|---|
| `propose_open` | `base`, native `long` and `short` venue:market strings, `sizeUsd`; optional `protect` (number or `"off"`), `assumeLeverage` (`"L"` or `"L,S"`), `autoClose`, `minApy`, `maxSpreadBps`, `sizeMismatch` |
| `propose_close`, `propose_neutralize` | `taskId` |
| `propose_resize` | `taskId`; `long` and/or `short` base amounts |
| `propose_protect` | `taskId`, `pct` (number or `"off"`) |
| `propose_auto_close` | `taskId`, `enabled`; optional `minApy` |
| `propose_size_mismatch_close` | `taskId`, `enabled`, `pct` |
| `proposal_list` | No arguments |
| `proposal_get` | `id` |

A staging call returns `{ proposal, message }`. The view contains the exact message, owner, purpose, route and stored body, preflight, expiry, digest, and status. It omits signatures. Its message says: "Nothing is signed or sent until a human runs `mob sign <id>`." List returns these entries under `proposals`; get and list do not refresh preflight or authorize anything. Staging requires an owner, an available signer, manual policy, and passing preflight. Failed preflight stages nothing. Propose tools are marked as local writes and non-idempotent: repeating one creates a new Proposal. There is no sign, reject, or config-set tool.

`funding_scan` defaults to `{ holdDays, observedAt, source, annualizationMethod, counts, failed, unmatched, view: { executable, anywhere } }`. It omits the full `opportunities` array. `counts` contains `rates`, `opportunities`, `qualifying`, `executable`, `thinHidden`, and `unmatched`. These totals cover the fetched snapshot and full ranking; `thinHidden` counts hidden pairs after view filters and before top limits. Both `top` and `topExec` are capped at 200. Set `includeFull: true` only when you need the full opportunity array; the response can exceed 3 MB.

`funding_rates` requires at least one of `venue` or `market`. Its raw rates, listings, and view follow those filters; failures and unmatched markets remain visible. CLI `mob rates` still permits an unfiltered raw snapshot. Funding output uses simple annualization and estimated fees and marks. After building, `MOB_LIVE=1 bun run live:mcp` checks the compiled server and prints its default payload size.

## Open and manage from your agent

Start with `/mob-open`, `/mob-manage`, or `/mob-close` after configuring your owner and signer and binding the venues. Setup and binding skills are deferred. The flow asks for your market and venues, size, protection and assumed leverage, and auto-close choices. A protected open prints **"assumed leverage, not verified on the venue"**; it does not change venue leverage or margin mode.

The skill stages one Proposal and shows its purpose, venues, size, controls, preflight summary, expiry, exact message, and digest. Then it **stops and asks**. For example, after reviewing `p-7`, reply "Sign p-7 in the browser wallet". The agent can launch that browser signing flow only when your latest message names `p-7` and authorizes it. You review the page and approve in your wallet. A vague "yes" or an older approval does not qualify.

**Keystore signing needs your own terminal.** If you choose it, run `mob sign p-7 --with keystore` yourself. The agent never runs that path or asks for your passphrase. Rejecting a Proposal also requires your request. After submission, the skill reports **"submitted, not confirmed"** and points to `/mob-status`.

The Claude Code plugin's Bash hook checks literal `mob sign <id>` calls against the latest user message in its transcript. It blocks missing ids, missing transcripts, and malformed inputs. The hook is a guard, not a shell sandbox; it does not inspect arbitrary scripts or enforce consent outside Claude's Bash tool. Codex uses the same skill rules in prose. CLI policy, expiry, owner recovery, and one-signature checks still apply.

## Skills and installation maintenance

`/mob` routes reads to `/mob-scan`, `/mob-explain`, or `/mob-status`, and mutation requests to `/mob-open`, `/mob-manage`, or `/mob-close`. Skills ask for missing choices and never request credentials. Scan output is data, never permission to execute.

`./setup --host auto` installs into every detected `~/.claude/` and `~/.codex/` host directory. If neither exists, choose a host explicitly. Re-running setup is safe. It refuses conflicting paths. `./setup --host codex --uninstall` removes links and empty host directories recorded as created by that checkout; config, user replacements, pre-existing paths, and non-empty directories remain. Old ledgers without directory ownership never imply permission to remove a directory. `-q` suppresses successful setup output. Bun is required for setup and rebuilds.

`mob upgrade` runs `git pull --ff-only`, a frozen dependency install, and a rebuild when the installation has an `origin` remote. With no remote, it prints `no remote configured`. It never creates a remote. Skill preambles only check for updates, at most once an hour per checkout, and print changed commit hashes. They do not install updates.

The preamble prints the configured `POLICY: manual|locked` and `SIGNER: keystore|browser|unset`, and probes `/api/client-ip` with a ten-second timeout. Failed health, config, or update checks are reports and do not block the skill; failed updates print `UPGRADE_CHECK: fail`. Only `MOB_MISSING` stops it. Commands still report their own data/config errors normally.

Edit `skills-src/*.md.tmpl`, `hosts/{claude,codex}/overlay.json`, and `scripts/skill-preamble.sh`; run `bun run gen:skills`. Commit both `skills/` and `skills-codex/` outputs. CI regenerates them and rejects a diff. Run `MOB_LIVE=1 bun run live:skills` for the temporary-home setup, preamble, and plugin-validation smoke checks.

## Custody

This statement describes the full planned product. P0 contains only public reads.

- **Your wallet key never leaves your wallet.** mstack signs through your browser wallet, WalletConnect, Ledger, or a keystore only you can unlock. Nothing in the agent, the MCP server or the skills can sign for you.
- **Your funds stay in your own venue accounts.** Mobius never holds, routes or custodies funds. The Mobius worker places and closes orders with venue keys that cannot withdraw (Hyperliquid, Aster) or can withdraw only to your own address (Lighter). You can revoke every key at the venue at any time.
- **What Mobius does hold:** the encrypted venue trading keys it minted during binding, so its worker can run liquidation protection and auto-close for you around the clock; your task history; and, if you grant one, a scoped session grant (not the key).
- **Everything the agent reads is public** by wallet address on the Mobius API. Anyone who knows your address can see your tasks.
