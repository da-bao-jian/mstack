# Package workflow and history

Fable coordinates scope, product decisions, and QA. Codex implements the assigned
work package. Codex does not choose the next package.

The current assignment is the delivery contract. `BUILD-PLAN.md` tracks the larger
sequence; `prompts/` and `reports/` preserve the decisions and results from each run.
An explicit current brief supersedes older plan text without rewriting the PRD.

## One package per run

1. Read `AGENTS.md`, the assigned package, and the required PRD sections.
2. Inspect the checkout and preserve other packages' work. Use the assigned branch.
3. Build the package and run all root gates. Keep the run under two hours.
4. Write the report with exact commands, results, omissions, and open questions.
5. Commit the package with a conventional message. Stop; do not push.
6. Fable checks the acceptance criteria, diff, gates, and relevant smoke checks.
7. Fable replies with approval or a numbered fix list. Fixes resume the same package.

If the package will exceed two hours, leave a precise handoff: finished work,
failing checks, remaining scope, and the next command. Do not report completion
while acceptance criteria remain unmet. Main was the original delivery branch;
parallel assignments now use isolated branches so reviews do not overwrite work.

## History index

| Package | Delivery |
|---|---|
| [W0](reports/W0.md) | Bun workspace, checks, CI, license |
| [W1](reports/W1.md) | Venue adapters, recorded fixtures, snapshots |
| [W2](reports/W2.md) | Fee-adjusted opportunity ranking |
| [W3](reports/W3.md) | Public CLI reads and compiled binary |
| [W4](reports/W4.md) | Generated skills, plugin, installer; W4.1 resilience |
| [W5](reports/W5.md) | Stdio MCP reads and bounded output |
| [W6](reports/W6.md) | Project rename to mstack |
| [W7](reports/W7.md) | Proposals, manual policy, keystore, write client |
| [W8](reports/W8.md) | Browser bridge; W8b WalletConnect |
| [W9](reports/W9.md) | Setup, legal acceptance, venue binding |
| [W10](reports/W10.md) | Open/manage preflight; W10.1 readiness fixes |
| [W11](reports/W11.md) | Mutation skills, MCP staging, sign guard, version 0.2.0 |
| [W12](reports/W12.md) | Brand, home screen, doctor |
| [W13](reports/W13.md) | Agent conventions and repository hygiene |
| [W14](reports/W14.md) | CLI output, sign lifecycle, help, sign-guard command, skill glossaries |
| [W15](reports/W15.md) | Signing page, ceremony steps, public setup flags |
| [W16](reports/W16.md) | Installer, release workflow, downloads, version 0.3.0 |
| W17 | Planned final security and production-readiness review |

The [onboarding QA report](reports/QA-onboarding-1.md) records findings across
packages. Reports describe the state at delivery; they are not current usage docs.

W13 keeps the plugin at the repository root with one `AGENTS.md`. This supersedes
the older proposal to move it into `plugin/` and add `CLAUDE.md`.
