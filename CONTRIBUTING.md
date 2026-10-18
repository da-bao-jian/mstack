# Contributing to mstack

Use Bun 1.3 or newer, Git, and a shell. Clone the repository and run:

```sh
bun install --frozen-lockfile
bun run build
```

`./setup --host claude` or `./setup --host codex` also builds the binary and links
the generated skills. To run the plugin itself from a checkout, add the directory as a
marketplace: `claude plugin marketplace add /path/to/mstack` and then
`claude plugin install mstack@mstack`. Claude Code reads a directory-sourced plugin in
place, so skill, hook, and manifest edits apply at the next session. Do not also link
the clone skills into `~/.claude/skills`, or `/mob` and `/mstack:mob` both match.
The Codex setup uses `~/.agents/skills` and mirrors links into `~/.codex/skills`
only when that older directory exists.
See [installation maintenance](docs/USAGE.md#installation-maintenance) for uninstall behavior.

## Checks before delivery

```sh
bun run gen:skills
bun run check
bun run lint
bun test
bun run deadcode
claude plugin validate --strict .
claude plugin validate --strict .claude-plugin/plugin.json
```

All four root gates must pass, with no lint warnings. Build changes also require
`bun run build`. Tests use recorded fixtures and local fake servers. Live checks
require `MOB_LIVE=1`; they are not part of unit tests.
Do not run real signing or trading ceremonies as part of a routine check.

## Add a venue adapter

1. Read `packages/funding/src/types.ts` and a nearby adapter under `src/adapters/`.
   Implement `VenueAdapter.fetchRates(ctx)` using the injected fetch, clock, and signal.
2. Record public responses once under `packages/funding/fixtures/<venue>/`.
   Record provenance and capture instructions in the fixtures documentation.
3. Preserve native market strings. Return the canonical rate fields plus observation
   metadata, source, and `annualizationMethod: "simple"`.
4. Reject malformed envelopes, missing required numbers, non-finite values, and HTTP
   failures. Do not catch an error and return an empty success or a stale rate.
5. Extend the contract cases in `packages/funding/test/adapters.test.ts`, fixture routing
   in `test/fixtures.ts`, and exact expected rows in `test/expected.json`.
6. Test malformed values, HTTP failure, abort/deadline behavior, and snapshot isolation.
   Export the adapter through `packages/funding/src/main.ts`; register it in the
   CLI adapter list at `apps/cli/src/commands/runtime.ts` and the live smoke list.
7. Document the public endpoints and venue tier. Adding scan support does not authorize
   an execution venue. Run all root gates and the guarded live smoke when assigned.

Keep byte-exact upstream ports with their provenance header and upstream test fixtures.
Do not modify `reference/` or `docs/PRD.md` to make a test pass.

## Skills and agent work

Edit `skills-src/*.md.tmpl`, `skills-src/<name>/references/`, and the host overlays.
Run `bun run gen:skills` and commit both host outputs, including Codex UI metadata.
Keep names equal to directory names, portable frontmatter, short descriptions,
one-level reference links, and skill files at most 120 lines.
Keep signing rules in the skill bodies, where the agent must read them.

Read [AGENTS.md](AGENTS.md) and the assigned brief before editing. An agent run
must stay under two hours. If scope remains at that limit, write a bounded handoff
with completed work, failing checks, remaining tasks, and the next command.
Do not self-assign another package. The coordinator reviews every delivery.
See [the process and history index](docs/PROCESS.md).

## Commits and releases

Use conventional commits, such as `feat(funding): add venue adapter` or
`fix(proposals): reject expired intent`. Keep one work package per delivery commit.
Include a report under `docs/reports/` with exact checks and known limits.
Do not push or change remotes during an implementation assignment.

Release assignments update workspace, plugin, and marketplace versions together,
regenerate skills, update `CHANGELOG.md`, and rerun the gates and strict validation.
Start an Unreleased section when new work begins. In a clean checkout, use
`bun scripts/release.ts <version> --prepare` to run gates and prepare version changes.
After review and commit, the release assignment can run the helper without `--prepare`
to create the local tag. The helper never pushes.
Build the supported artifacts, verify checksums, and test a clean installation.
Do not commit compiled binaries. The release coordinator handles tags and publishing.

Report vulnerabilities through [SECURITY.md](SECURITY.md), not a public bug report.
