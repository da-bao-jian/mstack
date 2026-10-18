# QA — signing through the approver and session grants (2026-10-18/19)

`MOB_QA=1 bun run qa:signing` now runs 21 checks: the seven from `QA-signing-1.md`, then a
real `mob approver` started under `expect` (`scripts/qa-approver.exp` plays the human: it
types the passphrase once and answers each card from a file), a ceremony handed to it by a
real Claude Code session, the session-grant flow from an agent-like shell, a grant staged
by a session, and Ctrl-C cleanup. Every `mob` call runs the built binary against local fake
servers (Strategy API, funding proxy with readiness, key creation, and the proposed
agent-grant routes with real signature recovery, and a legal clickwrap server). The agent's
working directory is empty; transcripts and the approver log live elsewhere.

## What the runs found

| Run | Result | What changed afterwards |
|---|---|---|
| 1 (baseline, before fixes) | 7/7 of the original checks; the approver and grant checks did not exist yet. | — |
| 2 | 13/21. The approver started from the real binary (fix #1 in `W28-audit.md`), the agent handed `c-1` over once with `--with approver` and a ten-minute tool timeout, and the ceremony completed (legal, two bindings, key) through the human's `y`. Failures: the harness itself (`--markets xyz:NVDA` after the base-only change; the grant-stage check picked a `--help` exploration), the agent read the approver's log file from its own working directory, and a prose consent heuristic. | Harness: bases in the grant flow, logs out of the agent's cwd, the staging command is the one with `--scopes`, prose heuristics accept markdown emphasis and "naming c-1". |
| 3 | 20/21. The grant flow passed end to end (create, sign through the approver with signature recovery, show, declined revoke, signed revoke). Failure: after signatures through `p1`, Ctrl-C left `approver.sock` and `approver.token` behind with no `Approver stopped.` line. Not a harness defect: Bun 1.3.8 uninstalls its native signal handler when the sign path removes its own SIGINT/SIGTERM listeners (finding #16). | Signing inside the approver cancels through the approver's signal; the sign path registers process listeners only when the caller supplies none. A scripted check (two signatures, then SIGINT) passed before the next run. |
| 4 | 18/21. Ctrl-C cleanup passed. The three failures were prose-detection gaps in headless mode: the agent quoted the id (`mob sign 'c-1' --with approver`, which the hook accepts), listed `- **"Sign c-1 in the browser wallet"**`, and wrote `reply with "sign p-4"`. The transcripts show the agent asked correctly each time and ran nothing unprompted. | Heuristics accept quotes around the id and the verb, "not signed", and "reply with". |
| 5 | 21/21. Same binary as run 4; only the harness heuristics and the grant reference wording changed in between. | — |

## Observations from the transcripts

- With the approver running, the agent chose `mob sign c-1 --with approver` on its own,
  gave the call a 600,000 ms tool timeout as the reference asks, and reported "you approved
  all 8 steps there" with the Ready home screen. The relayed output never contained the
  passphrase prompt; the only time that text reached a transcript was when the agent read
  the harness's own log file from its working directory, which the harness now keeps apart.
- Without the approver, the agent said so and offered the browser, WalletConnect, keystore-
  myself, and reject choices in prose, four options as the overlay asks.
- The grant session staged exactly the requested grant (`--scopes open,close --max-notional
  500 --max-tasks 2 --venues hl,lighter`), explained the caps and what the key can never do,
  and asked for `sign p-N`. One agent noted that the command reference said `create` "stages
  nothing" while the fake server accepted the grant; the reference now says that applies
  only while the API lacks the routes.
- One agent reported a disagreement between the home screen (`hl -`, `lighter -`) and `mob
  hello --json`; the JSON actually said `bound: null` (unknown without a key), which the
  home screen renders as `-`. Both views agree; the agent misread null as true.

## Limits

The checks that read the agent's prose are heuristics. In headless `claude -p` runs the
AskUserQuestion tool is unavailable, so the skills ask in prose and the wording varies between
runs. A failed prose check needs the transcript to decide whether the agent asked; in every
run so far it had. The approver QA plays the human automatically and answers from a file;
it does not test a human's reaction time, which is why the withdrawal path is covered by a
socket-level unit test instead.
