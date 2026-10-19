# mob CLI

Build with `bun run build` at the root, then run `apps/cli/dist/mob`. The compiled binary includes the workspace packages and all ten knowledge files. It can run from any directory without Bun, source files, or `node_modules`. External runtime dependencies are `@modelcontextprotocol/sdk` 1.32.1 for MCP and `viem` 2.57.4 for address and signing primitives. The CLI uses `node:util` `parseArgs` and a small table renderer.

```sh
mob scan --size 5000 --top 5
mob scan --market PEPE --venues hl,lighter-mainnet,aster --all-pairs --json
mob scan --executable --min-apy 10 --strict
mob rates --venue hl --market BTC
mob history BTC --days 3
mob explain funding --simple
mob status --owner 0x0000000000000000000000000000000000000001
mob config set default_size_usd 5000
mob config get taker_fee_bps.hl
```

Run `mob --help` or `mob --version` for local information. Unknown commands, flags, config keys, and invalid numeric inputs exit 1.

`mob upgrade` is installation maintenance. It locates the checkout from the binary or the shipped shim, then runs `git pull --ff-only`, `bun install --frozen-lockfile`, and `bun run build`. Each failed step stops the upgrade. Without an origin remote (or for a standalone binary without a checkout), it prints `no remote configured`. No remote is created. Bun and Git are required to rebuild an installation with a remote.

## Scan and rates

`scan` defaults to size USD 1,000 and a seven-day hold (`--hold-days`). It shows two sections: Executable on MoB (five rows, `--top-exec`) and Best anywhere (ten rows, `--top`). Both limits must be integers from 1 to 200; larger values are usage errors, including with full JSON output. Each section sorts by estimated net APY descending, null last, and independently picks the first pair per base. `--all-pairs` keeps alternatives in both. `--executable` shows only the first section, using `--top`. `--min-apy` continues to filter the gross simple annualized spread; `--market` filters both sections. `--venues` selects which adapters are called.

Net APY subtracts `(taker + builder + max(mark entry cost, 0)) × 365 / holdDays` from the gross annualized spread. Negative mark entry cost never counts as a gain. Break-even retains the signed upstream calculation. This is a simple annualized estimate for a fixed hold, not compounding or a promise that rates persist. The first section omits EXEC; the second includes it.

Columns show native long/short listings, annualized spread, round-trip taker plus builder fees, signed mark entry cost, break-even hours, execution eligibility, and flags. An unmeasured entry cost is `—`. Execution eligibility does not promise order depth or a profitable fill. Fee defaults are estimates; override them for actual account terms.

`--min-volume N` defaults to $1,000,000 per leg. Unknown or lower volume adds `thin` and prevents qualification. Thin rows are hidden unless `--include-thin` is set. The footer and JSON `counts.thinHidden` count hidden pairs after market/execution/spread filters, before per-base selection and the top limit. The table labels entry cost `entry (mark est.)` and shows long/short 24-hour volume and available open interest in compact USD units.

`rates` returns raw snapshot observations with per-hour and annualized rates. `--venue` selects its adapter; `--market` filters on the classified base. Neither command changes venue-native names.

Funding output ends with snapshot age, source, simple annualization, failed venues with errors, and unmatched count. With `--json`, stdout contains one JSON document and the same human footer goes to stderr. Scan JSON defaults to `{ holdDays, observedAt, source, annualizationMethod, counts, failed, unmatched, view: { executable: [...], anywhere: [...] } }`, without an `opportunities` array. Counts are `rates`, `opportunities`, `qualifying`, `executable`, `thinHidden`, and `unmatched`. The totals cover the fetched snapshot and full ranking; only `thinHidden` depends on view filters. View filters and limits do not change the other totals.

`mob scan --json-full` implies JSON output and adds the full `opportunities` array to that shape. It can exceed 3 MB; use the bounded default for agents. The same top limits still apply to its views. CLI rates JSON stays unchanged: it retains the raw snapshot and adds `unmatched` and a filtered `view` with `ratePerHour`.

Exit codes: 0 success; 1 usage, config, or request error; 2 no venue returned any rates; 3 any snapshot/history failure with `--strict`. No-rate exit 2 takes precedence over strict partial-failure exit 3. An empty filtered view with a healthy snapshot exits 0. Partial failures remain visible with or without strict mode.

## History

`history <BASE>` defaults to seven days and all venues. It resolves all current USD-stable native listings through the snapshot classifier, including HIP-3 names and contract multipliers. Each listing reports sample count, covered hours, average/min/max hourly rate, and simple annualization. Average is total interval funding divided by total measured hours. It then compares averages across distinct venues and prints the best positive gross spread. Coverage can differ between listings. Missing listings and unavailable Lighter history are explicit; history failures appear in `failed`.

Fetchers and offline fixtures live in `packages/funding/src/history/` and `packages/funding/fixtures/`. See the [funding README](../../packages/funding/README.md#public-history) for interval boundaries, pagination, retention, and error behavior. No historical rate is replaced by a current quote.

## Explanations and task status

`explain` lists topics with no argument. Each topic has Simple and Precise sections; `--simple` prints the plain paragraph only. The Markdown files under `docs/knowledge/` are imported as text and embedded at build time. Rebuild to include edits. Unknown topics exit 1 and list valid topics.

`status` uses `--owner` or the saved `owner` config key. Without either, it exits 1 and names the missing key. Without `--task`, it reads the owner's task list. With a task ID, it reads that task. `--trims` and `--resizes` require `--task` and read every available log page. The output displays every field projected by the pinned upstream `publicTask`, including funding accrued labeled **estimate**, protection/mismatch controls, notices, close reason, error context, and timestamps. Its footer shows API base, fetch age, task count, and requested trim/resize counts.

The API base defaults to `https://funding.mob.exchange`. `--api-base` overrides config for that request. Every MoB request sends `X-Mobius-Client: mstack/<version>` and `User-Agent: mstack/<version>`, using the built package version. Non-2xx and malformed responses fail with HTTP status and a bounded body excerpt. JSON status output wraps tasks/logs with observation and source metadata. Reads by owner address are public. No populated task was verified live; tests use the explicitly hand-written public-task fixture.

## Config

`config get|set <key> [value]` uses `~/.mob/config.json`, or `$MOB_HOME/config.json` when set. Writes replace the file atomically with mode 0600. Missing files use documented defaults; malformed files fail. `get` returns the effective value.

Allowed keys are `api_base`, `owner`, `default_size_usd`, `taker_fee_bps.<venue>`, `builder_fee_tenths_bps`, `signer`, `policy`, `walletconnect_project_id`, `auth_base`, `legal_chain_id`, and `hl_signature_chain_id`. Owner must be a 20-byte `0x` address; getting an unset owner prints an empty line. The WalletConnect project ID is public application configuration, has no default, and must be a 32-character hexadecimal Reown project ID. The venue must be one of the fourteen supported identifiers. Fee values must be finite and nonnegative; the builder setting is an integer in tenths of a basis point. Size must be positive. Config contains no credentials.

## MCP server

`mob mcp` runs a stdio server for public reads and local Proposal staging. See the root [client setup instructions](../../README.md#use-from-any-mcp-client). Stdout carries protocol messages only; there are no CLI tables or footers on the protocol stream.

| Tool | Input | Result |
|---|---|---|
| `funding_scan` | Optional sizeUsd, market, venues, topExec, top, allPairs, executable, minApy, minVolume24hUsd, includeThin, holdDays, includeFull | Bounded counts and views; full opportunities only with includeFull |
| `funding_rates` | At least one of venue or market | Filtered raw rates, listings, and view; snapshot metadata |
| `funding_history` | base; optional days, venues | Settled history, coverage, best average spread, failures |
| `explain` | Optional topic, simple | Bundled Markdown or topic list |
| `task_list` | Optional owner | Public tasks |
| `task_get` | taskId; optional owner, trims, resizes | Public task and requested logs |
| `config_get` | key | Effective local config value |

Two safe session reads expose `onboarding_status` and `key_status`. The latter returns only prefix, backend, and verification state. Nine additional tools stage or inspect Proposals: `propose_open`, `propose_close`, `propose_resize`, `propose_neutralize`, `propose_protect`, `propose_auto_close`, `propose_size_mismatch_close`, `proposal_list`, and `proposal_get`. See the root [input table](../../README.md#use-from-any-mcp-client). Staging uses `src/positions.ts`, the same function as the CLI. It never imports, submits, signs, rejects, or reveals a key. Get/list return stored evidence without rerunning preflight. Propose tools are non-idempotent local writes; repeated calls create separate Proposals.

Defaults and validation match the CLI. Each tool returns one text content block: JSON for command objects, Markdown for explanations, or the config value. Missing owner errors name `mob config set owner`. There is no sign, reject, config-set, upgrade, or shell tool.

`funding_scan` uses the same bounded JSON shape as `mob scan --json`. Set `includeFull: true` to add every opportunity; it can exceed 3 MB. Both `top` and `topExec` are capped at 200. `funding_rates` adds an MCP-only requirement for `venue` or `market` and applies the filter to raw arrays as well as the view, so a market-only request does not carry every unrelated rate. Failures and unmatched markets remain visible. CLI rates behavior is unchanged.

All tools share a 60-second deadline that aborts outstanding network requests. Snapshots keep the same 30-second timeout as the CLI. Domain errors have the same `mob:` messages and `isError: true`. Partial venue failures remain in the returned JSON so clients can inspect usable data. The six modules under `src/commands/` accept typed options and an injected fetch, clock, and config home; CLI rendering and MCP transport wrap these same command functions.

## Verification

Run `bun run check`, `bun run lint`, and `bun test` here. At the root, `bun run test` runs `bun test packages apps` with the network-blocking preload. Bun 1.3.8 has one test root and does not implement the newer path-ignore setting, so `packages/cli.test.ts` imports the CLI tests while keeping `reference/` outside test discovery. Bare root `bun test` runs the same suite.

After building, `MOB_LIVE=1 bun run --filter @mstack/cli live:smoke` runs the compiled binary for the six assigned smoke commands. It uses an empty temporary config directory and prints command output and wall time. The JSON scan is summarized to keep logs small. The status check uses only the assigned dummy address.

`MOB_LIVE=1 bun run live:mcp` at the root spawns the compiled server through the SDK stdio client. It lists tools, requests a scan, and reads the simple funding explanation. Unit tests use `InMemoryTransport`, recorded venue fixtures, and the hand-written publicTask fixture with the network guard enabled.

## W7 Proposal and keystore commands

`mob keystore create | import | list` manages local encrypted keys. Create and import ask for a passphrase twice through `/dev/tty`. Import also reads the private key through that terminal. Secrets have no flags or environment settings.

Set `mob config set owner 0x…` and `mob config set signer keystore`, `browser`, or `walletconnect`. Policy defaults to `manual`; `mob config set policy locked` blocks signing. WalletConnect also requires `walletconnect_project_id`.

`mob proposals` lists stored Proposals. `mob proposal show <id>` shows the stored message, digest, body, and endpoint. `mob preview <id>` reruns its preflight and stops. After the user names the id, `mob sign <id> [--with keystore|browser|walletconnect]` shows the same intent, asks the selected wallet for approval, signs once, and submits the stored body. `mob reject <id>` makes an unsigned Proposal terminal.

Proposals expire after 300 seconds. A signed attempt cannot be retried, even after a server failure. Submission acknowledgement does not confirm execution. MCP can stage and inspect Proposals but cannot sign, submit, or reject them. See [Proposal storage](../../packages/proposals/README.md) and [keystores](../../packages/signers/README.md).

Run `bun apps/cli/scripts/smoke-proposals.ts` from the repository root for a disposable-keystore transcript against a loopback fake server. It injects a test-only secret reader, verifies the signer and every request field, and removes its temporary home. It makes no live MoB or venue requests.

## Setup and binding

`mob setup` prompts for owner, keystore/browser signer, policy, auth base and legal chain. These are public inputs; injectable prompts and stdin never carry secrets. Defaults are `https://auth.mob.exchange` and legal chain 97. Setup prints any keystore creation next step but never executes it. An already accepted legal version needs no Proposal. Otherwise review the staged typed acceptance and authorize its id separately. HTTP 503 reports an unconfigured service; HTTP 409 records the failure and stages current terms for new approval.

`mob bind hl|aster|lighter|lighter-mainnet` reads credentials and pending status, checks rebind permission before a fresh prepare, and stages one next step. After each separately authorized submission, run it again. An existing pending Proposal is reused. Every purpose states the key's capabilities. HL requires a funded owner; Lighter requires an existing account. The Lighter key **can withdraw to your own address, not trade-only**.

HL uses the browser wallet's chain from a connection-only handshake before staging, or `hl_signature_chain_id` (default `0xa4b1`) for keystore. The domain and action are fixed in the Proposal. Aster uses chain 56 with its dynamic ordered EIP-712 schema. Lighter sends chain 466324 for Robinhood or 304 for mainnet, signs the exact server message, then submits the stored `sendTx` payload with `L1Sig`. Only mainnet adds an integrator approval; a refused attempt is recorded and never retried automatically.

Status polling and builder finalization are stored in the approval's submit plan. They stop at expiry, and partial receipts retain the venue answer. A known signature is not resent on re-entry. Existing standalone builder-only repairs fail without preparing a replacement key. The [root setup guide](../../README.md#set-up-and-bind-venues) lists all steps and capabilities. Run `bun run smoke:bind` for the fake auth/funding/venue transcript.

## Browser signer

The browser backend works from an agent's shell without a secret or TTY. It prints a loopback URL and opens the system browser. Select an EIP-6963 wallet (or the browser's legacy injected wallet), connect the expected owner, compare the digest with the terminal, and approve the exact message. A different account disables signing. A pinned typed-data chain must be selected in the wallet; a refused switch is shown and no chain is added.

The HTML is bundled into `mob` and loads no external resources. Its local server uses a fresh in-memory token and strict CSP, checks the POST Origin and signature recovery, and closes after one accepted signature, human rejection, or expiry. Invalid HTTP submissions do not consume the token. Closing the tab leaves the request waiting until expiry; use the page's Reject button to cancel immediately.

Run `bun run smoke:browser` from the root for the fake wallet and fake funding-server transcript. No real browser, relay, venue, or MoB write is used.

## Open and manage

Configure `owner`, `signer`, and manual policy first. Use `mob setup` for public configuration and legal acceptance, then `mob bind <venue>` for each venue.

```sh
mob status --readiness
mob open BTC --long hl:BTC --short lighter:BTC --size 1000 --protect 8 --assume-leverage 3
mob preview p-1
# After the human authorizes this Proposal:
mob sign p-1
mob status --task TASK_ID
mob resize TASK_ID --long 0.02 --short 0.02
mob neutralize TASK_ID
mob protect TASK_ID 6
mob auto-close TASK_ID on --min-apy 10
mob size-mismatch-close TASK_ID on --pct 5
mob close TASK_ID
```

Each mutation command stages one Proposal, prints the exact message, digest, body, expiry, and named checks, then stops. A failed preflight stages nothing. `--long` and `--short` on `open` accept native `venue:market` names, including `hl:xyz:NVDA` and `aster:USD1:BTC`. `--size` is USD per leg. Quantized base amounts use the coarser venue lot. The default entry spread cap is 50 bps; `--max-spread-bps` must be positive. `--auto-close on|off`, `--min-apy N`, and `--size-mismatch pct` set the corresponding open fields. Funding APY is simple, not compounded.

Open protection defaults to off. `--protect pct` requires `--assume-leverage L[,S]`: **assumed leverage, not verified on the venue**. This estimate assumes the position's own margin, excludes other account positions, and does not change leverage or margin mode. There is no `--leverage` or `--margin` flag. Protected Aster opens fail because exchangeInfo does not publish the required maintenance-margin ladder. Use `--protect off` to stage an unprotected open explicitly.

Preview rechecks current config and stored credential/task assertions. Prices, quantities, metadata evidence, timestamp, and nonce stay fixed. Mainnet Lighter needs integrator approval with more than 24 hours left. `status --readiness` reports key replacement permission in a separate “rebind allowed” column. That check does not block opening a position. The server remains the final gate and its readiness error is printed verbatim.

Manage commands require a running task, except `close`, which accepts non-terminal tasks. Resize rounds toward the current size and refuses a tiny order or an uncloseable remainder. These six server routes have no nonce and are replayable inside their 300-second window. Each local Proposal expires after 300 seconds and can be signed once.

`bun run smoke:open` runs the keystore → open → preview → sign → status → protect → close transcript against a loopback fake server. Tests and smoke use injected TTY readers and no live writes.

## WalletConnect signer

Create a project at [Reown Cloud](https://cloud.reown.com) and copy its project ID. Save it with `mob config set walletconnect_project_id <project-id>`. The key has no default and is required when selecting `walletconnect`, including with `--with walletconnect`. The current `mob setup` menu still offers browser and keystore; select WalletConnect afterwards through config or the sign override.

The CLI prints a pairing URI and terminal QR. Scan it with a WalletConnect v2 mobile wallet and select the stored Proposal's owner. Review the exact message shown in the terminal before approving it in the wallet. A session with another owner, an unsupported method or chain, or a signature that does not recover the owner is refused. The CLI requests only the signing method needed for that Proposal. It sends no transaction request.

A typed-data domain's chain ID pins the session and request chain. Unpinned text and typed-data requests use the Ethereum mainnet namespace (`eip155:1`); this does not add a chain to an EIP-191 message or modify typed data. `chainId()` reports the selected session namespace. HL binding with WalletConnect pins `hl_signature_chain_id` (default `0xa4b1`, Arbitrum); a WalletConnect namespace does not report an independent current wallet chain. Session changes or disconnection cancel the interaction. Expiry aborts the pairing or pending signature; a late approval cannot revive it. Requests are never retried.

The backend uses `@walletconnect/sign-client` 2.25.0 and `qrcode-terminal` 0.12.0. Relay communication is required for this backend. SDK telemetry and logging are disabled. Pairing state and protocol keys stay in memory, with a separate storage namespace for each interaction. The relay connection and heartbeat are closed at the end. The SDK runs in a short-lived worker, which is terminated after cleanup to discard pending protocol timers.

`bun run smoke:walletconnect:mock` uses a mocked sign-client and a real loopback fake funding-server. It does not contact a relay. With your owner and project ID configured, `MOB_LIVE=1 bun run smoke:walletconnect` prints a real pairing URI and waits up to 60 seconds for a mobile wallet to sign a harmless test message. It makes no MoB or venue submission. Without `MOB_LIVE=1`, the live script refuses before contacting a relay.

## Home and doctor

`mob` and `mob hello` show the MoB logo and status. Options: `--big`, `--compact`, `--plain`, `--ascii`, `--offline`, `--json`. Compact output keeps the logo, palette and next command. Reads share one five-second deadline; `--offline` omits them.

`mob doctor [--json]` checks public configuration and signer availability without signing. Exit 0 means every critical check passed; exit 1 includes failed or unchecked critical checks. Unbound venues and upgrade tooling are optional. Upgrade status is based on cached `origin/main`, without a GitHub request.
