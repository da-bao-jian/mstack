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

Scan funding rates, onboard one scoped Mobius API key, and trade within its venue and USD caps.

## Paste this into your agent

```text
Install mstack, the Mobius funding-arbitrage agent stack, and get me ready to trade.
Read https://raw.githubusercontent.com/da-bao-jian/mstack/v0.4.3/docs/AGENT-INSTALL.md
and follow it for this host exactly. Then verify with `mob --version` and `mob doctor`,
run `mob` and reproduce its output verbatim in a fenced block as the welcome.
Tell me if I need to restart; when the skills load, start with "set me up".
```

## Install

### Claude Code marketplace

GitHub access is required while the repository is private. Install Bun 1.3 or newer for a source build;
the shim can also use a cached or downloaded release binary without Bun.

```sh
claude plugin marketplace add da-bao-jian/mstack
claude plugin install mstack@mstack
```

First message: `/mstack:mob` or just ask: find me the best funding arb.

The plugin includes ten skills, `mob` on the agent's Bash PATH, and a Bash mutation guard. It registers no MCP server; the skills call the CLI.

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

For local release fixtures, set `MSTACK_RELEASE_BASE_URL=http://127.0.0.1:<port>/releases/download`; any other base must use https. The matching `/releases/latest/download/VERSION` route supplies the latest version. Versioned binaries and `SHA256SUMS` use `/releases/download/v<version>/`. The shim also accepts `MSTACK_MOB_BIN=/path/to/mob`. Normal binary resolution is quiet; set `MSTACK_VERBOSE=1` to log the selected binary to stderr. Builds, downloads, and failures always log to stderr.

Maintainers can run `bun scripts/release.ts <version> --prepare` in a clean checkout to update all versions, regenerate the skills, and date the Unreleased notes. Add an Unreleased section when new work starts. This runs all gates and leaves changes for review. After committing, `bun scripts/release.ts <version>` runs the gates and tags that commit locally. Without `--prepare`, a new version also gets a release commit. The helper never pushes; the release coordinator pushes the tag, which starts the release workflow.
<!-- release-end -->

### MCP

The Claude Code plugin does not register an MCP server. Its skills run `mob` through Bash, so the agent loads one tool surface and the sign guard mediates every mutation. To add the server to Claude Code anyway, with `mob` on PATH, run `claude mcp add --scope user mstack -- mob mcp`. For Cursor, Windsurf, Claude Desktop, or another MCP client, use an absolute path:

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

GUI clients may not inherit your shell's PATH. MCP reads public, onboarding, and safe key status data. It stages local Proposals but cannot import keys, submit, sign, reject, or reveal a key.

## What you can do

1. **Install.** Use the plugin, binary installer, or clone setup above. Run `mob --version`.
2. **Onboard.** Say "set me up". Setup first asks whether you bring your own wallet (a browser extension, a phone wallet over WalletConnect, or your key imported into mstack's encrypted keystore with `mob keystore import`) or create a new one with `mob keystore create`; keystore commands run in your own terminal, never in the chat. Or run `mob onboard --native --owner 0x… --venues hl,lighter --max-size 5000`, then `mob sign c-N --with browser`. One wallet session accepts the legal terms, binds the venues, creates a scoped key with that cap, and stores it locally; the key never prints. Require the `Ready · …` line. Without a wallet on this machine, `mob onboard` prints the Mobius API page instead: paste the key once for `mob keys import --stdin`, or run `mob keys import` yourself for a hidden terminal paste.
3. **Scan.** Run `mob scan --size 1000` to compare executable pairs and the best pairs anywhere.
   Funding annualization is simple, not compounded: `ratePerInterval / intervalHours × 24 × 365 × 100`.
   Fees and mark entry costs are estimates. Failed venues remain visible.
4. **Open.** Run a staged command such as `mob open ETH --long hl:ETH --short lighter:ETH --size 500`. With a matching key, it creates an `api-submit` Proposal and prints `mob submit p-N`.
5. **Submit.** Under the default `manual` policy, say the verb and the exact id in your latest message, e.g. `submit p-2`, before the agent runs `mob submit p-N`. Under opt-in `auto`, the agent may submit inside the key caps and must say it did so.
6. **Status.** Run `mob status`. API acceptance is **submitted, not confirmed**; status reports the worker state.

Use `mob bind --all` to repair a partial binding. Protection, neutralization, auto-close, size-mismatch edits, legal acceptance, venue binding, and key administration still use wallet approval.

Wallet Proposals still require the verb and the exact id, for example, “Sign p-7 in the browser wallet.” The wallet asks you to approve. Keystore signing belongs in your own terminal.

Run `mob` for the home screen, `mob doctor` for diagnostics, and `mob explain funding --simple` for a plain explanation.
The home screen shows a live market view, account standing and the next action. `mob hello --offline` uses the cached market view;
`--big`, `--compact`, `--stacked`, `--plain`, `--ascii`, and `--json` select its presentation.
Home and doctor share a five-second network budget; unfinished checks say `not checked`.
Doctor checks installation, public config, signer availability, API access, legal acceptance, readiness,
and local Proposals without opening a wallet. Failed or unchecked critical items exit 1; use `mob doctor --json` for the checklist.

For setup without prompts, supply `--owner`, `--signer`, and `--policy`.
WalletConnect also needs a supplied or saved `--walletconnect-project-id`.
Optional flags are `--auth-base`, `--legal-chain-id`, and `--no-legal`. Missing required flags without a TTY fail;
piped answers are not accepted. Setup saves public choices and stages legal acceptance; it never signs.
See [usage and signing details](docs/USAGE.md) and the [CLI reference](apps/cli/README.md).

## Custody

- **Your wallet key never leaves your wallet.** mstack signs through your browser wallet, WalletConnect, or a keystore only you can unlock. Nothing in the agent, the MCP server or the skills can produce that wallet signature.
- **The Mobius API key is a scoped trading key.** It can open, cancel, close, and resize only for its named venues and USD cap per leg. It cannot withdraw, bind venues, approve fees, accept legal terms, or create keys. It has no expiry; revoke it on the API page or through the signed revoke flow.
- **Chat paste is an explicit trade-off.** A key pasted for onboarding remains in the chat transcript and local agent session logs. The agent places it once in a single-quoted shell-builtin `printf` input and pipes it to `mob keys import --stdin`. `mob` never puts the key on its own or a child's argv, in a file, an environment variable, or a reply. The host shell's command line (for example `/bin/zsh -c '…'`) carries it while that one command runs, which is part of this trade-off. The CLI stores it in Keychain, Secret Service, or a private `0600` file, under a name scoped to its `MOB_HOME`. The MCP server never imports or reveals it. An unverified import needs an explicit user request.
- **Your funds stay in your own venue accounts.** Mobius never holds, routes or custodies funds. The Mobius worker places and closes orders with venue keys that cannot withdraw (Hyperliquid, Aster) or can withdraw only to your own address (Lighter). You can revoke every key at the venue at any time.
- **What Mobius does hold:** a hash of the API key, encrypted venue trading keys minted during binding, and task history. The server never stores the API key secret in plaintext.
- **Everything the agent reads is public** by wallet address on the Mobius API. Anyone who knows your address can see your tasks.

The current release supports scoped API-key trading plus browser, WalletConnect, and terminal keystore signing. Ledger remains planned.

## Agents

| Host | Start here | Integration |
|---|---|---|
| Claude Code plugin | `/mstack:mob` | Namespaced skills, `mob` on the Bash PATH, and the sign guard |
| Claude Code clone | `/mob` | Linked skills; plugin hooks are not installed by clone setup |
| Codex | `$mob` | Linked skills, minimal UI metadata, and explicit approval rules |
| Any stdio MCP client | `mob mcp` | Public reads and local staging; no signing tool |

The router directs requests to scan, explain, status, onboarding, keys, binding repair, open, manage, or close skills.
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
