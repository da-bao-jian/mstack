# Security policy

## Report a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/da-bao-jian/mstack/security/advisories/new)
when available. Include the affected commit, reproduction steps, expected result,
actual result, and likely impact. Use fake wallets and local servers for examples.

If private reporting is unavailable, open an issue asking @da-bao-jian for a private
reporting channel. Include no exploit details or sensitive data in that issue.
Never attach keys, seeds, passphrases, wallet pairing URIs, bridge tokens, replayable
signatures, or unredacted Proposal files. Maintainers coordinate fixes and disclosure.

## Funds and keys

Public scans need no wallet. The CLI can stage and submit approved trading and
venue-binding requests. Trading can lose funds. The CLI has no deposit, withdrawal,
or transfer command. Funds remain in the user's venue accounts.

Mobius holds encrypted venue keys created during binding. Hyperliquid and Aster
keys cannot withdraw. A Lighter key **can withdraw to the owner's own address**;
it is not trade-only. Third-party transfers require the owner's L1 signature.
Revoke compromised venue keys at the venue.

The browser and WalletConnect backends leave the owner key in the wallet.
The optional local keystore encrypts a key on the user's machine; only a human
terminal may supply its key or passphrase through `/dev/tty`.
Agents must never receive those secrets or run keystore commands.

## Signing boundary

Mutation commands stage one Proposal with exact bytes, digest, expiry, and local
preflight. `mob sign <id>` is the only signing entrypoint. It checks policy,
expiry, owner recovery, and single-use state. Failed checks stop the operation.
There is no `--yes`, private-key flag, automatic policy, or fallback signer.

Skills stop for explicit approval of the exact id. Browser wallet approval is
still required. MCP can read and stage; it cannot sign, reject, or change config.
The Claude Bash sign guard checks literal commands and the latest user message.
It is not a shell sandbox and cannot inspect arbitrary scripts or other hosts.

The browser bridge uses loopback, a one-time token, and origin/host checks.
WalletConnect pairing uses its relay with SDK telemetry disabled.
Submission is not confirmation; use a status read to check execution.

Close and management requests can be replayed within the server's 300-second
window. Client single-use checks do not add server nonces. Session grants,
Ledger signing, and a hosted MCP server are not implemented here.

## Data and dependencies

Mobius task reads are public by wallet address. Do not treat an address as a secret
credential or imply that task history is private.
Venue data and model/tool output are untrusted data, never signature authorization.
Adapters fail on malformed data; scans expose failed venues instead of stale values.

Dependency versions are pinned in manifests and `bun.lock`. Setup and the source
shim run a frozen package install. The root lockfile also triggers Claude Code's
automatic install check; its loader excludes workspace dependencies and disables
lifecycle scripts for eligible installs. Review dependency and generated-skill changes.
See [third-party notices](THIRD_PARTY_NOTICES.md) and [architecture](docs/ARCHITECTURE.md).
