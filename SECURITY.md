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
New keystores use scrypt N = 2^17 with the parameters bound into the encryption, and need
a passphrase of at least 12 characters; older files are rewritten after their next unlock.

The scoped Mobius API key lives in Keychain, Secret Service, or a private `0600` file,
named per home. `mob` never puts it on any process's argv: Keychain writes go through
`security -i` on stdin and are read back. When an agent imports a pasted key with
`printf '%s' '…' | mob keys import --stdin`, the host shell's own command line (for example
`/bin/zsh -c '…'`) carries the key while that one command runs, visible to same-user process
listings; this is part of the documented chat-paste trade-off. The CLI sends the key only
over HTTPS (plain HTTP only to loopback) and only to the API base it was verified against.

## Signing boundary

Mutation commands stage one Proposal with exact bytes, digest, expiry, and local
preflight. `mob sign <id>` is the only signing entrypoint. It checks policy,
expiry, owner recovery, and single-use state. Failed checks stop the operation.
There is no `--yes`, private-key flag, automatic policy, or fallback signer.

Skills stop until the human says the verb and the exact id, e.g. `submit p-2`. Browser wallet approval is
still required. `mob approver` runs only in the human's terminal: it caches the passphrase in
memory for its idle window, answers a local socket inside the 0700 home, and signs a
Proposal only after the human answers y to its card; the agent sees the relayed output and
never the passphrase. The per-run token is a freshness check, not an access boundary: any
same-user process can read it, so the boundaries are the private home directory and the
human's y. The approver pins the record it shows and refuses to sign bytes that changed
after the card, and it withdraws a card whose requester disconnected before the answer. The Claude Code plugin registers no MCP server, so every agent
command in that host passes through the Bash sign guard. `mob mcp`, for other
clients, can read and stage; it cannot sign, reject, or change config.
The Claude Bash sign guard allows a plain `mob sign <id>` or `mob submit <id>`
only when the latest human input says the verb and the exact id, e.g. `submit p-2`,
with no negation in the three words before the verb, or when the human chose an
option the assistant offered in AskUserQuestion whose exact label starts with
`Submit <id>` or `Sign <id>`. Human input is a message Claude Code marks as typed by
the human, or the structured answer to the assistant's own question. Task
notifications, compact summaries, command output, free-text "Other" answers, and
other tool results never grant consent; an unrecognized event revokes it.
The guard denies `sign` or `submit` outside a plain mob invocation; `eval`, `xargs`,
`sh -c`, `source`, decoded scripts, shell functions, and variable command names
next to mob; `mob config set` of the policy, API bases, key store, or WalletConnect
project; `mob setup --policy`; `mob onboard --app-base`; `mob upgrade`; and
`MSTACK_*` or `MOB_HOME` assignments with mob. The CLI also requires the human's
terminal and a typed `yes` from `/dev/tty` for those config keys, and a terminal for
`mob upgrade`. `mob submit` runs the stored preflight again, prints the final
request, and refuses a body that no longer matches the evidence the preflight checked.
It is not a shell sandbox and cannot inspect arbitrary scripts or other hosts.
On Claude Code 2.1.295 or newer, a guard that cannot start, crashes, or times out
blocks the call. Older versions let such a call continue; the CLI policy, expiry,
owner, and single-use checks still apply there.

The browser bridge uses loopback, origin/host checks, and a link that opens once:
the first page load trades its token for an HttpOnly session cookie, so a copy of
the link in a terminal or an agent transcript cannot drive the bridge.
Venue-binding requests prepared by the server are checked against the exact
request each venue uses (domain, chain, types, and every message field, including
`CanWithdraw: false` and the owner) and against the venues the owner asked to
bind, when they arrive and again whenever a stored ceremony loads; anything else,
such as a token permit or a withdrawal, is refused before any wallet sees it.
WalletConnect pairing uses its relay with SDK telemetry disabled.
Submission is not confirmation; use a status read to check execution.

Close and management requests can be replayed within the server's 300-second
window. Client single-use checks do not add server nonces. Session grants,
Ledger signing, and a hosted MCP server are not implemented here.

## Known limits

- The agent runs as the same OS user as the human, so `~/.mob`, Proposal files,
  the config, and the Claude Code transcript are writable by it. The sign guard
  protects against mistakes and prompt injection that stay inside the tool
  interface. It does not stop an agent that deliberately edits local files or
  forges transcript lines. The wallet signature and the server's key caps are the
  hard limits; the Proposal content hash is unkeyed.
- TODO: releases carry SHA-256 sums from the same origin as the binaries and no
  signature yet. Downloads require https, except a loopback test server.

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
