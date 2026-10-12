# Session program end-to-end results

## W22 — 2026-10-12

Commit under test: the W22 delivery commit named
`feat(skills): session onboarding and API-key trading`. The hash is assigned
after this report is committed.

### Layer 1 — gates

All commands ran from a clean process environment. CLI journeys created a
fresh temporary `MOB_HOME` and removed it when complete.

| Command | Result |
| --- | --- |
| `bun install --frozen-lockfile` | Pass; 221 installs checked, no changes |
| `bun run gen:skills` | Pass; 10 skills per host, 66 generated files |
| `bun run check` | Pass |
| `bun run lint` | Pass |
| `MOB_NO_OPEN=1 bun test --timeout 30000 packages apps` | Pass three times; 942 tests, 29,317 assertions, 6 snapshots each |
| `MOB_NO_OPEN=1 MSTACK_TEST_MOB_BIN="$PWD/apps/cli/dist/mob" bun test --timeout 30000 packages apps` | Pass; 942 tests, 29,317 assertions, 6 snapshots |
| `bun run deadcode` | Pass |
| `bun run build` | Pass |
| `claude plugin validate --strict .` | Pass |
| `claude plugin validate --strict .claude-plugin/plugin.json` | Pass |
| `bun scripts/release.ts --notes 0.4.0` | Pass |
| generated-skill contract and repository hygiene tests | Pass; 83 tests, 1,404 assertions |
| all local smoke commands | Pass |

The local smoke set was `smoke:walletconnect:mock`, `smoke:browser`, the CLI
`smoke:proposals`, `smoke:open`, `smoke:bind`, `smoke:home`, `smoke:submit`,
`smoke:onboard`, `smoke:ceremony`, and `smoke:journey-e`.

### Layer 2 — CLI against fakes

| Area | Result |
| --- | --- |
| keys | Pass. Stdin and PTY imports, redaction, argv refusal, invalid and failed verification, unverified storage, status, list, revoke, delete, and environment override are covered. |
| onboard | Pass. Legal, venue, repair, key, watch, opener, idempotence, and Ready states are covered. The Ready screen does not print contradictory Key or Legal rows. |
| native ceremony | Pass. Multi-step signing, rejection, already-bound, rebind, expiry, browser, and `c-N` guard behavior are covered. |
| submit | Pass. API Proposal selection, caps, 202, replay, 401, 403, 409, 429, one-shot submission, manage routes, policies, and hook rules are covered. |
| regression | Pass. Existing smoke workflows and the generated-skill routing contracts remain green. |

`smoke:journey-e` used fake auth, funding, and Strategy API services. It ran
onboard → stdin import → onboard Ready → open → submit → status at CLI level.
It asserted that the full fixture key appeared only in the key-store file. It
did not appear in output, config, logs, or the staged Proposal.

Layers 3–5 were not part of this headless Layer 1–2 run. The real small-cap key
check and real $50 submission remain human readiness checks.
