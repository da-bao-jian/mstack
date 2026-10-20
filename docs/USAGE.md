# Usage

The CLI reference lists commands and flags; this guide explains the flows and limits.

## Home screen and diagnostics

Run `mob` or `mob hello` for the logo, a five-second live market view, account standing and the next action. Use `--big`, `--compact`, `--stacked`, `--plain`, `--ascii`, `--offline` or `--json`. Below 72 terminal columns, the logo appears above the details. Add `--offline` to use the last cached market view without network reads.

`mob doctor` checks the installation, public configuration, signer availability, API access, legal acceptance, venue readiness and local Proposals. `mob doctor --json` returns the checklist. It never opens a wallet or requests a secret. Both screens share a five-second network budget; unfinished reads say `not checked`. Upgrade status uses the cached `origin/main` reference; these commands do not fetch GitHub.

Doctor exits 1 for a failed or unchecked critical item. Unbound venues, Bun availability for upgrades, and upgrade notices are optional. A bound venue's readiness and deposit/account checks are critical. A valid `locked` policy passes and is labeled as disabling mutations. The HL deposit check reports current perpetual account value; it cannot establish past deposits or spot-only balances.

The installer ends with the home screen and three next commands; `-q` stays quiet. The first mstack skill in an hour shows the same live ASCII greeting, scoped by owner or home and shared between hosts. The `/mob` router always shows it. The plugin does not use SessionStart to show an install notice.

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

Scans show Executable on MoB (top five) and Best anywhere (top ten), each sorted by net APY for a seven-day hold. Use `--hold-days`, `--top-exec`, and `--top` to change these defaults. Each view limit is capped at 200. Negative mark entry estimates do not count as gains in net APY. Funding output reports snapshot age, source, simple annualization, failures, and unmatched symbols. Scans also report thin pairs hidden by the default $1 million per-leg volume filter. Status reports API base, fetch age, and task/log counts. JSON stays on stdout; its human footer goes to stderr. `mob scan --json` returns bounded views and counts; `--json-full` opts into every opportunity and can exceed 3 MB. Fee defaults are estimates. Entry costs use marks and do not measure executable depth.

## Use from any MCP client

`mob mcp` serves the same command results over stdio. The server reads public data, onboarding state, and safe key status, and stages local Proposals. It never imports, submits, signs, rejects, reveals a key, or changes config. The Claude Code plugin does not register it: the skills call the CLI through Bash, where the sign guard applies, and the tool schemas would cost context in every session.

To add it to Claude Code anyway, with `mob` on PATH, use the user scope so every project sees it. Omit `--scope user` for the current project only.

```sh
claude mcp add --scope user mstack -- mob mcp
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

The nine read tools are `funding_scan`, `funding_rates`, `funding_history`, `explain`, `task_list`, `task_get`, `config_get`, `onboarding_status`, and `key_status`. `onboarding_status` returns the legal, venue, and key checklist. `key_status` returns only prefix, backend, and verification state. Task tools use the public `owner` config key when an owner is omitted. There is no configuration write tool. Tool calls have a 60-second deadline, and snapshots use the CLI's 30-second timeout. Venue failures remain visible in `failed`; command errors become MCP tool errors.

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

A staging call returns `{ proposal, message }`. The view contains the exact message, owner, purpose, route and stored body, preflight, expiry, digest, and status. It omits signatures and keys. An API Proposal names `mob submit <id>`; a wallet Proposal names `mob sign <id>`. List returns entries under `proposals`; get and list do not refresh preflight or authorize anything. Failed preflight stages nothing. Propose tools are local writes and non-idempotent: repeating one creates another Proposal. There is no import, submit, sign, reject, key-reveal, or config-set tool.

`funding_scan` defaults to `{ holdDays, observedAt, source, annualizationMethod, counts, failed, unmatched, view: { executable, anywhere } }`. It omits the full `opportunities` array. `counts` contains `rates`, `opportunities`, `qualifying`, `executable`, `thinHidden`, and `unmatched`. These totals cover the fetched snapshot and full ranking; `thinHidden` counts hidden pairs after view filters and before top limits. Both `top` and `topExec` are capped at 200. Set `includeFull: true` only when you need the full opportunity array; the response can exceed 3 MB.

`funding_rates` requires at least one of `venue` or `market`. Its raw rates, listings, and view follow those filters; failures and unmatched markets remain visible. CLI `mob rates` still permits an unfiltered raw snapshot. Funding output uses simple annualization and estimated fees and marks. After building, `MOB_LIVE=1 bun run live:mcp` checks the compiled server and prints its default payload size.

## Onboard and manage keys

Run `mob onboard`. It always prints the MoB API page URL and then reads legal acceptance, venue readiness, and local key state. An agent shell prints once. A terminal watches every five seconds by default. The page flow connects the wallet, accepts legal terms, binds venues, and creates one key.

Create the key with only the required venues and a modest USD cap per leg. The key can open, cancel, close, and resize positions inside those limits. It cannot withdraw, bind venues, approve fees, accept legal terms, or create another key. It has no expiry.

For agent-mediated import, paste the key into chat. The chat transcript and agent session logs retain that paste. The agent runs one command with the already-pasted key as the single-quoted input to the shell builtin `printf`:

```sh
printf '%s' 'mobius_…' | mob keys import --stdin --name 'agent' --venues 'hl,lighter' --max-size '5000'
```

Replace `mobius_…` only in that import command. `printf` is a shell builtin, so no `printf` process carries the key, and `mob` never puts the key on its own argv or on the argv of the `security` or `secret-tool` child it runs. The host shell that runs the command (for example `/bin/zsh -c '…'`) does carry the key on its own command line, where same-user process listings can see it, for the duration of that one command. That exposure is part of the chat-paste trade-off. Never use `echo`, a file, or an environment variable. If verification reports `could not verify; not stored`, stop and report that the Strategy API is unreachable. Use `--unverified` only after an explicit user request.

A human can run `mob keys import` and paste into the hidden `/dev/tty` prompt. `mob keys show` reports prefix, backend, scope, cap, and verification. `mob keys delete` removes only the local copy. `mob keys list` and `mob keys revoke <uuid>` are wallet Proposals; revoke ends the server key. Run `mob onboard` again and require its `Ready · …` line.

The CLI sends the stored key only over HTTPS, or plain HTTP to `127.0.0.1`, `::1`, or `localhost`, and only to the API base it was verified against. If `strategy_api_base` changes after import, commands that need the key stop and send nothing. Set the base back, or run `mob keys delete` and import a key for the new base.

Keychain and Secret Service items are named per home. `~/.mob` uses the service `mstack.mobius-api`; any other `MOB_HOME` uses `mstack.mobius-api:<id>`, where `<id>` is the first 16 hex characters of the SHA-256 of the home's real path. A non-default home that stored its key under the old shared name moves that item on its next read, but only when the item's key id matches the home's metadata. Metadata from before this check has no key id, so that home reports no key; import the key again. `mob keys delete` removes the item even when its metadata is missing. Deleting a home directory leaves its item behind. To find and remove such an orphan on macOS:

```sh
security dump-keychain | grep '"mstack.mobius-api:'
printf '%s' '/real/path/of/old/home' | shasum -a 256 | cut -c1-16
security delete-generic-password -s 'mstack.mobius-api:<id>'
```

On Linux, run `secret-tool clear service 'mstack.mobius-api:<id>'`. Neither command prints the key.

## Native onboarding and binding repair

The default browser path does not need local wallet signing. Use `mob bind --all` for batch repair or `mob onboard --native` for terminals without the API page. These stage a durable `c-N` ceremony. The latest user message must name that exact ceremony before browser or WalletConnect signing. A keystore ceremony belongs in the human's own terminal.

The older `mob setup` command configures a manual signer and can stage legal acceptance. `mob bind <venue>` remains the single-venue repair path.

Setup checks your current legal acceptance. If needed, it stages **Accept MoB legal terms**, shows the exact typed message, expiry and digest, and stops. Review the terms and privacy links before signing. An unconfigured legal service (503) is reported without discarding your settings. Stale terms (409) produce a new Proposal that needs separate approval. Locked policy saves settings without offering a signature.

Run `mob bind <venue>` again after each approved step. Every invocation selects one next Proposal from the server's credential and session state. A pending Proposal is shown again; it is not signed automatically.

| Venue | Steps and stored key capabilities |
|---|---|
| `hl` | Prepare, approve agent, approve builder fee up to 0.1%. Key can trade, cancel and adjust margin; cannot withdraw; expires after 179 days. The owner must have deposited. |
| `aster` | Prepare, then approve agent on chain 56. Key can trade perpetuals; cannot trade spot or withdraw; expires after 365 days. |
| `lighter` | Robinhood deployment, chain 466324: account lookup, prepare, approve key and submit the stored transaction. |
| `lighter-mainnet` | Mainnet, chain 304: the same key steps, then one integrator approval attempt. The venue's refusal is shown without retry. |

**A Lighter key can withdraw to your own address, not trade-only.** It can also trade, cancel, adjust leverage and isolated margin, and approve integrators. Third-party transfers require your L1 signature. The key has no expiry. The MoB server creates and holds the encrypted venue key.

For HL browser staging, a connection-only page first reads your current wallet chain. It requests no signature. The staged Proposal then pins that chain. Keystore and WalletConnect HL use public config `hl_signature_chain_id`, default `0xa4b1` (Arbitrum). Aster pins chain 56. Approval plans include status polling and any builder finalization; answers remain recorded if completion fails or expires. Existing standalone builder-only repairs fail explicitly without replacing a key.

Use `mob status --readiness` to inspect each venue and its separate “rebind allowed” column. `mob setup` configures the CLI; the repository's `./setup` script installs skills and the binary. `bun run smoke:bind` exercises setup and all binding deployments against local fake servers, with no live writes.

## Open, submit, and manage from your agent

Use `/mob-setup` to onboard: `mob onboard --native` stages one ceremony that accepts the legal terms when needed, binds the venues, creates a scoped key, and stores it locally, and `mob sign c-N` walks every step in one wallet session. The key never prints. Use `/mob-bind` for repair. Once Ready, use `/mob-open`, `/mob-manage`, or `/mob-close`. When your message already names both legs and the size, the skill stages at once and asks only for what is missing. The first-open risk questions are asked once per owner per day (`mob risk-ack` records them; `mob hello --json` reports `riskInterview.due`). A protected open prints **"assumed leverage, not verified on the venue"**.

With a matching key scope and cap, open, cancel, close, and resize stage an `api-submit` Proposal that stays valid for 15 minutes. The staged card and the authorization question arrive in the same reply: choose **Submit p-7 now** or reply `submit p-7`. Under default `manual` policy, the agent can run `mob submit p-7` only when your latest message says the verb and the exact id, e.g. `submit p-7`, or your chosen answer is the offered **Submit p-7 now**. A mention such as "what is p-7?" or "do not submit p-7" is not consent. Under opt-in `auto`, the agent may submit inside the key limits and must say so. If a Proposal expired, `mob restage p-7` (or `mob submit p-7` on the expired id) stages the same intent as `p-8` with a fresh preflight and stops; `p-8` needs your consent again.

Neutralize, protection, funding auto-close, and size-mismatch edits are not in the Strategy API. They stage wallet Proposals with the server's 300-second window. Choose **Sign p-7 in the browser wallet** (or with WalletConnect) or reply `sign p-7`; a vague "yes" or an older approval does not qualify.

**Keystore signing needs your own terminal, once.** Run `mob approver` there: it unlocks the keystore once per idle window (30 minutes by default, `--idle-minutes`), shows every card the agent hands over with `mob sign p-7 --with approver`, and signs only after you answer `y`. The passphrase and the key never leave that process, and the agent still needs your consent for the exact id before it hands anything over. The approver pins the record it shows and refuses to sign if the bytes changed after the card. Ctrl-D or `n` declines; Ctrl-C declines and stops the approver. The agent's call waits ten minutes for your answer; if its process disconnects first, the card is withdrawn and nothing is signed, and `mob proposal show p-7` tells the outcome. An agent shell without a TTY reaches the approver even with `--with keystore`. Without an approver, run `mob sign p-7 --with keystore` yourself; the agent never asks for your passphrase. Rejecting a Proposal also requires your request. After submission, the skill reports **"submitted, not confirmed"** and points to `mob status`.

The Claude Code plugin's Bash hook checks plain `mob sign <id>` and manual `mob submit <id>` calls against your latest typed message, which must say the verb and the exact id, or against the option you chose from the assistant's question when that offered label starts with `Submit <id>` or `Sign <id>`. Task notifications, compact summaries, command output, and tool results never count as your message. The hook denies any other command that runs `mob sign` or `mob submit`, or that names `sign` or `submit` with a Proposal id, so run them as plain commands, and it denies `eval`, `xargs`, `sh -c`, `source`, decoded scripts, shell functions, and variable command names next to `mob`. Auto submit is allowed only for a stored `api-submit` Proposal. `mob config set` for `policy`, the API bases, `key_store`, or `walletconnect_project_id` needs your own terminal and a typed `yes`; the hook also sends `mob setup --policy`, `mob onboard --app-base`, `mob upgrade`, `mob keystore create|import|list`, and `MSTACK_*` or `MOB_HOME` changes back to you. At `mob submit`, the CLI runs the stored preflight again, prints the final request, and refuses a body that no longer matches what the preflight checked. The hook allows stdin key import; the CLI refuses a positional key. The hook is a guard, not a shell sandbox.

## Session grants (preview)

PRD section 6.6 lets the owner sign one message that authorizes a locally generated agent key under scopes, caps, venues, and an expiry the server enforces, so routine mutations need one wallet interaction per session instead of one per action. The client side ships here: `mob grant create --scopes open,close --max-notional 5000 --max-tasks 3 --venues hl,lighter [--markets *] [--expires-hours 24]` generates the agent key once (a private file under `~/.mob/grants/`, never printed), stages the exact `Authorize Mobius agent: …` message for your wallet, and records the server's grant after `mob sign p-N`. `mob grant show` lists local records; `mob grant revoke <agent>` stages the revoke message. `--markets` takes base assets such as `BTC` or `NVDA`, not venue market strings. The MoB API routes (`/api/agent-grants`, `/create`, `/revoke`) are roadmap item 9 and do not exist yet, so `create` and `revoke` probe first and refuse with a clear message. A grant is recorded locally only for the agent address you signed, and a revoke only when the server confirms it. Agent-signed mutations under a grant are not implemented until the server accepts them; `policy auto` still covers only API-key submissions.

## Setup flags and signature review

The setup menu includes `browser`, `walletconnect`, and `keystore`. In your own terminal, you can pass the choices as flags; the Claude Code hook refuses `mob setup --policy` from the agent:

```sh
mob setup --owner 0x… --signer browser --policy manual
mob setup --owner 0x… --signer walletconnect --policy manual --walletconnect-project-id <id>
```

Optional flags are `--auth-base URL`, `--legal-chain-id N`, and `--no-legal`. Existing optional settings remain the defaults; new installs use `https://auth.mob.exchange` and chain 56 (BNB Smart Chain, the chain MoB production signs legal terms on). WalletConnect needs a supplied or saved public project ID. `--no-legal` reports that acceptance was skipped. Setup does not create a keystore or sign a Proposal.

All required flags avoid prompts, including on a terminal. Without a TTY, missing `--owner`, `--signer`, or `--policy` causes exit 1 and names the missing flags. Piped answers are no longer accepted. Interactive prompts show five numbered steps and defaults in brackets. Binding shows the current step, completed steps, and the next effect before the Proposal preview and stop line.

The browser page has one Connect wallet button; with several wallet extensions it first asks which one. It shows the purpose, the steps of a ceremony, the account match, the exact message (folded, with Copy), the digest, and the expiry bar, with Sign in wallet in a bar that stays on screen. When `mob` stops, the page shows how it ended, including the error, so it never ends on a lost connection. It supports phone widths and the system color scheme. Only embedded wallet icons are allowed; remote images are blocked. On a TTY, browser and WalletConnect signing print one URL, then update one countdown line every two seconds. WalletConnect also shows a QR. Without a TTY, these signers print only the URL and the final result; use `mob preview <id>` first to review the digest. A submitted result acknowledges submission, not execution.

## Installation maintenance

`./setup --host codex` links ten skill folders and the shared binary directory into `~/.agents/skills`.
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

`mob upgrade` needs your own terminal; it refuses a shell without a TTY on stdin.
For a checkout, `mob upgrade` runs a fast-forward-only Git pull, frozen dependency install, and rebuild.
With no remote, it reports that no remote is configured; it never adds one.
Downloaded installations instead fetch and verify the latest release's SHA-256
over https (`MSTACK_RELEASE_BASE_URL` may use http only for a loopback test server)
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
The shared preamble shows the hourly ASCII splash. The router's `--router` option always shows it.

Edit templates, references, and host overlays, then run `bun run gen:skills`.
Commit both generated host trees. CI rejects generation drift.
`MOB_LIVE=1 bun run live:skills` checks temporary-home setup, preambles, and strict plugin validation.
