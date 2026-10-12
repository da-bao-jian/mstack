# End-to-end test plan for the session program

Every layer below runs on a clean checkout of the exact commit under test, with a fresh `MOB_HOME`, and leaves nothing behind. Fakes are started by the test script and stopped at its end. A layer passes only when every line in its checklist is green; the result is appended to `docs/reports/E2E.md` with the commit, the date and the exact commands.

## Layer 1 — gates (every merge)
`bun run check`, `bun run lint`, `bun test --timeout 30000` (source mode and `MSTACK_TEST_MOB_BIN` mode), `bun run deadcode`, `bun run build`, both strict plugin validations, generated-skill drift, all smokes.

## Layer 2 — CLI against fakes (fake funding server, fake auth server, W18 fake Strategy API)
| Area | Checks |
|---|---|
| keys | import through stdin (agent path) stores and prints only the prefix; hidden TTY import through a PTY; key on argv refused; bad format refused; 401 refused and not stored; unreachable not stored unless `--unverified`; `show` ok/rejected/unreachable; `list` and `revoke` Proposals sign with the test keystore and the revoked local key is deleted; `delete` local only; the secret never appears in stdout, stderr, Proposal JSON, logs or `--json` output; `MOBIUS_API_KEY` wins and is never written |
| onboard (W20) | checklist in every state (legal missing, venue not bound, needs repair, bound, key none/stored/verified); agent shell prints once with one `Next:` line; `--watch` redraws on a PTY with a fake clock; opener once per hour, `MOB_NO_OPEN`; re-run idempotent; Ready line with venues and cap |
| native ceremony (W20) | keystore signer: prepare → sign every request exactly → submit → poll → bound for hl, aster, lighter, lighter-mainnet; a rejected middle step leaves later steps unsigned and the venue incomplete; `already_bound`; `rebind_required` then `--rebind`; batch expiry; the sign-guard treats `c-N` like `p-N`; browser signer drives a 5-step session in one page with the fake wallet |
| submit (W21) | open stages `api-submit` only when the key covers both venues; preflight shows scope and cap checks; `submit` 202 → `submitted` → status shows the task; replay returns the same answer; changed body 409; 429 stops with the hint; 401 and 403 messages; a submitted Proposal cannot be submitted twice; cancel only while pending, close while running, resize valued server-side; manage edits still wallet-signed with the ask-D sentence; policy `auto` warning on the home screen; hook fixtures for manual and auto |
| regression | every 0.3.0 smoke and the round-1/2/3 QA items |

## Layer 3 — agent journeys (headless `claude -p --plugin-dir`, fresh home and session, cwd outside the checkout, `api_base`/`auth_base`/`app_base` pointed at the fakes)
- **Journey E, browser path:** "set me up" → the agent opens the page URL and prints the checklist → the "user" pastes a fixture key into the chat → the agent imports it through stdin → "what can I trade" → "open $500 of ETH long hl short lighter" → the agent stages and stops → "submit p-N" → 202 → "show my positions". Pass: the key appears in no agent output after the paste, the Proposal file holds no key, the fake API saw one POST with the Idempotency-Key, and the Ready line shows the right venues and cap.
- **Journey F, native path:** the agent runs `mob onboard --native` with a test keystore; the "user" names `c-1`; the keystore passphrase comes from a PTY harness; then the same trade as E.
- **Journey G, first contact from a user's folder** (regression of round 3b): 3 of 3 route to the router.

## Layer 4 — real services, no money
- `mob scan`, `mob rates`, `mob history` against the live venues.
- `mob status` and the readiness checklist against `funding.mob.exchange` and `auth.mob.exchange` for the burn address and for Harry's address.
- `GET api.mob.exchange/health` and `/openapi.json` through the client; version and route parity with the pinned spec, reported, not asserted (the live server is 1.1.0 until the deploy).
- A real key with a small cap, pasted by Harry: `mob keys import --stdin`, `mob keys show` → `ok`, `mob status` through the API. No order.

## Layer 5 — human, with money
`docs/LIVE-TEST.md` with the key: open $50 per leg through `mob submit`, watch `mob status`, close through `mob submit`, confirm both venues flat. Then revoke the test key.
