# Changelog

Notable changes follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Version history comes from the package reports; dates describe implementation,
not a claim that public release tags or artifacts were published.

<!-- release-start -->
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
