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
| C5 opener override | **wrongly marked fixed here on 2026-10-12.** `MOB_NO_OPEN` was documented but never read; every `mob sign` with the browser signer opened the system browser, including from tests. Fixed in `73c50c9`: the opener honors `MOB_NO_OPEN` and never opens under `NODE_ENV=test`. Verified with a fake `open` on PATH. |
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

## Round 2b: the final merged build (W13 in), journey C and the marketplace install

Build: `main` at `598013f` (W12 + W15 + W16 + W14 + W13), CLI 0.3.0. Journey C re-ran steps 1, 2, 4, 5, 6 with a fresh home and session.

| Step | What happened | Verdict |
| --- | --- | --- |
| 1 hello | The one-line preamble failed: `bash: /Users/harryg/.claude/skills/mstack/bin/mob-preamble: No such file or directory`. The agent found `bin/mob-preamble` only because its cwd was the checkout, then rendered the home screen. | **fail — G1** |
| 2 scan | Asked for a size, as designed. | pass |
| 3 setup | Preamble via the checkout-relative path; read `references/settings.md`; ran setup with the five flags; card with the statement first. | pass |
| 4 sign | Blocked twice by the sign-guard, same as round 2 (E1, E2). | fail — E1 (W17) |
| 5 proposals | Correct, with the right advice. | pass |
| 6 status | `No positions`, grouped explanation. | pass |

Marketplace path on a throwaway `CLAUDE_CONFIG_DIR`: `claude plugin marketplace add <checkout>` and `claude plugin install mstack@mstack` both succeeded (version 0.3.0, enabled). `claude plugin details` reports 9 skills, 1 hook, 1 MCP server, about 414 always-on tokens and 300–1,200 tokens per skill invocation. The shim ran from the plugin cache (`plugins/cache/mstack/mstack/0.3.0/bin/mob`) and the hook command resolved through `${CLAUDE_PLUGIN_ROOT}`. The install printed `1 userConfig option not yet set — run /plugin configure mstack@mstack`, which a new user cannot act on (G2). A headless prompt through that install could not run because a throwaway config dir has no login; the skill path was exercised through `--plugin-dir` instead.

New findings: **G1 (H)** Claude substitutes only the exact `${CLAUDE_SKILL_DIR}` / `${CLAUDE_PLUGIN_ROOT}` tokens and does not export them to the shell, so the `${CLAUDE_PLUGIN_ROOT:-…}` form in the generated skills never resolves; fix is a per-skill `scripts/preamble.sh` reached through `${CLAUDE_SKILL_DIR}` (W17.1). **G2 (M)** drop the unused `userConfig` from `plugin.json` (W17.1).

Cost with W13's shorter skills: hello $0.71, scan $1.08, setup $1.44, sign $2.07, proposals $2.22, status $2.50 (round 2: $0.97, $1.46, $2.73, $3.59, $3.79, $4.67).

## Round 3: the W17 build, journey D (agent-driven signing against the fixed guard)

Build: `main` at `35294f3` (W17 in), CLI 0.3.0. Fresh home and session, cwd `/tmp`, `MOB_NO_OPEN=1` so no browser window opened on the QA machine.

| Step | What happened | Verdict |
| --- | --- | --- |
| 1 setup | Setup with the five flags, card, statement first, stopped before signing. | pass |
| 2 "sign p-1 in the browser now" | First attempt chained `; ec=$?; cat …` after the id; the guard refused with ``unexpected token `; ec=$?` after the Proposal id`` (E2 wording). The bare retry, the turn's second tool call, **passed the guard** (E1 fixed on the real path), started the sign page, printed its URL, and waited. After two minutes the agent stopped the process as instructed. | pass |
| 3 proposals | p-1 still `awaiting-signature`, no stale lock after the stop (C1 on the real path), expiry shown relative. | pass |

Cost: setup $0.88 (10 turns), sign $1.17, proposals $1.36.

Remaining human-only checks are listed in `docs/READINESS.md`: a live legal acceptance, a live binding, a live order, WalletConnect against a real relay, and the public-release install on a clean machine.

## Round 3b: first contact from a user's own folder (W17.1 build)

The earlier journeys all started inside the mstack checkout, where `AGENTS.md` loads as project context and primes the agent to use the skills. Started from `/tmp` with `--plugin-dir`, the prompt "I just installed the mstack plugin. what can you do here?" did not invoke the router skill in three of three runs: the agent searched `~/.claude/plugins` and `find /` for "mstack", read all nine SKILL.md files from a developer checkout, and ran `mob doctor` from there. The router's description listed only "mobius", "funding arb", "best pair", "connect wallet", "manage my positions".

A/B with the same harness: the current description routed 0 of 3; a description starting "Start here for mstack and Mobius. Use for "what can you do", "what is mstack", "getting started", …" routed 3 of 3, ran the preamble and home screen each time, and cost $0.15–$0.54 per run instead of $0.30–$1.19. **I1 (M)** → W17.2: router and read-skill descriptions gain everyday first-contact phrases; the README names the first message to send; a test pins the phrases.

Verification on `324019c` (W17.2): the same prompt from `/tmp` invoked the router skill and ran the preamble in 3 of 3 runs; 888 tests, no generated-skill drift, both strict validations and all six smokes pass on that commit.
