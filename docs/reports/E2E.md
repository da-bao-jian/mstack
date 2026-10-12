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

## Fable's independent runs — 2026-10-12/13

Every run below used a clean checkout at the stated commit, a fresh `MOB_HOME`, `MOB_NO_OPEN=1`, and real HTTP fakes started as separate processes (the W18 fake Strategy API, the CLI's `fakePositionServer`, and a small auth server serving `/legal/terms` and `/legal/acceptance`). Scripts live in the session scratchpad; the commands are reproducible from the notes here.

### Layer 2 — compiled binary against the fakes

| Package | Commit | Result |
|---|---|---|
| W19 keys | `3524bc5` | Pass: stdin import, show and `--json` without the secret, argv refused, bad format, 401 not stored, unreachable not stored and `--unverified`, home and doctor rows, env override, delete, leak sweep 0. The keychain backend calls `/usr/bin/security` by absolute path, so a PATH fake was bypassed and the fixture key round-tripped through the real login keychain; entry deleted afterwards. |
| W18 API client | `0bdccff` | Pass through the real client: health, create 202, replay, conflict 409, decimal strings preserved, 429 with `Retry-After` 3, wrong key 401 redacted, cap 403, close, and a full binding batch for hl and lighter signed by a test wallet from prepare through submit to bound. |
| W21 submit | `ad029d2` | Pass: wallet Proposal with reason when no key, `api-submit` staging with 11 named checks, submit 202, replay refused, API-sourced status, locked policy, venue-scope and cap refusals, auto-policy warning and home row, hook rules for manual and auto, leak sweep 0. Not reachable by hand: 401 at submit (a rejected key is never stored) and a manage edit on an API task (the fakes are not linked); unit tests cover both. |
| W20 onboard, first run | `136f1da` | Two defects: the checklist's readiness read sent no `X-Mobius-Client` header, and `bind --all` could not stage with the real clock (milliseconds where the wire wants seconds). Both hidden by in-process smokes with stubbed fetch and an injected clock. Fixed in W20.1; the smokes now drive the compiled binary against HTTP fixtures with the real clock. |
| W20 onboard, after W20.1 | `2620b14` | Pass: checklist in every state, exactly one `open` call per hour and zero under `MOB_NO_OPEN`, stdin import, `Ready · 4 venues bound · key mobius_… · cap $5,000`, ceremony staged for an unbound owner with expiry 300 s ahead, open and submit unchanged, leak sweep 0. Found for W22: `mob onboard --help` and `mob keys --help` crashed; the Ready screen printed contradictory "not checked" rows. |
| W22 release candidate | `b6c8fed` | Pass: every command's `--help` answers with `Usage:` (0 problems in a 34-command sweep), the Ready screen prints no "not checked" rows, `mob proposals` lists a ceremony with a relative expiry. |

### Journey F — native path through a pseudo-terminal with a keystore signer (`2620b14`)

Keystore created with two hidden prompts. `mob onboard --native` staged the legal Proposal; `mob sign p-1` with one passphrase posted the acceptance. `mob bind --all --venues hl,lighter --lighter-account 42` staged `c-1`; `mob sign c-1` with one passphrase showed six steps with purpose, exact data and digest (prepare, hl approveAgent, hl approveBuilderFee, lighter changePubKey, lighter approveIntegrator, read), submitted, polled, and ended `c-1 complete · 2 venues bound`. `mob keys create` then staged a key Proposal; signing it stored the server's key as a prefix only, and the Proposal file holds no key. The passphrase was never written to disk.

### Layer 4 — real services, no money (`8aa9eeb`)

Live scans and history, public status for the burn address, doctor reachability for the funding and auth servers, Strategy API health through the client. The live API serves 1.1.0 with no venue-binding routes, so the native path cannot run live until Mobius deploys 1.2.0.

### Layer 3 — agent journeys (headless `claude -p --plugin-dir`, fresh home and session, cwd `/tmp`, HTTP fakes)

| Journey | Commit | Result |
|---|---|---|
| G, first contact ×3 | `b6c8fed` | 3 of 3 invoked the router and ran the preamble. |
| E, browser path | `b6c8fed` | Blocked at the key paste: the skill told the agent to use a "secret-safe shell variable", which the Bash tool does not have, so the agent stored nothing. Fixed in W22.1. |
| E, browser path | `6412afb` | Pass: `mob onboard --owner` printed the page link and checklist; on the paste the agent ran one `printf … \| mob keys import --stdin` command, reported the prefix only, and `mob onboard` printed Ready; the key appeared in no later output and only in the key store. The open stopped at the skill's first-open risk questions, as designed. |
| E2, browser path plus trade | `6412afb` | Pass: with the risk answers in the prompt the agent staged `p-1` (`api-submit`, $500 per leg, protection and auto-close off) and stopped; "submit p-1" passed the hook because the message named the id; the API answered 202 and `mob status` read the task through the key as `pending` then `running`. Leak sweep 0. |

Per-step agent cost on `6412afb`: $0.15 (onboard), $0.36 (paste and import), $0.47 (ready), $0.91 (open), $1.22 (submit), $1.41 (status), cumulative over one session.

### Still human (Layers 4b and 5)

A real key from the real page, a real $50 submit and close, the native path against the deployed API 1.2.0, WalletConnect against a real relay, the public-release install. See `docs/LIVE-TEST.md` and `docs/READINESS.md`.
