# Audit 3: onboarding UI/UX, three reviewers, compared and fixed

Branch `fix/onboarding-audit`, from `main` at 57d7e65 (v0.5.1 code).

## Method

Three report-only reviewers walked every onboarding path:

- **A**, install and first run, on the real home under a lock: the paste prompt in auto, default and interactive modes, by hand, upgrade over 0.5.0, repeat install, uninstall.
- **B**, every MoB setup path from "set up mstack" to Ready, against local fakes and read-only live MoB reads: wallet choices, venue outcomes, signers, the signing page, the page path, key import.
- **C**, other hosts and failure paths: terminal only, Codex, MCP clients, offline, corrupt config, version skew, and 67 read-only commands through the Bash guard.

Their notes were merged into one table (finding, reviewers, severity, verdict). Fifteen problems had two or three reviewers.

## Fixed

| Problem | Reviewers | Fix |
|---|---|---|
| Live readiness lists QFEX; the client rejected the whole answer | B-01, C-23 | `validateRead` drops venues it cannot trade and keeps strict checks for the rest; the overall `ready` is recomputed when a venue is dropped. Native staging names a failed read. |
| `mob onboard` after setup never reached Ready | B-09 | Without `--venues`, the stored key's venues; the paste lines only while no key exists; skill step 5 passes `--venues`. |
| Terminal `mob onboard`: "Owner is required" | B-02, C-24 | A TTY prompt for the public address; a clear `--owner` message otherwise. |
| Interactive `/mstack:mob` showed no welcome | A-10, B-13, C-01 | The model sends no text before AskUserQuestion in the interactive app (seen three times). The picker's preview pane now holds the welcome, under each section's note, and the question carries the intro. |
| Guard false blocks | B-23, C-04, C-05, C-06 | Search words in a grep pipeline that ends on the screen, comment lines in a data heredoc, literal unquoted heredocs, `MOB=$(command -v mob)`, `config get`, `~/.mob` paths, and this repository's installer pipe. Messages name the word and line. |
| Hook blocks every Bash command | A-23, C-09, C-33 | Hook mode never downloads or builds; it falls back to an older verified binary, or blocks only commands that involve mob. A plugin copy builds only from a real checkout (A-19). |
| Paste prompt over an old install; pin claim | A-12, A-16, A-17, A-21, C-19 | The tested add, refresh, install and update line; Verify checks plugin and binary versions; README drops the pin claim and says to paste again to update. |
| Doctor: Bun, MoB unreachable, wording | A-01, A-02, A-04, A-24, B-04, B-22, C-03, C-26 | API and Auth critical only with a key; Bun only for a checkout; one folded Trading line on a fresh install; fail mark only for a failing check; "no account" for Lighter 21100; no config path. |
| Welcome at 80 columns; palette legend | A-05, A-22, B-22, C-02, C-29 | A terminal stacks when the widest row does not fit; piped output stays compact; no palette. |
| Owner saved before checks; abandoned setup | B-03, B-04 | A native stop restores the previous owner; trading checks are critical only once a key is stored. |
| Two-venue minimum, cap error, sites | B-05 | A one-venue hint is never offered; "No account" names the site; the cap error is in words. |
| Staging card | B-06, B-08 | `c-N · setup for … · expires in m:ss`, every key venue, "already bound", terms links; the signing page links Terms and Privacy. |
| Sign choices ignore the wallet | B-07 | The choice that fits the wallet from step 1 or `signer`, plus Reject. |
| Requirements not said up front | B-14 | One sentence before the first question. |
| WalletConnect project id | A-26, B-17, C-20 | Reown link, listed last. |
| Local paths and `export` lines for the human | B-07, B-20, C-20 | A shared rule: plain `mob …` in text for the human. |
| Key import needs an owner | B-11 | `mob keys import --owner 0x…`. |
| "could not verify" names no host | B-12 | Names the host and the reason; no `--unverified` hint. |
| Reject and preview for `c-N` | B-25, B-26 | `mob reject c-N`, `mob preview c-N`; ended ceremonies show no countdown. |
| "MoB key" for the venue key | B-19 | "the hl trading key that MoB holds for this wallet"; "Your MoB API key is not affected." |
| `mob keys delete` with no key | A-07 | A quiet success. |
| Install guide friction | A-08, A-09, A-11, A-27 | No `export PATH`; no re-download; one-line result; ends on How to use; Integrate only on request; never offer permission changes; uninstall removes the marketplace. |
| Codex | C-07, C-15, C-28, C-30 | `mob upgrade` on a tag checkout moves to the newest tag; tag-aware upgrade notice; quiet build; research-first next steps with a PATH line; Bun instructions; sandbox note. |
| Installer hints | A-13, A-18, C-14, C-16 | Profile file named, PATH hint last, plugin lines only when missing, a next step for each failure. |
| Preamble | C-08, C-11, C-13 | Pinned install line; `VERSION_SKEW`; an unreadable config is not an API outage. |
| Offline, corrupt config, re-download | A-20, C-10, C-11, C-18 | "No venue answered…"; research on defaults with a warning; no repeat download of the latest release. |
| MCP | C-25 | `onboarding_status` returns a not-set-up state; the instructions name `mob submit` and `mob sign` in the terminal; the history description no longer says Lighter has no history. |
| Help | C-17 | Groups, hidden internal commands, `mob help <command>`, nearest-command hint. |
| First scan answer, glossary size | A-15, C-21 | Five-row tables, one lead line each, failures in one sentence; glossaries list only present fields. |
| Menu notes and slash-menu tags | A-25, B-21, B-24 | The account note names the Learn rows; Claude skills drop the duplicate "(mstack)"; no setup note after "Not now"; venue counts pluralized. |
| Two minutes | B-14 | "About five minutes" everywhere. |

## Not changed, and why

- **B-10**, the five-minute window starts at staging. Moving the prepare step to sign time changes the staged bytes that the user consented to (AGENTS.md: keep exact staged bytes and expiry). The skill now stages only when the wallet can sign at once, and the card shows the time left. A server-side or design decision for the owner.
- **B-18**, `claude -p` and SDK hosts cannot authorize. By design: an agent could start `claude -p` itself. The denial now says so and points to the human's terminal.
- **C-27** (MCP home tool), **C-31** (compact scan table at 80 columns), **A-03** (release-binary update notice in the doctor), **B-16** (full step list on the signing page), **A-06** (display names in the welcome), **B-24** (key mark on the Ready row): larger UI changes, left for a later package.
- **C-33**, release ordering: the hook no longer fails, but the release process should still publish assets before the version bump reaches `main`.
- **A-14**, per-skill permission prompts in default mode are Claude Code behavior; the README says how to stop them.

## Checks

Final state, 2026-10-26:
- `bun run gen:skills`: generated, with no drift on a second run.
- `bun run check`, `bun run deadcode`, `bun run build`: pass.
- `bun run lint`: pass, with one existing info in `apps/cli/test/ceremony.test.ts:455`.
- Full suite with `MSTACK_TEST_MOB_BIN=apps/cli/dist/mob`: 1,448 package tests and 351 CLI tests pass, 0 fail.
- `claude plugin validate --strict .` and `.claude-plugin/plugin.json`: pass.

## Live verification

- `mob onboard --owner 0x…01` against live MoB prints the checklist; `mob keys create` names the unbound venue instead of "malformed body".
- Reviewer C's 67 guard cases: 18 blocked before, 7 after; all 7 are deliberate (real sign and submit without config, `source`, `bash -c`, and text that names an id or a mob sign command).
- Interactive bare `/mstack:mob` (tmux, checkout plugin, fresh home): the picker shows the intro in its question and the welcome in its preview; the second-level picker is unchanged.
- Headless "set up mstack": requirements first, WalletConnect last with the Reown link, plain `mob` commands, 1,000 USD suggestion.
- Headless "best funding now": the scan JSON is 24.8 KB at `--top 5` (45 KB before) and fits one tool result; 7 turns instead of 10, five-row tables, extreme APYs flagged.
- The guard narrowing found in self-review: `~/.mob` and `mob.exchange` are not mob mentions, but a copy such as `/tmp/.mob` is, and a grep with a leading assignment keeps its words counted. Both have tests.

## Skill triggers (follow-up)

**Problem.** All 11 skills let the model pick them by description, and 48 quoted trigger phrases carried no mstack, MoB or perp-funding word. Claude Code lists a user-scope plugin's skills in every session in every project, so "connect wallet" in a dApp repo started setup, "what can you do?" opened the mstack menu, and "close task 12" started a close. In the maintainer's full setup, 277 skills are listed and Claude Code drops 216 descriptions to fit its listing budget (1% of the context window). mstack kept 10 of its 11 descriptions.

**Change.**
- Every quoted trigger names mstack, MoB, perp, funding, basis, delta neutral, or a venue or asset.
- Three descriptions add one exclusion: explaining code, PnL in local code, issue-tracker tasks.
- The router no longer says "Start here"; that phrase drew "getting started".
- The 11 descriptions total 2,343 characters (2,448 before).
- The Codex short description is the whole first sentence, never cut mid-word.
- `packages/skills.test.ts` enforces the domain-word rule and the Codex short description. `packages/repo-hygiene.test.ts` pins the task-first openings and the first-contact phrases, and its YAML parse caught a colon in one draft.

**Method.** Headless `claude -p` runs (Claude Code 2.1.310, Opus, effort high, `--plugin-dir`, `--no-session-persistence`) in two setups:
- Lean: `--setting-sources project,local`, so mstack and the built-in skills only (25 listed).
- Full: the maintainer's own settings (277 listed).

Shell, edit and web tools were denied and the Skill tool was allowed. A run counts as clean when it loads no mstack skill, and as a hit when it loads the expected one. The sample projects were a Next.js and wagmi dApp, a pandas backtest, a small Python app, and an empty folder. Every run ended normally or on the four-turn limit after acting.

| Set | 0.5.1 | This branch |
|---|---|---|
| 18 unrelated-project prompts, no mstack skill | 19/36 | 73/76 |
| 19 mstack prompts, expected skill | 36/36 (18 prompts) | 38/38 |
| 8 bare menu phrases from a cold start ("my positions", "my key") | 16/16 | 16/16 |
| 12 README "Ask" phrases from a cold start | not run | 24/24 |
| 9 follow-ups inside an mstack conversation, shell allowed | not run | 18/18 |

The follow-ups ran two turns in one session with a fresh `MOB_HOME`:
- After "best funding now" or "what is mstack?", these bare phrases each loaded the matching skill: "my positions", "open a position", "my key", "raise my cap", "all markets", "how does funding work".
- "did those spreads hold?" reran the scan with `--realized`.
- "close task <id>" after a status check loaded the close skill.
- `/mstack:mob` followed by "my positions" loaded the status skill.

The first turns ran live scans of all 20 venues.

**Interactive check** (tmux, your full setup, checkout plugin, fresh home):
- `/mstack:mob` showed the intro in the question and the live welcome in the preview.
- "Find trades" opened the rows picker, and "best funding now" loaded the scan skill and ran a live scan.
- "my positions" then loaded `mstack:mob-status`, which asked for the public address.
- "connect wallet" in the dApp folder loaded no skill; Claude built the button.

That address question first said 'Choose "Other"', but Claude Code 2.1.310 labels that option "Type something." The Claude overlay now says to type the address and not to name the option. Two reruns asked "Type it in".

**What remains.** All three misses are "what's my pnl?" in a bare folder in the lean setup: the model reads it as MoB PnL. The same prompt in a git repo is clean in 8 of 8 runs, and in the full setup in 4 of 4. Removing PnL from the description made it worse (0 of 8 clean), so the exclusion stays.
