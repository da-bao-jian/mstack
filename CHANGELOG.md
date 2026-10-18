# Changelog

Notable changes follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Version history comes from the package reports; dates describe implementation,
not a claim that public release tags or artifacts were published.

<!-- release-start -->
## [Unreleased]

### Changed

- Route install health, upgrade, and uninstall questions from `/mob` to `mob doctor`, `mob upgrade`, and the per-host uninstall commands.
- Offer a one-paragraph CLAUDE.md or AGENTS.md integration at the end of the agent install, matching the gstack convention.
- Add a manifest hygiene test and a gated skill-routing eval (`MOB_EVAL=1 bun run eval:skills`).

### Removed

- The Claude Code plugin no longer registers an MCP server, and the root `.mcp.json` is gone. The skills call `mob` through Bash, which the sign guard mediates; the 18 tool schemas cost about 3,500 tokens in every session and no skill used them. `mob mcp` is unchanged for Cursor, Windsurf, Claude Desktop, and any stdio client. Claude Code users can opt in with `claude mcp add --scope user mstack -- mob mcp`.

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
