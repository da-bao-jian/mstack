# Changelog

Notable changes follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Version history comes from the package reports; dates describe implementation,
not a claim that public release tags or artifacts were published.

<!-- release-start -->
## [Unreleased]

### Added

- Native onboarding in one wallet session: `mob onboard --native` stages one ceremony that accepts the legal terms when needed, binds the venues, creates the scoped API key, and stores it locally; `mob sign c-N` walks every step on one page and the key never prints. Flags `--name` and `--max-size` set the key.
- `mob restage <id>` stages an expired task Proposal's intent again under a new id with a fresh preflight; `mob sign` and `mob submit` on an expired id do the same and stop, so the new id needs new consent.
- `mob risk-ack` and `riskInterview` in `mob hello --json`: the first-open risk questions are due once per owner per day instead of once per conversation.
- `mob approver`: a persistent approver for keystore users. It runs in the human's own terminal, unlocks the keystore once per idle window, shows each card the agent hands over with `mob sign <id> --with approver` (chosen automatically when the signer is `keystore`, the caller has no TTY, and an approver answers), and signs after the human types `y`. `mob hello --json` reports `approver.running`.
- Session grants, client side (PRD 6.6): byte-exact `Authorize Mobius agent` and `Revoke Mobius agent` builders, the proposed `/api/agent-grants` routes, and `mob grant create|show|revoke`, which generates a local agent key once, stages the owner-signed message, and records the server's grant. `create` probes the API first and refuses while the routes do not exist; agent-signed mutations are not implemented yet.
- `mob status --readiness --json` carries a compact per-row glossary (about 5 KB for four venues instead of 42 KB).
- The Bash sign guard accepts the answer the human chose from an AskUserQuestion the assistant asked, when the chosen label starts with `Submit p-N` or `Sign p-N`; the skills offer those labels in the same reply as the staged card.

### Changed

- `mob sign <id> --with approver` waits ten minutes for the human's answer (was one hour) and, on timeout, points the agent at `mob proposal show <id>`.
- API-submit Proposals keep a 15-minute window; wallet Proposals keep the server's 300 seconds.
- `/mob-setup` is native-first: one authorization instead of three and no key paste; the Mobius page and paste path remain the fallback for a wallet that is not on this machine.

- Seven more scan venues: MEXC, BingX, Bitget, Gate, GRVT, Variational, and QFEX. Each adapter reads the venue's public bulk feeds, keeps native market names, and ships with recorded fixtures, pinned expected rows, and scope tests. GRVT tickers are fetched per instrument with bounded concurrency; QFEX publishes no mark price, so its entry cost stays unmeasured; MEXC coin-margined, Bitget USDC and coin products, Gate's BTC-settled book, Variational swaps, and non-USD QFEX quotes are out of scope. Default taker fees come from each venue's published base tier.

### Fixed

- `mob approver` could not start from the shipped binary: it demanded an injected passphrase reader. It now reads the passphrase from the controlling terminal.
- The approver pins the record it shows (Proposal content hash or ceremony fingerprint) and refuses to sign when the bytes changed after the card. Ctrl-C and Ctrl-D at its prompt decline instead of wedging the queue, a failing request never blocks the next one, a card whose requester disconnected is withdrawn and never signed, a mistyped passphrase after the idle window is not cached, a second approver on the same home is refused, SIGHUP cleans up like Ctrl-C, and a home path too long for a unix socket fails with a clear message.
- `mob grant`: `revoke` probes the server like `create`; a grant answer is recorded only for the agent address the owner signed, and a revoke only when the server confirms `ok`; `--markets` takes base assets only and rejects venue market strings and repeats.
- Compact readiness rows name only the venues they mention, skip the scan-only glossary notes, and document `issue` and `check`.
- After signing through the approver, Ctrl-C no longer kills it without cleanup: Bun drops its native signal handler when the sign path removes its own listeners, so signing inside the approver now cancels through the approver's signal instead of process listeners.
- The Claude overlay's signing question keeps four choices: the approver choice replaces the keystore-myself choice while an approver runs.
- A new user's first `mob sign c-N` no longer stops at "Run `mob setup` first": native onboarding saves the owner but no signer, so the signing choice now maps to an explicit `--with browser`, `--with walletconnect`, or `--with approver` (each with a ten-minute tool timeout), and with an owner but no signer the CLI names the `--with` choices instead of sending the user back to setup.
- Venue-binding requests from the server are checked against an exact allow-list per venue and action (domain, chain id, verifying contract, types, every message field, the owner, `CanWithdraw: false`, fee caps) and against the venues the owner asked to bind. Before, only their shape was checked, so a compromised or redirected server could have had a withdrawal or a token permit signed as "binding". Stored ceremony requests are checked again on every load, and the ceremony fingerprint covers them.
- The approver renders the card and pins its hash from one read of the record, closing a window where a swap between the two reads could show one Proposal and sign another.
- `mob sign c-N --with browser` no longer waits forever: the bridge accepts the wallet account before the first step is current, which is when the CLI asks for it.
- The signing link opens once; the page then uses an HttpOnly session cookie, so the link printed for the agent cannot drive the bridge. The bridges answer malformed JSON with 400 instead of Bun's development error page.
- The signing page no longer claims "It cannot move funds" for every signature; each step names what it allows.
- Keychain and Secret Service entries are per home. They were keyed by owner only, so a second `MOB_HOME` for the same wallet overwrote the first home's API key, paired one home's metadata (caps, API base) with the other's key, and `mob keys delete` in one home deleted the other's. `~/.mob` keeps the service `mstack.mobius-api`; any other home uses `mstack.mobius-api:<home id>`. A non-default home that stored its key before this change imports it again.
- Error messages cut response bodies only after redacting them, so an API key that crossed the 240-character cut no longer leaked up to 63 secret characters; a trailing key fragment is dropped, and a `/api/keys/create` answer is never echoed.
- The macOS Keychain write no longer puts the API key on the `security` command line: it goes through `security -i` on stdin and is read back, because `security -i` can exit 0 after a failed add. The docs now say that the host shell running an agent's `printf … | mob keys import --stdin` still carries the key on its own command line for that one command.
- The stored API key is sent only to the API base it was verified against; `mob status`, `mob submit`, and `mob onboard` refuse and send nothing when `strategy_api_base` changed since import. `api_base`, `strategy_api_base`, `auth_base`, and `app_base` take HTTPS only, or plain HTTP for `127.0.0.1`, `::1`, or `localhost`, whether set with `mob config set` or edited by hand.
- New keystores use scrypt N = 2^17 (was 2^15) with the KDF parameters stored in the file and bound into the encryption, and need a passphrase of at least 12 characters. Existing keystores still unlock and are rewritten in the new format after their next successful unlock.
- `mob grant create` keeps the agent key in a 0600 file in a 0700 directory, refuses symlinks and loose modes, and creates the key exclusively, so two concurrent runs stage grants for the same agent key instead of one overwriting the other's.
- A non-default home whose key sits under the old shared Keychain or Secret Service name moves it on the next read when the key id matches that home's metadata (new imports record the id). `mob keys delete` removes a stored key even when its metadata is missing; `docs/USAGE.md` explains how to remove an orphaned per-home item.
- A locked Keychain, a denied request, or a missing D-Bus session is now an error instead of "no key": only `security` exit 44 and an empty `secret-tool lookup` miss mean the key is absent.
- Storing a key writes its metadata first and commits it last, so a failed store no longer leaves a secret without metadata.
- Backspace at a hidden passphrase or key prompt removes a whole character instead of one byte of a multi-byte UTF-8 character, and the input is NFC-normalized.
- `mob keys create`, native onboarding, and `mob sign` of a key-creation Proposal check that the key store can save a key before the server creates it, so a key is no longer created into a read-only `MOBIUS_API_KEY` override or a locked store and lost.
- An empty `MOB_HOME` means `~/.mob` instead of the current directory, and a relative `MOB_HOME` is refused, in the CLI and in the Bash sign guard.
- `mob config set` of `policy`, `api_base`, `strategy_api_base`, `auth_base`, `app_base`, `key_store`, or `walletconnect_project_id` now needs the human's terminal (TTY on stdin and stdout) and a typed `yes` from `/dev/tty`; an agent shell could switch to `policy auto` and then submit without consent.
- The Bash sign guard reads consent only from messages Claude Code marks as typed by the human; task notifications, compact summaries, command output, and unmarked or merged events no longer count, and an unrecognized event revokes consent.
- The guard reads AskUserQuestion answers from Claude Code's structured answers and accepts only an exact offered label for the matching question; assistant-written question or preview text can no longer supply a fake answer, and free-text "Other" answers do not authorize.
- When mob is in play (named anywhere in the command, through `MOB`/`MOB_BIN`, or the CLI's dev entry) or `sign`/`submit` is followed by a Proposal id, the guard denies anything outside a plain `mob sign|submit <id>` command, including `eval`, `xargs`, `sh -c`, `source`, decoded scripts, shell functions, and variable command names; quoting, backslashes, copied binaries, `bun main.ts`, and wrappers no longer slip past it. Plain paths such as `~/.mob/bin/mob-<version>` are now checked instead of ignored. Commands that never involve mob, such as `git commit -m 'sign …'` or `grep submit`, are left alone.
- Text consent needs the verb right before the exact id, such as `submit p-2` or `sign c-1`, and a negation such as "do not" just before the verb denies it; a bare mention of the id no longer counts.
- `mob submit` runs the stored preflight again, prints the final request (route, legs, size), and refuses a record whose body no longer matches the evidence and purpose shown at staging.
- The guard sends `mob setup --policy`, `mob onboard --app-base`, `mob upgrade`, and `MSTACK_*` or `MOB_HOME` changes next to mob back to the human; `mob upgrade` also refuses a shell without a TTY.
- Release downloads in `install.sh` and `mob upgrade` require https (http only for a loopback test server), including redirects; every installer `curl` uses `--proto`, `--proto-redir`, and `--tlsv1.2`. GitHub Actions are pinned to commit SHAs.
- The key-import instructions tell the agent to check the exact `mobius_…` key format before running the import, and otherwise to ask the human to run `mob keys import`.

## [0.4.1] - 2026-10-18

### Changed

- Route install health, upgrade, and uninstall questions from `/mob` to `mob doctor`, `mob upgrade`, and the per-host uninstall commands.
- Offer a one-paragraph CLAUDE.md or AGENTS.md integration at the end of the agent install, matching the gstack convention.
- Add a manifest hygiene test and a gated skill-routing eval (`MOB_EVAL=1 bun run eval:skills`).

### Removed

- The Claude Code plugin no longer registers an MCP server, and the root `.mcp.json` is gone. The skills call `mob` through Bash, which the sign guard mediates; the 18 tool schemas cost about 3,500 tokens in every session and no skill used them. `mob mcp` is unchanged for Cursor, Windsurf, Claude Desktop, and any stdio client. Claude Code users can opt in with `claude mcp add --scope user mstack -- mob mcp`.

### Fixed

- The release helper regenerates the skills with the new version and commits them, instead of stopping on its own drift check after the bump. It also moves the previous release tag forward in the install docs, and the tests that pin the client header and the home screen now read the version from the manifests.

### Security

- The Bash sign guard sets `onFailure: block`, so a guard that cannot start, crashes, or times out blocks the call on Claude Code 2.1.295 or newer instead of letting it through. The hook timeout is 30 seconds.

## [0.4.0] - 2026-10-12

### Added

- One-visit `mob onboard` flow with the Mobius API page, legal and venue checklist, scoped key import, native batch ceremonies, and a Ready summary.
- Local API-key custody through Keychain, Secret Service, or a private file, with import, show, list, revoke, and delete commands.
- Strategy API task reads and idempotent open, cancel, close, and resize submission through `mob submit`.
- Manual and opt-in auto submission policies with exact-id hook enforcement.
- `/mob-keys`, session-aware setup, bind, open, manage, and close skills for Claude Code and Codex.
- Read-only MCP tools `onboarding_status` and `key_status`.
- Journey E smoke coverage for onboarding, stdin import, open, submit, status, and key confinement.
- Neofetch-style home screen: the MoB logo in brand colors beside live top pairs, trending markets, account standing and the next action. Every skill greets with it once per session, and the paste-prompt install ends on it.
- `docs/AGENT-INSTALL.md` and the paste prompt in the README, so an agent installs the plugin, the binary or the Codex skills from one URL.

### Changed

- The skill greeting rule reproduces the lines between the `<mob-home>` and `</mob-home>` tags and leaves the tag lines out of the welcome.
- Make browser-page onboarding the default setup path. Keep binding repair and native onboarding as wallet-signing paths.
- Report relative ceremony expiry in `mob proposals` and make help coverage exhaustive for parser commands and subcommands.
- Prevent the onboarding Ready screen from showing contradictory key and legal `not checked` rows.
- Update custody, architecture, usage, and readiness documentation for the scoped API key.

### Security

- Never print, persist in Proposals, or return the API key through MCP. Positional key import is refused; agent import uses stdin only.
- The scoped key cannot withdraw, bind venues, approve fees, accept legal terms, or create keys.

## [0.3.0] - 2026-10-11

### Added

- Add the shared brand package, terminal home screen, and installation and account diagnostics through `mob doctor`.
- Brand the wallet signing page, show ceremony steps, and support non-interactive setup with explicit public flags.
- Publish compiled `mob` binaries for macOS arm64/x64, Linux arm64/x64, and Windows x64, with SHA-256 checksums.
- Install release binaries without Bun through `install.sh` or the plugin shim.
- Add a local release helper that checks the tree, runs all gates, updates versions and release notes, and creates a local tag.
- Add JSON and skill glossaries, advisory API reachability labels, and opt-in cross-deployment pairs with hidden counts in scan output.
- W13: contributor and security guides, architecture and process docs, issue and PR
  templates, dependency notices, EditorConfig, code ownership, and pinned Renovate updates.
- W13: portable skill metadata, direct references, Codex UI metadata, and conformance tests.
- W17: deterministic fuzz/property tests, a complete dependency inventory, and a
  [readiness report](docs/READINESS.md) with the remaining human launch checks.

### Changed

- W12: installer ends with the home screen; the router displays an hourly ASCII splash.
- Upgrade downloaded installations with checksum verification. Keep checkout upgrades on the existing Git and Bun path.
- Recover interrupted signing safely, reclaim stale Proposal locks, and close the signing page or WalletConnect session on cancellation.
- Show Proposal state at read time, relative expiry or terminal end time, clear preview cards, and legal statements before exact typed data.
- Simplify first-run guidance, command help, argument errors, unset config output, and WalletConnect smoke prerequisites.
- Group position status, format human-readable numbers and times, and apply terminal-only brand colors that respect `NO_COLOR`.
- Run the signing guard in the compiled CLI so binary-only plugin installs need no Bun.
- W13: one shared `AGENTS.md`, compact generated skills, and a committed preamble shim.
- W13: Codex installs into `~/.agents/skills`, with compatibility links in an existing
  `~/.codex/skills`; uninstall removes owned links from both roots.
- W13: complete plugin metadata, own-marketplace install instructions, and reorganized README.
- W13: report upgrade-check failures on one line with a reason, without Git stderr noise.
- W15: non-interactive setup rejects missing required flags and no longer accepts piped answers.
- W17: the sign guard retains human consent across tool results and accepts safe
  output redirections. Expired legal and binding-prepare Proposals refresh to a new
  id and stop. Binding reports missing legal acceptance; open skills check readiness first.
- W17: private Proposal/keystore directories, full-record corruption checks,
  signature redaction, one-shot browser submissions, and keystore account cleanup.
- W17: thin pairs cannot be executable; cross-deployment pairs remain informational.
  WalletConnect is an exact optional dependency behind its dynamic import.

### Removed

- W13: SessionStart install notice; installation guidance stays in setup output and the router.

## [0.2.0] - 2026-10-11

### Added

- Exact-message Proposals, five-minute expiry, digests, manual/locked policy, and single-use signing.
- Human-terminal encrypted keystore, browser wallet bridge, and WalletConnect approval.
- Public wallet setup, legal acceptance, and stepwise Hyperliquid, Aster, and both Lighter bindings.
- Client-side preflight for opening and managing positions, with explicit assumed leverage.
- Mutation skills with exact-id approval rules, local MCP staging tools, and a Claude Bash sign guard.

### Changed

- Binding readiness and permission to replace an existing binding are reported separately.
- CLI and MCP share staging, preflight, and signature-free Proposal views.

Sources: [W7](docs/reports/W7.md), [W8](docs/reports/W8.md), [W9](docs/reports/W9.md),
[W10](docs/reports/W10.md), and [W11](docs/reports/W11.md).

## [0.1.0] - 2026-10-10

### Added

- Bun/TypeScript workspace, strict checks, Biome, fixture tests, and dead-code checks.
- Public Hyperliquid, Lighter, Aster, Binance, Bybit, and OKX funding adapters.
- Fee-adjusted opportunities, native-market matching, simple annualization, and explicit venue failures.
- Compiled `mob` CLI for scans, rates, history, explanations, public status, and configuration.
- Claude and Codex read skills, source-build shim, host installer, plugin marketplace, and stdio MCP.

### Changed

- Renamed the project and workspace scope to mstack while retaining the `mob` command and `~/.mob` state.

Sources: [W0](docs/reports/W0.md), [W1](docs/reports/W1.md), [W2](docs/reports/W2.md),
[W3](docs/reports/W3.md), [W4](docs/reports/W4.md), [W5](docs/reports/W5.md), and [W6](docs/reports/W6.md).
<!-- release-end -->
