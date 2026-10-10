You are Codex, the implementer on this repo. Read AGENTS.md, docs/BUILD-PLAN.md, and docs/reports/W5.md ("P0 complete") first; the previous Codex thread built P0 and this is a fresh thread in the same repository.

The project now lives at https://github.com/da-bao-jian/mstack (private, `main` pushed at 4efc0be) and takes the repository's name. Work package W6, one commit `chore: rename project to mstack`:

1. Rename the project identifier `mobstack` → `mstack` everywhere it is a name: root package `name`, the `@mobstack/*` package scope → `@mstack/*` (package.json names, every import, `bun install` to regenerate bun.lock), plugin `name` and marketplace `name`/entries in `.claude-plugin/`, the `(mobstack)` suffix in skill descriptions → `(mstack)`, the skill preamble lookup paths `$HOME/.claude/skills/mobstack/bin` and `$HOME/.codex/skills/mobstack/bin` → `mstack`, the `./setup` install directory names and its printed paragraph, the `X-Mobius-Client: mobstack/<v>` and `User-Agent` values → `mstack/<v>` (CLI, MCP, preamble), live-smoke prefixes, root/package READMEs, docs/BUILD-PLAN.md, AGENTS.md. Keep unchanged: the `mob` binary name, the `/mob`, `/mob-scan`, `/mob-explain`, `/mob-status` skill names, `~/.mob`, `MOB_HOME`, `MOB_LIVE`, config keys, the `mob:` error prefix. Do not edit docs/PRD.md (its working names are declared placeholders) and do not rewrite the historical reports W0–W5 or the prompts under docs/prompts/; they are the paper trail.

2. README: the repository is published now, so replace every `lu-bann/mobstack` / "not published yet" wording with `https://github.com/da-bao-jian/mstack.git`, `/plugin marketplace add da-bao-jian/mstack` and `/plugin install mstack`, and the clone path `~/.claude/skills/mstack`. Keep the custody statement verbatim.

3. AGENTS.md rule 9 becomes: "Commit per work package on `main` with a conventional-commit message. Do not push and do not change remotes; Fable pushes after review."

4. Regenerate the skills (`bun run gen:skills`), run every root gate, `bun run build`, `claude plugin validate .`, and `./setup --host codex -q` into a temporary HOME followed by its preamble and `--uninstall`. Then `grep -rni mobstack --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=reference --exclude-dir=.codex-runs .` must list only docs/PRD.md, docs/reports/W0..W5, and docs/prompts/; paste that list in the report.

5. Write docs/reports/W6.md, commit it with the rename, stop. Do not push.
