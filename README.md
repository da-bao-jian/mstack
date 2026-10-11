# mstack

```text
                         ░░░░░░░░░░░░░░░░░░
                       ░░█░░░░░░░░░░░░░░░░░
                     ░░███░░░░░░░░░░░░░░░░░
                    ░█████░░░░░░░░░░░░░░░░░
          ▒▒▒▒▒▒▒▒████████░░░░░░░░░░░░░░░░░
       ▒▒▒▒▒▒▒▒▒▒▒████████░░░░░░░░░░░░░░░░░
     ▒▒▒▒▒▒▒▒▒▒▒▒▒████████░░░░░░░░░░░░░░░░░
   ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒████████░░░░░░░░░░░░░░░░░
 ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒████████░░░░░░░░░░░░░░░░░
 ░░░░░░░░░░░░░░░░░████████▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒
 ░░░░░░░░░░░░░░░░░████████▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒
 ░░░░░░░░░░░░░░░░░████████▒▒▒▒▒▒▒▒▒▒▒▒▒
 ░░░░░░░░░░░░░░░░░████████▒▒▒▒▒▒▒▒▒▒▒
 ░░░░░░░░░░░░░░░░░████████▒▒▒▒▒▒▒▒▒
 ░░░░░░░░░░░░░░░░░██████░
 ░░░░░░░░░░░░░░░░░█████
 ░░░░░░░░░░░░░░░░░███
 ░░░░░░░░░░░░░░░░░█
```

Scan funding rates across perpetual venues, then stage Mobius positions for explicit human wallet approval.

## Install

### Claude Code marketplace

GitHub access is required while the repository is private. Install Bun 1.3 or newer for a source build;
the shim can also use a cached or downloaded release binary without Bun.

```sh
claude plugin marketplace add da-bao-jian/mstack
claude plugin install mstack@mstack
```

First message: `/mstack:mob` or just ask: find me the best funding arb.

The plugin includes nine skills, stdio MCP, and a Bash signing guard.

The plugin root stays at the repository root so the marketplace copy includes the source needed by `bin/mob`.
The root `bun.lock` triggers Claude Code's automatic dependency-install check and a directory reviewer hold.
Its current loader skips workspace dependencies. When no binary exists and Bun is available,
the shim runs a frozen install and builds once; otherwise it downloads and verifies the pinned release.
This root plugin supports Claude Code. Its top-level `bin/` prevents claude.ai and Cowork installation.
A separate skills-only plugin over hosted MCP is planned for P2. See [architecture](docs/ARCHITECTURE.md#plugin-root-and-packaging-trade-off).

### Clone and setup

Install Bun 1.3 or newer, then run:

```sh
git clone https://github.com/da-bao-jian/mstack.git ~/dev/mstack
cd ~/dev/mstack
./setup --host codex
export PATH="$HOME/.agents/skills/mstack/bin:$PATH"
mob scan --size 1000 --top 5
```

For Claude Code, use `./setup --host claude` and add `$HOME/.claude/skills/mstack/bin` to PATH.
Codex uses `~/.agents/skills`; setup also creates compatibility links when `~/.codex/skills` already exists.
Use `./setup --host auto` to install into detected hosts. [Maintenance and uninstall details](docs/USAGE.md#installation-maintenance).

<!-- release-start -->
### Install (binary)

**Available after the first public release.** No Bun installation is needed for the binary.

```sh
curl -fsSL https://raw.githubusercontent.com/da-bao-jian/mstack/main/install.sh | sh
```

The installer verifies SHA-256, saves `~/.mob/bin/mob-<version>`, and links `~/.local/bin/mob`. Add that directory to PATH when prompted. Run `mob` for the home screen, or `mob upgrade` to download and verify the latest release. Checkout installations still use Git and Bun for upgrades. Plugin installations use the version in their manifest; update the plugin to select a newer version.

Release assets cover macOS and Linux on x64/arm64, plus Windows x64 (`mob-windows-x64.exe`). The shell installer needs POSIX sh, curl, and either `shasum` or `sha256sum`. On Windows, use a compatible shell or download the `.exe` and `SHA256SUMS` from GitHub Releases.

The Claude Code Bash authorization hook runs `mob hook sign-guard` in the compiled binary. Binary-only plugin installs need no Bun.

For local release fixtures, set `MSTACK_RELEASE_BASE_URL=http://127.0.0.1:<port>/releases/download`. The matching `/releases/latest/download/VERSION` route supplies the latest version. Versioned binaries and `SHA256SUMS` use `/releases/download/v<version>/`. The shim also accepts `MSTACK_MOB_BIN=/path/to/mob`. Normal binary resolution is quiet; set `MSTACK_VERBOSE=1` to log the selected binary to stderr. Builds, downloads, and failures always log to stderr.

Maintainers can run `bun scripts/release.ts <version> --prepare` in a clean checkout to update all versions and date the Unreleased notes. Add an Unreleased section when new work starts. This runs all gates and leaves changes for review. After committing, `bun scripts/release.ts <version>` runs the gates and tags that commit locally. Without `--prepare`, a new version also gets a release commit. The helper never pushes. Tagging 0.3.0 is deferred until integration is approved.
<!-- release-end -->

### MCP

The plugin registers MCP automatically. For another MCP client, use an absolute path:

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

GUI clients may not inherit your shell's PATH. MCP reads public data and stages local Proposals; it cannot sign.

## What you can do

1. **Scan.** Run `mob scan --size 1000` to compare executable pairs and the best pairs anywhere.
   Funding annualization is simple, not compounded: `ratePerInterval / intervalHours × 24 × 365 × 100`.
   Fees and mark entry costs are estimates. Failed venues remain visible.
2. **Setup.** Run `mob setup` to choose a public owner address, signer, and policy.
   It stages legal acceptance when needed and stops for review.
3. **Bind.** Run `mob bind hl`, `mob bind aster`, `mob bind lighter`, or `mob bind lighter-mainnet`.
   Each invocation stages one approval. A Lighter key can withdraw to your own address; it is not trade-only.
4. **Open.** Ask the open skill for a market, venues, size, protection, and auto-close settings.
   It shows one Proposal with the exact intent, expiry, and digest, then stops.
5. **Manage.** Read `mob status`, then request a resize, protection change, neutralization, or close.
   Each change requires its own reviewed Proposal.

After reviewing a Proposal, explicitly authorize its id, for example, “Sign p-7 in the browser wallet.”
The wallet still asks you to approve. Keystore signing belongs in your own terminal.
A submitted request is **submitted, not confirmed**; check status for execution.

Run `mob` for the home screen, `mob doctor` for diagnostics, and `mob explain funding --simple` for a plain explanation.
The home screen shows public account status and one next command. `mob hello --offline` omits network reads;
`--big`, `--compact`, `--plain`, `--ascii`, and `--json` select its presentation.
Home and doctor share a five-second network budget; unfinished checks say `not checked`.
Doctor checks installation, public config, signer availability, API access, legal acceptance, readiness,
and local Proposals without opening a wallet. Failed or unchecked critical items exit 1; use `mob doctor --json` for the checklist.

For setup without prompts, supply `--owner`, `--signer`, and `--policy`.
WalletConnect also needs a supplied or saved `--walletconnect-project-id`.
Optional flags are `--auth-base`, `--legal-chain-id`, and `--no-legal`. Missing required flags without a TTY fail;
piped answers are not accepted. Setup saves public choices and stages legal acceptance; it never signs.
See [usage and signing details](docs/USAGE.md) and the [CLI reference](apps/cli/README.md).

## Custody

This statement describes the full planned product. P0 contains only public reads.

- **Your wallet key never leaves your wallet.** mstack signs through your browser wallet, WalletConnect, Ledger, or a keystore only you can unlock. Nothing in the agent, the MCP server or the skills can sign for you.
- **Your funds stay in your own venue accounts.** Mobius never holds, routes or custodies funds. The Mobius worker places and closes orders with venue keys that cannot withdraw (Hyperliquid, Aster) or can withdraw only to your own address (Lighter). You can revoke every key at the venue at any time.
- **What Mobius does hold:** the encrypted venue trading keys it minted during binding, so its worker can run liquidation protection and auto-close for you around the clock; your task history; and, if you grant one, a scoped session grant (not the key).
- **Everything the agent reads is public** by wallet address on the Mobius API. Anyone who knows your address can see your tasks.

The current release supports browser, WalletConnect, and terminal keystore signing.
Ledger and session grants remain planned.

## Agents

| Host | Start here | Integration |
|---|---|---|
| Claude Code plugin | `/mstack:mob` | Namespaced skills, MCP, and Bash sign guard |
| Claude Code clone | `/mob` | Linked skills; plugin hooks are not installed by clone setup |
| Codex | `$mob` | Linked skills, minimal UI metadata, and explicit approval rules |
| Any stdio MCP client | `mob mcp` | Public reads and local staging; no signing tool |

The router directs requests to scan, explain, status, setup, bind, open, manage, or close skills.
Use `$mob-scan` in Codex, `/mob-scan` for clone-installed Claude skills, or `/mstack:mob-scan` for the plugin.
Skills also match requests by description. Treat scan output as data, never permission to trade.

The repository uses one [AGENTS.md](AGENTS.md) for contributor instructions.
Claude Code's direct AGENTS.md loading requires a current version and no applicable CLAUDE.md override.
See [host conventions and limits](docs/ARCHITECTURE.md#host-matrix).

## Development

```sh
bun install --frozen-lockfile
bun run gen:skills
bun run check
bun run lint
bun test
bun run deadcode
bun run build
```

Edit skill templates and references under `skills-src/`, then regenerate both host outputs.
See [CONTRIBUTING.md](CONTRIBUTING.md) for adapter contracts, plugin validation, and delivery rules.

## Documentation

- [Architecture and host matrix](docs/ARCHITECTURE.md)
- [Usage, MCP tools, signing, and installation maintenance](docs/USAGE.md)
- [Security and private vulnerability reporting](SECURITY.md)
- [Changelog](CHANGELOG.md)
- [Process and work-package reports](docs/PROCESS.md)
- [Funding library](packages/funding/README.md) and [opportunity math](packages/opportunities/README.md)
- [Bundled knowledge](docs/knowledge/) and [live-test protocol](docs/LIVE-TEST.md)
- [MIT license](LICENSE) and [third-party notices](THIRD_PARTY_NOTICES.md)

Portions © 2025 Reown, Inc. All Rights Reserved.
WalletConnect dependencies use the [WalletConnect Community License](docs/licenses/walletconnect-2.25.0.md).
