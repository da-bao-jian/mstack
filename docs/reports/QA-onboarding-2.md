# New-user onboarding QA, round 2

Build: `main` at `7cb79a1` (W12 + W15 + W16 + W14; W13 not yet merged), CLI 0.3.0. Harness: headless `claude -p --plugin-dir ~/dev/mstack-qa --strict-mcp-config --max-turns 14`, fresh `MOB_HOME`, one new session resumed across nine prompts, no human in the loop. Nothing was signed or sent; the owner is the burn address.

## Round-1 findings, status on this build

| Finding | Status |
| --- | --- |
| C1 interrupted `mob sign` bricks the Proposal | fixed (W14): SIGINT/SIGTERM print `Cancelled. p-1 is still awaiting signature until …`, no lock left; a dead-pid lock is reclaimed by `mob sign` and `mob reject`; a live lock is refused |
| C2/C3 expired Proposal re-offered / status not computed at read time | fixed (W14): `p-1  expired  expired 54 sec ago`; setup and bind stage a fresh one and say so |
| B2/B4/B5 pre-setup errors | fixed (W14): one line, `Run mob setup first (about two minutes)…` |
| B3/A4 setup not agent-runnable | fixed (W15): `--owner --signer --policy [--no-legal]`; the agent used them unprompted |
| B6 sign check order | fixed (W14): `mob: No Proposal p-9` |
| B12 parser prose, no per-command help | fixed (W14): `Unknown option --sizee. Did you mean --size? See mob scan --help.`; `mob scan --help` is scan-only |
| B11 `config get` unset | fixed (W14) |
| A1 reachability | fixed (W14): `API_REACHABLE: ok · 1.3 s`; slow never blocks a scan |
| A2 glossary | fixed (W14): `glossary` in `--json`; the agent read `references/glossary.md` instead of the source tree |
| A3 cross-deployment pairs | fixed (W14): hidden, counted in the footer, `--include-cross-deployment` |
| P1/P2/P3 sign page | fixed (W15 + W14): brand header, "This signature authorizes …", "It cannot move funds.", the statement sentence under the headline, expected vs connected owner, reason text under the disabled button |
| C5 opener override | fixed (W15): `MOB_NO_OPEN=1` / `BROWSER` |
| A5 session start slow | not in scope (other plugins) |
| D1 bind says nothing about unsigned legal | open → W17 |
| D2 per-step cost | improved: $0.97–$5.06 per step (was $4–5 flat); the growth is conversation length, not skill size. W13's shorter skills land next |

## Journey B, step by step

| Step | Prompt | What happened | Verdict |
| --- | --- | --- | --- |
| 1 | "I just installed the mstack plugin. what can you do here?" | Router skill ran the preamble; the home screen printed the logo in ASCII, `Next mob setup`, version 0.3.0, API ok. The agent explained read-first scope and the two things that work before setup. | pass |
| 2 | "find me the best funding arb right now" | Asked for a size per the skill rule ($1,000 / $5,000 / $25,000 / other). | pass |
| 3 | "run mob scan --sizee 500 …" | Quoted the one-line error verbatim, then scanned at $500 and showed two tables. | pass |
| 4 | "set me up …" | Ran `mob setup` with the five flags, showed the card with the statement sentence first, flagged the burn address, stopped before signing. | pass |
| 5 | "start signing p-1 now; I have my browser open …" | **Blocked twice by the sign-guard hook.** First because the command carried `>/tmp/x.out 2>/tmp/x.err` after the id (message blamed the id). Second, a bare `"$MOB" sign p-1 --with browser`, because the guard reads the latest transcript event of type `user`, which after any earlier tool call in the turn is a `tool_result` event with no text, so "the latest user message must name the exact Proposal id p-1" fired although the human message did. The browser never opened. | **fail — E1** |
| 6 | "show my proposals …" | Correct table with `expires in 1:55`; explained the guard trap and both ways to sign in time. | pass |
| 7 | "bind hyperliquid for me" | Staged p-2 with the ceremony steps (`▶ prepare · approve agent · approve builder fee`), explained the key limits. | pass (D1 still open) |
| 8 | "show my positions" | `No positions`, grouped explanation; noted p-1 had likely expired. | pass |
| 9 | "open $1,000 of the best pair …" | Preamble showed p-1 `expired 54 sec ago`, readiness shows no venue bound; the agent predicted the preflight failure and then asked the three first-open risk questions anyway. | pass, see E3 |

## New findings

- **E1 (H) sign-guard blocks every agent-driven sign that is not the turn's first tool call.** `apps/cli/src/sign-guard.ts` lines 49–57 keep the last transcript event with `type: "user"`; Claude Code records tool results as `type: "user"` events whose content is `tool_result` blocks, so the human prompt is skipped. Every skill runs the preamble before `mob sign`, so this fires on the designed path. Fix: pick the latest `user` event whose content is a string or has a `text` part and no `tool_result` part; add a fixture transcript with a tool_result after the human message. → W17
- **E2 (M) guard token rule and message.** Redirections after the id (`>/tmp/a 2>/tmp/b`, `2>&1`, `| tee`) are rejected with "use one literal Proposal id", which blames the id. Accept trailing redirections and pipes to `tee`/`cat`, and name the offending token when refusing. → W17
- **E3 (M) open skill order.** When readiness shows nothing bound or the legal acceptance unsigned, the skill should say what is missing and stop, before the risk interview. → W17 (skill text)
- **E6 (L) five-minute expiry versus a human's pace.** p-1 expired while the user was still reading. The window is the server's; instead, `mob sign <expired-id>` for a legal or bind-prepare Proposal should stage a fresh copy, print the new id, and stop (never sign the new id in the same command). → W17

## Cost

| Step | Turns | Cost | Wall |
| --- | --- | --- | --- |
| 1 hello | 4 | $0.97 | 80 s |
| 2 scan | 5 | $1.46 | 61 s |
| 3 typo | 3 | $2.16 | 115 s |
| 4 setup | 5 | $2.73 | 65 s |
| 5 sign | 7 | $3.59 | 144 s |
| 6 proposals | 2 | $3.79 | 26 s |
| 7 bind | 5 | $4.26 | 63 s |
| 8 status | 4 | $4.67 | 42 s |
| 9 open | 4 | $5.06 | 54 s |

Round 3: re-run steps 1, 2, 4, 5, 6 on the merged W13 build (journey C), then the sign step again after W17 lands the guard fix.
