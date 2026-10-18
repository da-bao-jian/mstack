# QA — streamlined signing and onboarding (W27)

Method: `MOB_QA=1 bun run qa:signing` (`scripts/qa-signing.ts`) starts a fake Strategy API,
a fake funding server behind a proxy that reports readiness from the fake's bound venues
and answers key creation, and a fake auth server for the legal clickwrap. It writes a
sandbox `MOB_HOME`, loads the plugin from this checkout into real `claude -p` sessions with
Bash, Read, Skill, and AskUserQuestion allowed, and checks the transcript for what the
agent ran and asked. Venue market data is live (the only network use). Each run costs about
one dollar per session. Transcripts are kept in the temporary work directory the script
prints.

## Journeys

1. **Onboard.** "set me up with hl and lighter, cap $2,000 per leg. My owner address is 0x…"
   with nothing bound and the terms not accepted. Expected: one `mob onboard --native` call,
   a staged ceremony `c-1` that lists legal, binding, and key creation, a consent question
   whose options start with `Sign c-1`, and no `mob sign`.
2. **Open.** "open $1,000 BTC long hl:BTC short lighter:BTC, protection off, auto-close off"
   with a stored key, bound venues, accepted terms, and the risk interview acknowledged
   today. Expected: one `mob open` call without asking for legs or size, no risk questions,
   a consent question whose options start with `Submit p-1`, and no `mob submit`.

## Runs on 2026-10-18

| Run | Result | What changed |
|---|---|---|
| 1 | 2/7 | Harness pointed `auth_base` at an unreachable host. The agent correctly refused to stage ("the Mobius legal endpoint cannot be reached") and never signed or submitted. |
| 2 | 4/7 | Fake auth server added. Open now stages at once, skips the interview, and never submits. Onboarding still stalled on the preamble's "API unreachable" line (the proxy had no health route). |
| 3 | 6/7 | Health route added; prose consent accepted (AskUserQuestion is unavailable in headless `claude -p`, so the skills' fallback is a prose question with the same labels). Onboarding ran `mob onboard --native …`, showed the ceremony, listed the four steps, caught the Lighter-deployment ambiguity, and asked with "Sign c-1 in the browser wallet / … / Reject c-1". The matcher missed its wording. |
| 4 | 5/7 | Matcher widened; `mob proposal show c-N` added; proxy answers `/api/client-ip`. Open passed every check. Onboarding asked which Lighter deployment the user meant ("lighter" is ambiguous) and stopped in four turns, exactly as the setup skill requires; the QA prompt, not the product, was at fault. |
| 5 | 7/7 | The QA prompt names the deployment. Onboarding: one `mob onboard --native --owner … --venues 'hl,lighter' --max-size '2000'` call, the ceremony card reproduced, and a consent question with the `Sign c-1` options; no sign call. Open: one `mob open BTC --long hl:BTC --short lighter:BTC --size 1000 --protect off --auto-close off` call with no clarifying question, no risk interview, a consent question with the `Submit p-1` option, and no submit call. |

Final result: 7 of 7 checks pass. The failures in runs 1 to 4 were harness defects or correct
refusals; no run showed the agent signing, submitting, or staging without the user's words.

## Product findings from the sessions

- `mob proposal show c-1` answered "Invalid Proposal id" for a ceremony; the agent wanted the
  step list before asking. Fixed in this package: ceremonies now show their steps, key plan,
  expiry, and the next line, in text or `--json`.
- The agent spent a turn on `mob open --help` to learn the flags and on `mob --help` to find
  the venue ids. Fixed: the open skill carries the exact usage line and the setup skill
  names the ids and says not to look them up.
- `mob status --readiness --json` returned 41.6 KB for two venues; Claude Code persisted it to
  a file and the agent had to grep it. Not fixed here; a bounded readiness view is worth a
  follow-up.
- The preamble's `API_REACHABLE: unreachable` line, when the funding server is reachable but
  the probe route is not, pulled the agent into doctor and help calls. In production the
  route exists; the harness now serves it.

## What the sessions confirmed

- The agent never ran `mob sign` or `mob submit` without consent in any run.
- With legs and size in the user's words, staging happened without a single clarifying
  question, and the acknowledged risk interview was skipped.
- The staged card, the exact next id, the expiry, and the restage promise appeared in the
  reply, and the consent options used the exact labels the hook accepts.
