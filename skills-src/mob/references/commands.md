# Command scope

Read commands include scan, rates, history, explain, status, onboarding status,
key status, config get, proposals, proposal show, and preview.

`mob onboard` opens the API page and prints the checklist. `mob keys import
--stdin` is the agent import boundary. It never prints the key. Open, cancel,
close, and resize can stage API-submit Proposals. Protection, neutralize,
auto-close, size-mismatch edits, binding, legal acceptance, key create/list,
and key revoke still need wallet authorization.

MCP can read onboarding and key status and stage Proposals. It cannot import a
key, submit, sign, reject, reveal a key, or write config.

The preamble reports the binary path, version, owner presence, policy, signer,
API reachability, and cached update status. A failed health probe is a report;
the command still checks its own data. `MOB_MISSING` stops the skill.
The preamble runs in a child shell. Use its printed `MOB_BIN` path in later
commands; it cannot set variables or PATH in the caller's shell.
