# Command scope

Read commands include scan, rates, history, explain, status, onboarding status,
key status, config get, proposals, proposal show, and preview.

`mob onboard` opens the API page and prints the checklist. `mob keys import
--stdin` is the agent import boundary. It never prints the key. Open, cancel,
close, and resize can stage API-submit Proposals. Protection, neutralize,
auto-close, size-mismatch edits, binding, legal acceptance, key create/list,
and key revoke still need wallet authorization.

`mob mcp`, for clients without a shell, can read onboarding and key status and
stage Proposals. It cannot import a key, submit, sign, reject, reveal a key, or
write config.

The preamble reports the binary path, version, owner presence, policy, signer,
API reachability, and cached update status. A failed health probe is a report;
the command still checks its own data. `MOB_MISSING` stops the skill.
The preamble runs in a child shell. Use its printed `MOB_BIN` path in later
commands; it cannot set variables or PATH in the caller's shell.

## Authorization helpers

`mob restage <id>` stages an expired Proposal's intent again under a new id with a
fresh preflight and stops; the new id needs new consent. `mob risk-ack` records that the
user answered the first-open risk questions; `mob hello --json` reports
`riskInterview.due` for the next 24 hours. API-submit Proposals expire after 15 minutes;
wallet Proposals after the server's 300 seconds. `mob onboard --native` stages one
ceremony that accepts the terms, binds venues, creates the key, and stores it in one
wallet session.

## Maintenance

`mob doctor` checks the installation, public config, signer, API access, legal
acceptance, readiness, and local Proposals; `--json` returns the checklist and a
failed critical item exits 1. `mob upgrade` fast-forwards a checkout and rebuilds,
or downloads and verifies the latest release binary; run it only when the user
asks to upgrade. Uninstall by host: `claude plugin uninstall mstack@mstack` for the
plugin, `./setup --host claude --uninstall` or `./setup --host codex --uninstall`
in the checkout for linked skills. `mob keys delete` first removes the local key
copy; revoking the server key needs the API page or a wallet Proposal.
