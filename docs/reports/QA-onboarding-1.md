# QA — onboarding as a new user, round 1

Date: 2026-10-11. Tester: Fable (coordinator). Build under test: `main` at 1c87dc3 (P1 complete, before W12). Three journeys: (A) a fresh headless Claude Code session with the plugin loaded by `--plugin-dir`, driven by the prompts a new user would type; (B) the CLI as a human following the README; (C) the browser sign page in headless Chromium at desktop and phone width. No live position was opened; the only real network calls were public reads and the auth-server's legal terms.

Severity: **H** blocks or traps a new user · **M** confuses or slows · **L** polish.

## Findings

| # | Sev | Where | What a new user hits | Fix in |
|---|---|---|---|---|
| C1 | H | `mob sign` interrupted | Ctrl-C (or any kill) while waiting for the wallet leaves `~/.mob/proposals/p-N.json.lock` behind. Every later command on that Proposal, including `mob reject`, fails with "Proposal state is busy or an interrupted operation needs review" and nothing says how to recover. | W14 (lock with pid+time, stale reclaim, SIGINT handler that releases the lock, recovery hint) |
| C2 | M | `mob setup` re-entry | After the interruption, `mob setup` re-offered the SAME Proposal as "next step" although it had already expired; only a later run staged a new one. | W14 (expiry check before re-offering) |
| C3 | M | `mob proposals` | Lists an expired and an interrupted Proposal as `awaiting-signature`. Status should be computed at read time: `expired`, `interrupted`, `awaiting-signature`, with the expiry time. | W14 |
| B3/A4 | H | `mob setup` from an agent | Setup reads answers from stdin and dies at EOF: "Setup input ended before all answers were supplied". No flags exist, so an agent cannot run it. | W15 (flags; TTY-only prompts; missing-flag error) |
| B2/B4/B5 | M | first-run errors | `mob status`, `mob bind`, `mob open` before setup say "Set owner with mob config set owner 0x…". The first-run answer is `mob setup`. Every pre-setup error should say so, once, in one sentence. | W14 |
| B6 | M | `mob sign p-1` with no Proposals | Complains "Set signer with mob config set signer keystore" instead of "no Proposal p-1". Check order: Proposal exists → policy → signer. | W14 |
| B12 | L | typo in a flag | `mob scan --sizee 5` leaks Node's parser prose ("To specify a positional argument starting with a '-'…"). Wanted: "Unknown option --sizee. Did you mean --size?" plus `mob scan --help`. Per-command `--help` does not exist; every `--help` prints the whole usage. | W14 |
| B11 | L | `mob config get owner` unset | Prints an empty line. Print `(unset)` to a TTY, keep empty for `--json`. | W14 |
| B1 | L | bare `mob` | Prints the full usage. The home screen replaces it. | W12 |
| A1 | M | preamble `API_REACHABLE` | Reported `fail` against a healthy server: the production API answers in 3–5 s and the check has a 10 s budget inside a shell that also starts `mob`; the agent then told the user the API check failed. Use a 15 s budget, label slow answers `slow`, and never let a reachability check change what the agent does for a scan. | W12/W14 |
| A2 | M | scan JSON for agents | After `mob scan --json`, Claude read the repo source to learn what `qualifies` means and which deployment `lighter` is, because neither the JSON nor the skill says. Add a `glossary` object to `--json` (field meanings, venue display names, cost model, what `executable` requires) and a `references/glossary.md` in the scan skill. | W14 + W13 |
| A3 | M | ranking | A Lighter-vs-Lighter-mainnet pair (0 fees by default) led "Executable on Mobius" and the agent presented it as the top pick. Hide `cross-deployment` pairs from the executable view by default; `--include-cross-deployment` shows them. | W14 |
| A5 | L | session start | The first headless turn produced nothing for 7 minutes; the second took 416 s end to end. Most of it is this machine's other plugins (one MCP server stuck `pending`), not mstack, but the preamble should stay under 10 s and the skill should never block on the API check. Re-run with `--strict-mcp-config` to measure mstack alone. | measure in round 2 |
| P1 | H | sign page, first impression | Looks like an internal form: no brand, a 60-line raw EIP-712 JSON above the fold, the primary button below the fold on both widths, "Expires in 293 seconds" as plain text. | W15 (in progress) |
| P2 | H | sign page, no wallet | With no wallet extension the page shows an empty `<select>` and a greyed "Sign this Proposal" with no reason. Wanted: "No wallet found. Install MetaMask or Rabby and reload." and a disabled-state explanation. | W15 |
| P3 | M | sign page, legal Proposal | The statement text ("I have read and agree… cannot move funds") is the perfect headline and is buried inside the JSON. Show the plain sentence first; keep the exact data one click away; keep the digest prominent. | W15 |
| P4 | L | sign page, verified good | 200 with the nonce CSP, no console errors, sign disabled until an account matches, Reject enabled, token and Origin checks in place. | keep |
| C5 | L | `mob sign` opener | Always runs macOS `open`; no `MOB_NO_OPEN`/`BROWSER` override, so automation and remote shells pop or fail. | W15 |
| B9 | L | scan table | Good. The footer could say `thin hidden: 2225 (--include-thin)`; `OI —` for Aster is correct. | W14 |

## What worked as designed
- The plugin's `bin/mob` was on the agent's PATH under `--plugin-dir`; the preamble found it and reported version, API base, owner, policy and signer.
- The `/mstack:mob-scan` skill triggered from a natural question, ran the bounded `--json`, and the answer was a short table with the caveats ("simple, not compounded", estimates).
- `mob explain funding --simple` produced a clean plain-language answer through the skill.
- `mob scan`, `mob history`, `mob rates` work live with no wallet.

## Open
Steps 04–07 of journey A (setup, bind, status, open from the agent) and the marketplace install path are in progress; round 2 covers them plus the W12 home screen.
