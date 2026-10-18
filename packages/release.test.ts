import { afterAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
	formatReleaseTagPlan,
	moveUnreleased,
	releaseNotes,
	releaseTagPlan,
} from "../scripts/release.ts";

const temporary = await mkdtemp(join(tmpdir(), "mob-release-helper-"));
afterAll(() => rm(temporary, { recursive: true, force: true }));
const helper = resolve(import.meta.dir, "../scripts/release.ts");
const changelog =
	"# Changelog\n<!-- release-start -->\n## [Unreleased]\n\n- A new feature.\n\n## [0.1.0] - Historical summary\n\n- Initial release.\n<!-- release-end -->\n";

async function command(args: string[], cwd: string, env = process.env) {
	const child = Bun.spawn(args, { cwd, env, stdout: "pipe", stderr: "pipe" });
	const [code, out, err] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	return { code, out, err };
}

async function fixture() {
	const root = await mkdtemp(join(temporary, "repo-"));
	const files: Record<string, string> = {
		"package.json": JSON.stringify(
			{
				name: "mstack",
				version: "0.1.0",
				workspaces: ["packages/*", "apps/*"],
			},
			null,
			"\t",
		),
		"packages/example/package.json": '{"name":"example", "version":"0.1.0"}\n',
		"apps/cli/package.json": '{"name":"cli", "version":"0.1.0"}\n',
		".claude-plugin/plugin.json": '{"name":"mstack", "version":"0.1.0"}\n',
		".claude-plugin/marketplace.json":
			'{"metadata":{"version":"0.1.0"},"plugins":[{"version":"0.1.0"}]}\n',
		"bun.lock":
			'{\n  "workspaces": {"apps/cli":{"version":"0.1.0"}},\n  "packages": {"dependency": ["dependency@0.1.0"]}\n}\n',
		"CHANGELOG.md": changelog,
		"README.md": "Read docs at <tag>. Last release v0.1.0.\n",
		"docs/AGENT-INSTALL.md": "Install release <tag> from <tag>.\n",
		"docs/AGENT-PROMPT.md": "Prompt for <tag>.\n",
		"docs/MOBIUS-ASKS.md": "Ask G quotes <tag>.\n",
		"skills/mob/SKILL.md": "version: 0.1.0\n",
	};
	for (const [file, body] of Object.entries(files)) {
		await mkdir(dirname(join(root, file)), { recursive: true });
		await writeFile(join(root, file), body);
	}
	for (const args of [
		["init", "-b", "fixture"],
		["config", "user.email", "fixture@example.invalid"],
		["config", "user.name", "Release fixture"],
		["add", "."],
		["commit", "-m", "fixture"],
	]) {
		const result = await command(["git", ...args], root);
		if (result.code) throw new Error(result.err);
	}
	const tools = await mkdtemp(join(temporary, "tools-"));
	const log = join(tools, "commands");
	for (const name of ["bun", "claude"])
		await writeFile(
			join(tools, name),
			[
				"#!/bin/sh",
				`printf '%s\\n' '${name}'" $*" >> "$RELEASE_TEST_LOG"`,
				`if [ "\${RELEASE_TEST_FAIL:-}" = "$*" ]; then exit 1; fi`,
				// Fail only the second run of a gate: the pass after the version bump.
				`if [ "\${RELEASE_TEST_FAIL_SECOND:-}" = "$*" ] && [ "$(grep -c -x -F '${name}'" $*" "$RELEASE_TEST_LOG")" -ge 2 ]; then exit 1; fi`,
				// A fake generator that bakes the package version into a skill.
				`if [ "$*" = "run gen:skills" ] && [ -n "\${RELEASE_TEST_SKILL:-}" ]; then`,
				'  mkdir -p "$(dirname "$RELEASE_TEST_SKILL")"',
				`  printf 'version: %s\\n' "$(sed -n 's/.*"version": *"\\([^"]*\\)".*/\\1/p' package.json | head -1)" > "$RELEASE_TEST_SKILL"`,
				"fi",
				"",
			].join("\n"),
			{ mode: 0o755 },
		);
	const env = {
		...process.env,
		PATH: `${tools}:${process.env.PATH}`,
		RELEASE_TEST_LOG: log,
	};
	return {
		root,
		files,
		log,
		run: (
			version: string,
			prepare: boolean,
			extra: Record<string, string> = {},
		) =>
			command(
				[
					process.execPath,
					"-e",
					`import {release} from ${JSON.stringify(helper)}; await release(${JSON.stringify(version)}, {root:${JSON.stringify(root)}, prepare:${prepare}});`,
				],
				root,
				{ ...env, ...extra },
			),
	};
}

test("release notes move only Unreleased and extract exactly the requested version", () => {
	const result = moveUnreleased(changelog, "0.3.0", "2026-10-11");
	expect(result).toContain("## [Unreleased]\n\n## [0.3.0] - 2026-10-11");
	expect(result).toContain(
		"## [0.1.0] - Historical summary\n\n- Initial release.",
	);
	expect(releaseNotes(result, "0.3.0")).toBe("- A new feature.\n");
	expect(() => releaseNotes(result, "9.9.9")).toThrow("no section");
	expect(() => moveUnreleased(result, "0.3.0", "2026-10-11")).toThrow(
		"already contains",
	);
	expect(() =>
		moveUnreleased(
			"## [Unreleased]\n\n## [0.1.0] - old\ntext",
			"0.3.0",
			"2026-10-11",
		),
	).toThrow("empty");
});

test("release refuses tracked or untracked dirt before running a gate or editing", async () => {
	const f = await fixture();
	await writeFile(join(f.root, "untracked"), "leave me alone");
	expect((await f.run("0.3.0", true)).err).toContain("clean tree");
	await rm(join(f.root, "untracked"));
	await writeFile(join(f.root, "CHANGELOG.md"), `${changelog}changed\n`);
	expect((await f.run("0.3.0", true)).err).toContain("clean tree");
	expect(await Bun.file(f.log).exists()).toBe(false);
	expect(
		JSON.parse(await readFile(join(f.root, "package.json"), "utf8")).version,
	).toBe("0.1.0");
});

test("prepare bumps every manifest and only workspace lock metadata, runs gates, and does not tag", async () => {
	const f = await fixture();
	const result = await f.run("0.3.0", true);
	expect(result.code).toBe(0);
	expect(result.out).toContain("No commit, tag or push");
	for (const file of [
		"package.json",
		"packages/example/package.json",
		"apps/cli/package.json",
		".claude-plugin/plugin.json",
	])
		expect(JSON.parse(await readFile(join(f.root, file), "utf8")).version).toBe(
			"0.3.0",
		);
	const market = JSON.parse(
		await readFile(join(f.root, ".claude-plugin/marketplace.json"), "utf8"),
	);
	expect(market.metadata.version).toBe("0.3.0");
	expect(market.plugins[0].version).toBe("0.3.0");
	const lock = JSON.parse(await readFile(join(f.root, "bun.lock"), "utf8"));
	expect(lock.workspaces["apps/cli"].version).toBe("0.3.0");
	expect(lock.packages.dependency).toEqual(["dependency@0.1.0"]);
	expect(await readFile(join(f.root, "README.md"), "utf8")).toBe(
		"Read docs at v0.3.0. Last release v0.3.0.\n",
	);
	expect(await readFile(join(f.root, "docs/AGENT-INSTALL.md"), "utf8")).toBe(
		"Install release v0.3.0 from v0.3.0.\n",
	);
	expect(await readFile(join(f.root, "docs/AGENT-PROMPT.md"), "utf8")).toBe(
		"Prompt for v0.3.0.\n",
	);
	expect((await command(["git", "tag"], f.root)).out).toBe("");
	expect(
		(await command(["git", "rev-list", "--count", "HEAD"], f.root)).out.trim(),
	).toBe("1");
	const gates = (await readFile(f.log, "utf8")).trim().split("\n");
	const expected = [
		"bun install --frozen-lockfile",
		"bun run gen:skills",
		"bun run check",
		"bun run lint",
		"bun run test --timeout 30000",
		"bun run deadcode",
		"bun run build",
		"claude plugin validate --strict .",
	];
	expect(gates).toEqual([...expected, ...expected]);
	await command(["git", "add", "."], f.root);
	await command(["git", "commit", "-m", "prepared"], f.root);
	expect((await f.run("0.3.0", false)).code).toBe(0);
	expect((await command(["git", "rev-parse", "v0.3.0^{}"], f.root)).out).toBe(
		(await command(["git", "rev-parse", "HEAD"], f.root)).out,
	);
	expect(
		(await command(["git", "rev-list", "--count", "HEAD"], f.root)).out.trim(),
	).toBe("2");
});

test("release tag dry run reports every placeholder without editing", async () => {
	const f = await fixture();
	const before = await readFile(join(f.root, "docs/AGENT-INSTALL.md"), "utf8");
	const plan = await releaseTagPlan(f.root, "0.3.0");
	expect(
		plan.map(({ file, replacements }) => ({ file, replacements })),
	).toEqual([
		{ file: "docs/AGENT-INSTALL.md", replacements: 2 },
		{ file: "docs/AGENT-PROMPT.md", replacements: 1 },
		{ file: "docs/MOBIUS-ASKS.md", replacements: 1 },
		{ file: "README.md", replacements: 2 },
	]);
	expect(formatReleaseTagPlan(plan)).toContain("docs/AGENT-INSTALL.md: 2");
	expect(plan.every(({ body }) => !body.includes("<tag>"))).toBe(true);
	expect(await readFile(join(f.root, "docs/AGENT-INSTALL.md"), "utf8")).toBe(
		before,
	);
	const cli = await command(
		[process.execPath, helper, "--notes", "0.1.0"],
		f.root,
	);
	expect(cli.code).toBe(0);
	expect(cli.out).toContain("Initial release.");
	expect(cli.err).toContain("docs/AGENT-INSTALL.md: 2");
	expect(await readFile(join(f.root, "docs/AGENT-INSTALL.md"), "utf8")).toBe(
		before,
	);
});

test("normal release commits the bump before tagging, and refuses an existing tag", async () => {
	const f = await fixture();
	expect((await f.run("0.3.0", false)).code).toBe(0);
	expect(
		(await command(["git", "log", "-1", "--format=%s"], f.root)).out.trim(),
	).toBe("chore(release): 0.3.0");
	expect((await command(["git", "status", "--porcelain"], f.root)).out).toBe(
		"",
	);
	expect((await f.run("0.3.0", false)).err).toContain("already exists");
});

test("a failed gate prevents edits and tags", async () => {
	const f = await fixture();
	expect(
		(await f.run("0.3.0", false, { RELEASE_TEST_FAIL: "run lint" })).code,
	).toBe(1);
	expect((await command(["git", "status", "--porcelain"], f.root)).out).toBe(
		"",
	);
	expect((await command(["git", "tag"], f.root)).out).toBe("");
});

test("a version bump regenerates the skills and commits them with the release", async () => {
	const skill = { RELEASE_TEST_SKILL: "skills/mob/SKILL.md" };
	const f = await fixture();
	expect((await f.run("0.3.0", true, skill)).code).toBe(0);
	expect(await readFile(join(f.root, "skills/mob/SKILL.md"), "utf8")).toBe(
		"version: 0.3.0\n",
	);
	await command(["git", "checkout", "--", "."], f.root);
	expect((await f.run("0.3.0", false, skill)).code).toBe(0);
	expect((await command(["git", "status", "--porcelain"], f.root)).out).toBe(
		"",
	);
	expect(
		(await command(["git", "show", "--format=", "--name-only", "HEAD"], f.root))
			.out,
	).toContain("skills/mob/SKILL.md");
	// A gate that fails after the bump restores the manifests and the skills.
	const g = await fixture();
	expect(
		(
			await g.run("0.3.0", false, {
				...skill,
				RELEASE_TEST_FAIL_SECOND: "run build",
			})
		).code,
	).toBe(1);
	expect((await command(["git", "status", "--porcelain"], g.root)).out).toBe(
		"",
	);
	expect((await command(["git", "tag"], g.root)).out).toBe("");
});
