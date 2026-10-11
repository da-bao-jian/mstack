# Changelog

<!-- release-start -->
## [Unreleased]

## [0.3.0] - 2026-10-11

- Add the shared brand package, terminal home screen, and installation and account diagnostics through `mob doctor`.
- Brand the wallet signing page, show ceremony steps, and support non-interactive setup with explicit public flags.
- Publish compiled `mob` binaries for macOS arm64/x64, Linux arm64/x64, and Windows x64, with SHA-256 checksums.
- Install release binaries without Bun through `install.sh` or the plugin shim.
- Upgrade downloaded installations with checksum verification. Keep checkout upgrades on the existing Git and Bun path.
- Add a local release helper that checks the tree, runs all gates, updates versions and release notes, and creates a local tag.

## [0.2.0] - Historical summary

Summarized from [W7](docs/reports/W7.md), [W8](docs/reports/W8.md), [W9](docs/reports/W9.md), [W10](docs/reports/W10.md), and [W11](docs/reports/W11.md). These describe the 0.2 development line, including work delivered after the version bump.

- Store Proposals with policy, expiry, preview, and explicit human signing through keystore, browser wallet, or WalletConnect.
- Add wallet setup, legal acceptance, venue binding, position opening, and position management.
- Add mutation skills, MCP Proposal tools, and the Claude Code signing guard.

## [0.1.0] - Historical summary

Summarized from [W0](docs/reports/W0.md), [W1](docs/reports/W1.md), [W2](docs/reports/W2.md), [W3](docs/reports/W3.md), [W4](docs/reports/W4.md), [W5](docs/reports/W5.md), and [W6](docs/reports/W6.md).

- Add recorded venue adapters, funding snapshots, opportunity ranking, and a standalone read-only CLI.
- Add public MCP reads, knowledge topics, Claude and Codex skills, plugin packaging, and checkout setup.
- Rename the project to mstack and the command to `mob`.
<!-- release-end -->
