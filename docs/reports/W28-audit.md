# W28 audit — approver, session-grant client, compact readiness

Audit of commit `52024dd` (W28) on branch `audit-w28`, 2026-10-18. Three reads of the code
(the coordinator plus two independent reviewers briefed on the security boundaries in
`AGENTS.md` and PRD 6.6), the regression tests, and a QA run that drives a real `mob
approver` on a pseudo-terminal from real Claude Code sessions. Every confirmed defect below
is fixed on this branch; the design items at the end are reported, not changed.

## Findings and fixes

Severity reflects what a user would hit. "Fixed" names the change on this branch.

| # | Severity | Finding | Fixed |
|---|---|---|---|
| 1 | High | `mob approver` could not start from the shipped binary. `approverCommand` demanded an injected passphrase reader that `main.ts` never supplies, so every real start printed `mob approver needs a terminal to read the passphrase`. The tests called `startApprover` directly and never the command. Reproduced under a pty with the built binary. | The command falls back to the controlling terminal reader (`readSecretFromTty`). A test runs `mob approver` through `run()` with a TTY runtime and no injected reader. |
| 2 | High | Card-to-signature gap. The approver showed the card, waited for `y`, then `p1("sign")` reloaded the record from disk. A same-user process could rewrite `p-N.json` and `p-N.intent` consistently in between; the keystore then signed bytes the human never saw. Reproduced by a reviewer with a swapped `$100,000` body. | The approver pins the Proposal `contentHash` (covers signing bytes, route, base, body, and purpose) or a new `ceremonyFingerprint` (owner, API base, venues, prepare and legal steps, key plan) before the card. `ProposalStore.sign` takes `expectContentHash` and refuses under its lock if the record moved; `signCeremony` checks the fingerprint. Only in-process callers can pass the pin: the CLI rejects `--pin` as an unknown option. Tests swap the record mid-approval and assert nothing signs. |
| 3 | Medium | Ctrl-C or Ctrl-D at `Sign it? [y/N]` wedged the approver. readline never resolved the question, the serial queue never advanced, pings still answered, so the agent kept routing into a dead approver and waited up to an hour. | Ctrl-D declines; Ctrl-C declines and stops the approver; a request that throws is reported to the agent and never blocks the next one. Tests cover a throwing confirm followed by a served request. |
| 4 | Medium | A card could be signed after the requester left. The agent's Bash call times out (two minutes by default) while the human reads; the human types `y`; the approver signs and submits into a closed socket; the agent reports failure and may restage. | The server socket marks a closed connection; the pending prompt is closed through an `AbortSignal`, the card is reported as withdrawn, and nothing signs. The agent-side wait is ten minutes, the timeout message points at `mob proposal show <id>`, and the skills tell the agent to use a ten-minute tool timeout (the QA agent did). Test: a raw client disconnects before the human's `y`; zero server writes. |
| 5 | Medium | A mistyped passphrase after the idle window was cached before verification, so every later card failed until restart. | Fresh input is verified against the keystore before it is cached; a typo fails that one card and the next card asks again. Test covers wrong-then-right. |
| 6 | Medium | The Claude overlay's signing question listed five choices; AskUserQuestion allows four. | The approver choice replaces the keystore-myself choice while `approver.running` is true. |
| 7 | Low | Two approvers on one home: the second silently took the socket and token; the first's `stop()` then deleted the second's files. | A start is refused while a live approver answers; `stop()` removes only files that still carry this run's token. |
| 8 | Low | A closed terminal window (SIGHUP) left stale `approver.sock` and `approver.token`; the agent then printed `Handed …` followed by `Failed to connect`. | SIGHUP cleans up like Ctrl-C; a connect failure reports "no approver is running" and names the stale files; `Handed …` prints only after the socket opens. |
| 9 | Low | A home path longer than about 100 bytes made `Bun.listen` fail with an opaque `Failed to listen`. | Clear usage error naming the path and `MOB_HOME`. |
| 10 | Low | Policy and signer were checked once at startup; a later `policy locked` still produced a card and a prompt before failing. | Config is re-read before every card. |
| 11 | Low | Grants: `--markets` was upper-cased and accepted venue market strings (`xyz:NVDA` became `XYZ:NVDA`), against both PRD 6.6 (bases) and the native-string convention; scopes, venues, and markets were not deduplicated. | Bases only (`BTC`, `NVDA`), kept as typed, no repeats; the builder rejects a venue prefix too. |
| 12 | Low | Grants: `revoke` skipped the server probe, so the owner signed a message the server could not take; the local record copied the server's `agent` address instead of the one the owner signed; a revoke answer without `ok: true` still marked the grant revoked. | `revoke` probes like `create`; the record keeps the signed agent and fails if the server names another; revoke requires `ok === true`. Tests cover all three. |
| 13 | Low | Compact readiness rows still carried the full 14-venue name map and the scan-only glossary notes; `issue` and `check` had generic meanings. | Compact rows name only the venues they mention, drop the scan notes, and document both fields. |
| 14 | Info | `--idle-minutes 0.5` was accepted though the message said 1 to 1440; a second newline on one socket queued a second card; no request size cap. | Whole minutes only; one request per connection; 4 KB cap. |
| 15 | Info | W28 report said the home screen marks the signer line; only `mob doctor` does. Skill templates said consent "authorizes the browser or WalletConnect path" next to the approver instruction. | Report corrected; templates say browser, WalletConnect, or approver. |
| 16 | Medium | Found by the QA run, not by reading: after the approver had signed one Proposal through `p1`, Ctrl-C killed it without cleanup (no `Approver stopped.`, stale socket and token). Cause: Bun 1.3.8 uninstalls its native signal handler when any listener is removed with `process.off`, even while the approver's own `once` listener remains; the sign path registers and removes its SIGINT/SIGTERM cancel handlers on every signature. Reproduced with a ten-line script. | A caller that supplies `rt.signal` now owns cancellation: the sign path registers process listeners only when no signal is given, and the approver passes a signal it aborts on stop. A test asserts the SIGINT listener count never changes while the approver signs. The scripted check (two signatures, then SIGINT) stops cleanly. |

## Reported, not changed

- **Agent key storage.** `mob grant create` writes the agent private key to a 0600 file under
  `~/.mob/grants/`; PRD 6.6 says OS keychain, exported never. Harmless today because the
  probe refuses before a key is generated (the routes are roadmap item 9), but `packages/keys`
  needs a non-API-key kind before the server ships agent grants.
- **One `y` per ceremony.** The ceremony card lists step purposes, not the bytes of the
  binding requests the server returns after the prepare step; one `y` covers them, exactly
  as one passphrase does in the terminal keystore flow. `classifySignRequest` still checks
  every returned request against the expected venue and action. A per-step confirmation in
  the approver would be the next hardening.
- **Token is a freshness check.** Any same-user process can read `approver.token`; the
  boundaries are the 0700 home and the human's `y`. `SECURITY.md` now says so.
- **Card printed twice** in the human's terminal (the approver's own card, then the sign
  path's display). Cosmetic.

## What was checked and found clean

Routing matrix for `mob sign` (TTY vs no TTY, `--with` values, signer values, policy values,
`c-N`), no recursion from the relay runtime, the hook's exact-id and chosen-answer rules with
`--with approver` and `--with=approver`, passphrase and key never crossing the socket or the
relayed output, the single-use marker, declined cards leaving the Proposal signable, the
grant message bytes against PRD 6.6, the 404 probe before key generation, and the compact
glossary changing no value.

## Verification

| Command | Result |
|---|---|
| `bun run check`, `bun run lint`, `bun run deadcode` | Passed (lint reports one pre-existing info in `ceremony.test.ts`). |
| `bun run gen:skills` twice | Stable. |
| `bun run test` | 1,090 passed, 0 failed, 59 files. |
| `bun run build` | `apps/cli/dist/mob` rebuilt; `mob approver` starts under a pty and asks for the passphrase. |
| `claude plugin validate --strict .` and `.claude-plugin/plugin.json` | Passed. |
| `MOB_EVAL=1 bun run eval:skills` | 6 of 6. |
| `MOB_QA=1 bun run qa:signing` | 21 of 21 on the final run; the runs that found defects are in `docs/reports/QA-signing-2.md`. |

New tests: the approver pin against a swapped record, a throwing confirm that does not wedge
the queue, a refused second approver and the command's default reader, a TTY human signing
locally while an approver runs, a withdrawn card after the requester disconnects, a mistyped
passphrase after the idle window, `expectContentHash` in the store, the ceremony fingerprint,
grant market bases, revoke probing, a server answer naming another agent, and the hook's
`--with=approver` forms.
