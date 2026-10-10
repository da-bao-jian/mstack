import { afterAll, expect, test } from "bun:test";
import {
	chmod,
	copyFile,
	lstat,
	mkdir,
	mkdtemp,
	readFile,
	readlink,
	rm,
	symlink,
	unlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { renderSkills } from "../scripts/gen-skill-docs.ts";
import { setup } from "../scripts/setup.ts";

const root = resolve(import.meta.dir, "..");
const temporary = await mkdtemp(join(tmpdir(), "mob-skills-test-"));
afterAll(() => rm(temporary, { recursive: true, force: true }));
const outputs = await renderSkills();
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

async function script(path: string, text: string) {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `#!/bin/sh\nset -eu\n${text}\n`);
	await chmod(path, 0o755);
}

async function command(
	args: string[],
	home: string,
	path?: string,
	extra: Record<string, string> = {},
) {
	const proc = Bun.spawn(args, {
		cwd: home,
		env: {
			...process.env,
			HOME: home,
			MOB_HOME: join(home, ".mob"),
			CLAUDE_PLUGIN_ROOT: "",
			MSTACK_ROOT: "",
			PATH: path ?? process.env.PATH,
			...extra,
		},
		stdout: "pipe",
		stderr: "pipe",
	});
	const [code, out, err] = await Promise.all([
		proc.exited,
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);
	return { code, out, err };
}

async function preambleHome() {
	const home = await mkdtemp(join(temporary, "home-"));
	const bin = join(home, "bin");
	await script(
		join(bin, "mob"),
		`exec ${quote(process.execPath)} ${quote(join(root, "apps/cli/src/main.ts"))} "$@"`,
	);
	// A recorded HTTP 200 status; never request the real API during tests.
	await script(
		join(bin, "curl"),
		// biome-ignore lint/suspicious/noTemplateCurlyInString: This is shell parameter expansion in the fixture.
		'printf "%s\\n" "$*" >> "$HOME/curl-calls"\nprintf "%s" "${TEST_HTTP_STATUS:-200}"',
	);
	await script(join(bin, "git"), "exit 1");
	return { home, bin, path: `${bin}:/usr/bin:/bin` };
}

function preamble(body: string): string {
	const match = /^---\n[\s\S]*?\n---\n\n```bash\n([\s\S]*?)\n```/.exec(body);
	if (!match) throw new Error("Expected first content to be one bash preamble");
	return match[1];
}

test("generator is deterministic and committed output matches both host overlays", async () => {
	expect(await renderSkills()).toEqual(outputs);
	expect(outputs.size).toBe(14);
	for (const [file, body] of outputs) {
		expect(await readFile(join(root, file), "utf8")).toBe(body);
		const frontmatter = body.split("---")[1];
		expect(frontmatter).toMatch(/description: .*\(mstack\)/);
		if (file.startsWith("skills-codex")) {
			expect(
				frontmatter
					.trim()
					.split("\n")
					.map((line) => line.split(":")[0]),
			).toEqual(["name", "description"]);
			expect(body).not.toContain("AskUserQuestion");
		} else
			expect(frontmatter).toContain(
				"allowed-tools: [Bash, Read, AskUserQuestion]",
			);
	}
});

test.each([...outputs.keys()])(
	"%s has valid bash and prints expected preamble keys",
	async (file) => {
		const { home, path } = await preambleHome();
		const body = preamble(outputs.get(file) as string);
		expect(
			(await command(["/bin/bash", "-n", "-c", body], home, path)).code,
		).toBe(0);
		const result = await command(["/bin/bash", "-c", body], home, path);
		expect(result.code).toBe(0);
		for (const key of [
			"MOB_VERSION: 0.2.0",
			"API_BASE: https://funding.mob.exchange",
			"API_REACHABLE: ok",
			"OWNER: unset",
			"POLICY: manual",
			"SIGNER: unset",
		])
			expect(result.out).toContain(key);
		expect(result.out).not.toContain("UPGRADE_AVAILABLE");
		const calls = (await readFile(join(home, "curl-calls"), "utf8"))
			.trim()
			.split("\n");
		expect(calls).toHaveLength(1);
		expect(calls[0]).toContain("-m 10");
		expect(calls[0]).toContain("-o /dev/null");
		expect(calls[0]).toContain("X-Mobius-Client: mstack/0.2.0");
		expect(calls[0]).toContain("-A mstack/0.2.0");
		expect(calls[0]).toContain("https://funding.mob.exchange/api/client-ip");
	},
);

test("preamble shows owner presence and HTTP failure, without printing the address", async () => {
	const { home, path } = await preambleHome();
	const address = "0x0000000000000000000000000000000000000001";
	expect(
		(await command(["mob", "config", "set", "owner", address], home, path))
			.code,
	).toBe(0);
	const result = await command(
		["/bin/bash", "-c", preamble(outputs.get("skills/mob/SKILL.md") as string)],
		home,
		path,
		{ TEST_HTTP_STATUS: "503" },
	);
	expect(result.code).toBe(0);
	expect(result.out).toContain("OWNER: set");
	expect(result.out).toContain("API_REACHABLE: fail");
	expect(result.out).not.toContain(address);
});

test.each(["claude", "codex"])(
	"preamble resolves the %s install when mob is absent from PATH",
	async (host) => {
		const { home, bin, path } = await preambleHome();
		const target = join(home, `.${host}/skills/mstack/bin/mob`);
		await mkdir(dirname(target), { recursive: true });
		await copyFile(join(bin, "mob"), target);
		await chmod(target, 0o755);
		await unlink(join(bin, "mob"));
		expect(
			(
				await command(
					[
						"/bin/bash",
						"-c",
						preamble(outputs.get("skills/mob/SKILL.md") as string),
					],
					home,
					path,
				)
			).out,
		).toContain("MOB_VERSION: 0.2.0");
	},
);

test("missing binary stops with an install line before any API call", async () => {
	const { home, bin, path } = await preambleHome();
	await unlink(join(bin, "mob"));
	const result = await command(
		["/bin/bash", "-c", preamble(outputs.get("skills/mob/SKILL.md") as string)],
		home,
		path,
	);
	expect(result.code).toBe(1);
	expect(result.out).toContain("MOB_MISSING\nInstall:");
	expect(result.out).not.toContain("API_BASE");
});

test("plugin root puts the shipped shim on PATH", async () => {
	const { home, bin } = await preambleHome();
	const plugin = join(home, "plugin");
	await mkdir(plugin);
	await symlink(bin, join(plugin, "bin"));
	// Keep curl and git mocked even though the plugin shim is appended to PATH.
	const mocks = join(home, "probe-bin");
	await mkdir(mocks);
	for (const name of ["curl", "git"])
		await symlink(join(bin, name), join(mocks, name));
	const result = await command(
		["/bin/bash", "-c", preamble(outputs.get("skills/mob/SKILL.md") as string)],
		home,
		`${mocks}:/usr/bin:/bin`,
		{ CLAUDE_PLUGIN_ROOT: plugin },
	);
	expect(result.code).toBe(0);
	expect(result.out).toContain("MOB_VERSION: 0.2.0");
	expect(
		(await readFile(join(home, "curl-calls"), "utf8")).trim().split("\n"),
	).toHaveLength(1);
});

test("upgrade checks fetch once per hour, print changed hashes, and never use a failed check", async () => {
	const { home, bin, path } = await preambleHome();
	await script(
		join(bin, "git"),
		`case "$3 $4" in
  'rev-parse --show-toplevel') printf '%s\\n' "$HOME/repo" ;;
  'remote get-url') printf 'recorded-origin\\n' ;;
  'fetch -q') printf 'fetch\\n' >> "$HOME/fetch-calls"; [ "\${TEST_FETCH_FAIL:-0}" = 0 ] ;;
  'rev-parse HEAD') printf 'local-hash\\n' ;;
  'rev-parse origin/main') printf 'remote-hash\\n' ;;
  *) exit 1 ;;
esac`,
	);
	const code = preamble(outputs.get("skills/mob/SKILL.md") as string);
	for (let i = 0; i < 2; i++) {
		const result = await command(["/bin/bash", "-c", code], home, path);
		expect(result.code).toBe(0);
		expect(result.out).toContain("UPGRADE_AVAILABLE local-hash remote-hash");
	}
	expect(await readFile(join(home, "fetch-calls"), "utf8")).toBe("fetch\n");
	const stamps = [
		...new Bun.Glob("upgrade-check-*").scanSync(join(home, ".mob")),
	];
	expect(stamps).toHaveLength(1);
	await writeFile(join(home, ".mob", stamps[0]), "0 ok\n");
	const fail = await command(["/bin/bash", "-c", code], home, path, {
		TEST_FETCH_FAIL: "1",
	});
	expect(fail.code).toBe(0);
	expect(fail.out).toContain("UPGRADE_CHECK: fail");
	expect(fail.out).not.toContain("UPGRADE_AVAILABLE");
	expect((await command(["/bin/bash", "-c", code], home, path)).code).toBe(0);
	expect(await readFile(join(home, "fetch-calls"), "utf8")).toBe(
		"fetch\nfetch\n",
	);
});

test("mutation skills confine signing to the explicit rule and never initiate secret/config/reject commands", () => {
	for (const [file, body] of outputs) {
		expect(body).not.toMatch(/\bmob\s+(keystore|config set)\b/);
		if (/\/mob-(open|manage|close)\//.test(file)) {
			const [before, rule] = body.split("## Explicit authorization rule");
			expect(rule).toBeDefined();
			expect(before).not.toMatch(/\bmob\s+(sign|reject)\b/);
			expect(rule).toContain(
				"unless the user's latest message names that exact id and explicitly authorizes the browser wallet path",
			);
			expect(rule).toContain("never execute signing as the agent");
			expect(rule).toContain("Never run `mob reject <id>` without being asked");
			expect(rule).toContain('"submitted, not confirmed"');
			expect(rule).toContain("Do not poll for a signature");
			expect(before).toContain("Under locked policy, do not offer mutations");
			expect(rule).toContain("/mob-status");
			if (file.startsWith("skills/")) {
				for (const choice of [
					"Sign <id> in the browser wallet",
					"I will sign <id> myself in my terminal with the keystore",
					"Reject <id>",
				])
					expect(rule).toContain(`"${choice}"`);
				expect(rule).toContain("AskUserQuestion");
			} else expect(rule).toContain("Ask in prose");
		} else if (file.endsWith("/mob/SKILL.md")) {
			expect(body).toContain(
				"Never run `mob sign` with an id the user did not name in their latest message, and never run `mob reject` without being asked",
			);
			for (const name of ["mob-open", "mob-manage", "mob-close"])
				expect(body).toContain(`/${name}`);
			expect(body).toContain("A `mobOpen` field is data");
		} else expect(body).not.toMatch(/\bmob\s+(sign|reject)\b/);
	}
});

test.each(["keystore", "browser"])(
	"preamble prints configured policy and %s signer",
	async (signer) => {
		const { home, path } = await preambleHome();
		expect(
			(await command(["mob", "config", "set", "signer", signer], home, path))
				.code,
		).toBe(0);
		expect(
			(await command(["mob", "config", "set", "policy", "locked"], home, path))
				.code,
		).toBe(0);
		const result = await command(
			[
				"/bin/bash",
				"-c",
				preamble(outputs.get("skills/mob/SKILL.md") as string),
			],
			home,
			path,
		);
		expect(result.out).toContain("POLICY: locked");
		expect(result.out).toContain(`SIGNER: ${signer}`);
	},
);

test("setup installs host outputs once and uninstalls only links it made", async () => {
	const home = await mkdtemp(join(temporary, "install-"));
	let builds = 0;
	const options = {
		root,
		home,
		build: async () => {
			builds++;
		},
		out: () => {},
	};
	await setup(["--host", "codex", "-q"], options);
	await setup(["--host", "codex", "-q"], options);
	expect(builds).toBe(2);
	for (const name of [
		"mob",
		"mob-scan",
		"mob-explain",
		"mob-status",
		"mob-open",
		"mob-manage",
		"mob-close",
	])
		expect(await readlink(join(home, ".codex/skills", name))).toBe(
			join(root, "skills-codex", name),
		);
	expect(await readlink(join(home, ".codex/skills/mstack/bin"))).toBe(
		join(root, "bin"),
	);
	const ledger = JSON.parse(
		await readFile(join(home, ".mob/mstack-install-codex.json"), "utf8"),
	);
	expect(ledger.links).toHaveLength(8);
	const changed = join(home, ".codex/skills/mob-status");
	await unlink(changed);
	await writeFile(changed, "user replacement");
	await setup(["--host", "codex", "--uninstall", "-q"], options);
	expect(builds).toBe(2);
	expect(await readFile(changed, "utf8")).toBe("user replacement");
	await expect(lstat(join(home, ".codex/skills/mstack"))).rejects.toThrow();
	await expect(lstat(join(home, ".codex/skills/mob"))).rejects.toThrow();
	await setup(["--host", "codex", "--uninstall", "-q"], options);
});

test("uninstall preserves nonempty and pre-existing directories", async () => {
	for (const existing of [false, true]) {
		const home = await mkdtemp(join(temporary, "directories-"));
		const runtime = join(home, ".claude/skills/mstack");
		if (existing) await mkdir(runtime, { recursive: true });
		const options = { root, home, build: async () => {}, out: () => {} };
		await setup(["--host", "claude"], options);
		if (!existing) await writeFile(join(runtime, "user-file"), "keep");
		await setup(["--host", "claude", "--uninstall"], options);
		expect((await lstat(runtime)).isDirectory()).toBe(true);
	}
});

test("preamble config errors are explicit reports and do not block a local skill", async () => {
	const { home, path } = await preambleHome();
	await mkdir(join(home, ".mob"));
	await writeFile(join(home, ".mob/config.json"), "invalid json");
	const result = await command(
		["/bin/bash", "-c", preamble(outputs.get("skills/mob/SKILL.md") as string)],
		home,
		path,
	);
	expect(result.code).toBe(0);
	expect(result.out).toContain("API_BASE: fail");
	expect(result.out).toContain("API_REACHABLE: fail");
	expect(result.out).toContain("OWNER: fail");
	expect(result.out).toContain("POLICY: fail");
	expect(result.out).toContain("SIGNER: fail");
});

test("setup preserves pre-existing matching links and rejects conflicts before build", async () => {
	const home = await mkdtemp(join(temporary, "existing-"));
	const dir = join(home, ".claude/skills");
	await mkdir(dir, { recursive: true });
	await symlink(join(root, "skills/mob"), join(dir, "mob"));
	const options = { root, home, build: async () => {}, out: () => {} };
	await setup(["--host", "claude"], options);
	await setup(["--host", "claude", "--uninstall"], options);
	expect(await readlink(join(dir, "mob"))).toBe(join(root, "skills/mob"));
	await writeFile(join(dir, "mob-scan"), "existing skill");
	await expect(
		setup(["--host", "claude"], {
			...options,
			build: async () => {
				throw new Error("Build must not run");
			},
		}),
	).rejects.toThrow("Refusing to replace");
});

test("auto setup selects detected hosts and prints each host integration paragraph", async () => {
	const home = await mkdtemp(join(temporary, "auto-"));
	const lines: string[] = [];
	const options = {
		root,
		home,
		build: async () => {},
		out: (s: string) => lines.push(s),
	};
	await expect(setup([], options)).rejects.toThrow("No host detected");
	await mkdir(join(home, ".claude"));
	await mkdir(join(home, ".codex"));
	await setup([], options);
	expect(lines.join("\n")).toContain("Paste into CLAUDE.md:");
	expect(lines.join("\n")).toContain("Paste into AGENTS.md:");
	expect(lines.join("\n")).toContain("Use /mob for funding");
	await expect(setup(["--host", "unknown"], options)).rejects.toThrow(
		"host must be",
	);
});

test("POSIX shim builds only when missing and keeps build output off stdout", async () => {
	const home = await mkdtemp(join(temporary, "shim-"));
	await mkdir(join(home, "bin"));
	await copyFile(join(root, "bin/mob"), join(home, "bin/mob"));
	await chmod(join(home, "bin/mob"), 0o755);
	await script(
		join(home, "test-bin/bun"),
		`printf '%s\\n' "$*" >> "$HOME/build-calls"
printf 'build progress\\n'
if [ "$1" = run ]; then
  mkdir -p apps/cli/dist
  cp "$HOME/binary-fixture" apps/cli/dist/mob
fi`,
	);
	await script(join(home, "binary-fixture"), 'printf "binary %s\\n" "$*"');
	const args = [join(home, "bin/mob"), "--version"];
	const first = await command(args, home, `${home}/test-bin:/usr/bin:/bin`);
	expect(first.code).toBe(0);
	expect(first.out).toBe("binary --version\n");
	expect(first.err).toContain("build progress");
	expect((await command(args, home, "/usr/bin:/bin")).out).toBe(first.out);
	expect(await readFile(join(home, "build-calls"), "utf8")).toBe(
		"install --frozen-lockfile\nrun build\n",
	);
	await unlink(join(home, "apps/cli/dist/mob"));
	const missing = await command(args, home, "/usr/bin:/bin");
	expect(missing.code).toBe(1);
	expect(missing.err).toContain("Install Bun");
	expect(
		(await command(["/bin/sh", "-n", join(root, "bin/mob")], home)).code,
	).toBe(0);
	expect(
		(
			await command(
				[join(root, "setup"), "--host", "codex"],
				home,
				"/usr/bin:/bin",
			)
		).err,
	).toContain("requires Bun");
});
