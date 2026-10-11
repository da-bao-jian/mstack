# Usage

The CLI reference lists commands and flags; this guide explains the flows and limits.

## Home screen and diagnostics

Run `mob` or `mob hello` for the logo, public account status and one next command. Use `--big`, `--compact`, `--plain`, `--ascii`, `--offline` or `--json`. Below 90 terminal columns, the logo appears above the details. `--compact` hides the info block and keeps the logo, palette and next command. Add `--offline` to omit network reads.

`mob doctor` checks the installation, public configuration, signer availability, API access, legal acceptance, venue readiness and local Proposals. `mob doctor --json` returns the checklist. It never opens a wallet or requests a secret. Both screens share a five-second network budget; unfinished reads say `not checked`. Upgrade status uses the cached `origin/main` reference; these commands do not fetch GitHub.

Doctor exits 1 for a failed or unchecked critical item. Unbound venues, Bun availability for upgrades, and upgrade notices are optional. A bound venue's readiness and deposit/account checks are critical. A valid `locked` policy passes and is labeled as disabling mutations. The HL deposit check reports current perpetual account value; it cannot establish past deposits or spot-only balances.

The installer ends with the home screen and three next commands; `-q` stays quiet. The `/mob` router shows a compact ASCII splash at most once per hour, shared between hosts. The plugin does not use SessionStart to show an install notice.

## Funding and opportunity libraries

`@mstack/funding` provides public venue adapters and fresh snapshots. `@mstack/opportunities` ranks positive funding spreads, estimates round-trip fees and mark-based entry cost, and reports break-even hours. Fee defaults are estimates that callers should override. Native market names remain on every leg; unmatched symbols are listed explicitly.

```ts
import { rankOpportunities } from "@mstack/opportunities";

const result = rankOpportunities(snapshot, { sizeUsd: 1_000 });
```

See [funding](../packages/funding/README.md) and [opportunities](../packages/opportunities/README.md) for the APIs, assumptions, and fee defaults. The `mob open` commands in ranked output run local preflight and stage a Proposal. They stop before signing.

## Public reads

The compiled `mob` binary supports `scan`, `rates`, `history`, `explain`, `status`, and `config`. It runs without Bun or `node_modules` installed. [CLI documentation](../apps/cli/README.md) describes flags, output, exit codes, and config. The ten [knowledge topics](knowledge/) are embedded at build time.

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

## Set up and bind venues

`mob setup` asks for your public owner address, signer (`browser`, `walletconnect`, or `keystore`), policy, auth API base, and legal signing chain. Defaults are `manual`, `https://auth.mob.exchange`, and chain 97. It never creates or unlocks a keystore. If you choose keystore, follow the printed creation step yourself in your terminal.

Setup checks your current legal acceptance. If needed, it stages **Accept Mobius legal terms**, shows the exact typed message, expiry and digest, and stops. Review the terms and privacy links before signing. An unconfigured legal service (503) is reported without discarding your settings. Stale terms (409) produce a new Proposal that needs separate approval. Locked policy saves settings without offering a signature.

Run `mob bind <venue>` again after each approved step. Every invocation selects one next Proposal from the server's credential and session state. A pending Proposal is shown again; it is not signed automatically.

| Venue | Steps and stored key capabilities |
|---|---|
| `hl` | Prepare, approve agent, approve builder fee up to 0.1%. Key can trade, cancel and adjust margin; cannot withdraw; expires after 179 days. The owner must have deposited. |
| `aster` | Prepare, then approve agent on chain 56. Key can trade perpetuals; cannot trade spot or withdraw; expires after 365 days. |
| `lighter` | Robinhood deployment, chain 466324: account lookup, prepare, approve key and submit the stored transaction. |
| `lighter-mainnet` | Mainnet, chain 304: the same key steps, then one integrator approval attempt. The venue's refusal is shown without retry. |

**A Lighter key can withdraw to your own address, not trade-only.** It can also trade, cancel, adjust leverage and isolated margin, and approve integrators. Third-party transfers require your L1 signature. The key has no expiry. The Mobius server creates and holds the encrypted venue key.

For HL browser staging, a connection-only page first reads your current wallet chain. It requests no signature. The staged Proposal then pins that chain. Keystore and WalletConnect HL use public config `hl_signature_chain_id`, default `0xa4b1` (Arbitrum). Aster pins chain 56. Approval plans include status polling and any builder finalization; answers remain recorded if completion fails or expires. Existing standalone builder-only repairs fail explicitly without replacing a key.

Use `mob status --readiness` to inspect each venue and its separate “rebind allowed” column. `mob setup` configures the CLI; the repository's `./setup` script installs skills and the binary. `bun run smoke:bind` exercises setup and all binding deployments against local fake servers, with no live writes.

## Open and manage from your agent

Use `/mob-setup` for public wallet configuration and legal acceptance, then `/mob-bind` for each venue. Once ready, use `/mob-open`, `/mob-manage`, or `/mob-close`. The flow asks for your market and venues, size, protection and assumed leverage, and auto-close choices. A protected open prints **"assumed leverage, not verified on the venue"**; it does not change venue leverage or margin mode.

The skill stages one Proposal and shows its purpose, venues, size, controls, preflight summary, expiry, exact message, and digest. Then it **stops and asks**. For example, after reviewing `p-7`, reply "Sign p-7 in the browser wallet". The agent can launch that browser signing flow only when your latest message names `p-7` and authorizes it. You review the page and approve in your wallet. A vague "yes" or an older approval does not qualify.

**Keystore signing needs your own terminal.** If you choose it, run `mob sign p-7 --with keystore` yourself. The agent never runs that path or asks for your passphrase. Rejecting a Proposal also requires your request. After submission, the skill reports **"submitted, not confirmed"** and points to `/mob-status`.

The Claude Code plugin's Bash hook checks literal `mob sign <id>` calls against the latest user message in its transcript. It blocks missing ids, missing transcripts, and malformed inputs. The hook is a guard, not a shell sandbox; it does not inspect arbitrary scripts or enforce consent outside Claude's Bash tool. Codex uses the same skill rules in prose. CLI policy, expiry, owner recovery, and one-signature checks still apply.

## Setup flags and signature review

The setup menu includes `browser`, `walletconnect`, and `keystore`. Agents can pass confirmed public choices as flags:

```sh
mob setup --owner 0x… --signer browser --policy manual
mob setup --owner 0x… --signer walletconnect --policy manual --walletconnect-project-id <id>
```

Optional flags are `--auth-base URL`, `--legal-chain-id N`, and `--no-legal`. Existing optional settings remain the defaults; new installs use `https://auth.mob.exchange` and chain 97. WalletConnect needs a supplied or saved public project ID. `--no-legal` reports that acceptance was skipped. Setup does not create a keystore or sign a Proposal.

All required flags avoid prompts, including on a terminal. Without a TTY, missing `--owner`, `--signer`, or `--policy` causes exit 1 and names the missing flags. Piped answers are no longer accepted. Interactive prompts show five numbered steps and defaults in brackets. Binding shows the current step, completed steps, and the next effect before the Proposal preview and stop line.

The browser page shows the purpose, account match, wallet icons, exact message with Copy, digest, and expiry bar. It supports phone widths and the system color scheme. Only embedded wallet icons are allowed; remote images are blocked. On a TTY, browser and WalletConnect signing print one URL, then update one countdown line every two seconds. WalletConnect also shows a QR. Without a TTY, these signers print only the URL and the final result; use `mob preview <id>` first to review the digest. A submitted result acknowledges submission, not execution.

## Installation maintenance

`./setup --host codex` links nine skill folders and the shared binary directory into `~/.agents/skills`.
When `~/.codex/skills` already exists, setup adds the same links there for older Codex versions.
New installations do not create that legacy directory.
After updating a legacy-only installation, rerun `./setup --host codex` to create
the primary links used by the new preamble.
Claude Code uses `~/.claude/skills`.
Auto mode detects `~/.claude`, `~/.codex`, or a modern `~/.agents/skills` directory.

Re-running setup is safe and refuses conflicting paths before building.
`./setup --host codex --uninstall` removes owned links from both Codex roots.
Config, user replacements, pre-existing paths, and non-empty directories remain.
The ledger at `~/.mob/mstack-install-codex.json` records ownership.
Old ledgers without directory ownership do not authorize directory removal.
Use `--host claude --uninstall` for the Claude links. `-q` suppresses successful setup output.
Bun is required for setup and source rebuilds.

Codex invokes skills with `$mob` or `$mob-scan`.
Claude clone skills use `/mob`; plugin skills use `/mstack:mob`.
References in shared flow examples use the short Claude names; select the matching host form.

For a checkout, `mob upgrade` runs a fast-forward-only Git pull, frozen dependency install, and rebuild.
With no remote, it reports that no remote is configured; it never adds one.
Downloaded installations instead fetch and verify the latest release's SHA-256
before replacing the cached binary and local command link. Plugin caches use the
manifest's version; update the plugin to select a newer release.
Skill preambles only check for updates, at most once per hour per checkout.
They print changed commit hashes without installing updates.

The shared preamble prints `MOB_BIN`, version, owner presence, policy, signer, and API health.
Its advisory API probe has a fifteen-second budget and reports `ok`, `slow`, or `unreachable`
with measured timing when reachable. Slow starts at three seconds and adds
`API slow; venue reads are unaffected`. It never changes scan filters or gates venue reads.
An update-check failure is one `UPGRADE_CHECK: fail` line with a reason, without Git diagnostics.
Failed health, config, or update checks are explicit reports; `MOB_MISSING` stops the skill.
Later commands use the printed binary path because the preamble runs in a child shell.
The router's `--router` option preserves the hourly ASCII splash.

Edit templates, references, and host overlays, then run `bun run gen:skills`.
Commit both generated host trees. CI rejects generation drift.
`MOB_LIVE=1 bun run live:skills` checks temporary-home setup, preambles, and strict plugin validation.
