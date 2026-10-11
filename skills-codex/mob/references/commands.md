# Command scope

Read commands include scan, rates, history, explain, status, config get,
proposals, proposal show, and preview. Preview refreshes local preflight.

Setup saves only public choices the user explicitly requests. It never creates
a keystore. Binding asks for separate approval for every Proposal.
Open, close, resize, neutralize, protect, auto-close, and size-mismatch-close
stage one Proposal. Upgrade is installation maintenance only.

The preamble reports the binary path, version, owner presence, policy, signer,
API reachability, and cached update status. A failed health probe is a report;
the command still checks its own data. `MOB_MISSING` stops the skill.
The preamble runs in a child shell. Use its printed `MOB_BIN` path in later
commands; it cannot set variables or PATH in the caller's shell.
