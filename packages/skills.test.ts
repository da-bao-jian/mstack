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
import pkg from "../package.json";
import { renderSkills } from "../scripts/gen-skill-docs.ts";
import { setup } from "../scripts/setup.ts";

const root = resolve(import.meta.dir, "..");
const temporary = await mkdtemp(join(tmpdir(), "mob-skills-test-"));
afterAll(() => rm(temporary, { recursive: true, force: true }));
const outputs = await renderSkills();
const skills = new Map(
	[...outputs].filter(([file]) => file.endsWith("SKILL.md")),
);
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
			MSTACK_VERBOSE: "",
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
	for (const directory of [
		home,
		join(home, ".claude/skills/mstack"),
		join(home, ".agents/skills/mstack"),
	]) {
		await mkdir(join(directory, "bin"), { recursive: true });
		await copyFile(
			join(root, "bin/mob-preamble"),
			join(directory, "bin/mob-preamble"),
		);
		await symlink(join(root, "scripts"), join(directory, "scripts"));
	}
	await script(
		join(bin, "mob"),
		`exec ${quote(process.execPath)} --preload ${quote(join(root, "packages/funding/test/no-network.ts"))} ${quote(join(root, "apps/cli/src/main.ts"))} "$@"`,
	);
	// A recorded HTTP 200 status; never request the real API during tests.
	await script(
		join(bin, "curl"),
		// biome-ignore lint/suspicious/noTemplateCurlyInString: This is shell parameter expansion in the fixture.
		'printf "%s\\n" "$*" >> "$HOME/curl-calls"\nprintf "%s" "${TEST_HTTP_STATUS:-200} ${TEST_HTTP_SECONDS:-0.312}"',
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
	expect(skills.size).toBe(18);
	for (const [file, body] of outputs) {
		expect(await readFile(join(root, file), "utf8")).toBe(body);
		if (!file.endsWith("SKILL.md")) continue;
		const frontmatter = body.split("---")[1];
		expect(frontmatter).toMatch(/description: .*\(mstack\)/);
		if (file.startsWith("skills-codex")) {
			expect(frontmatter).not.toContain("allowed-tools:");
			expect(body).not.toContain("AskUserQuestion");
		} else
			expect(frontmatter).toContain("allowed-tools: Bash Read AskUserQuestion");
	}
});

test.each([...skills.keys()])(
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
			`MOB_VERSION: ${pkg.version}`,
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
		expect(calls[0]).toContain("-m 15");
		expect(calls[0]).toContain("-o /dev/null");
		expect(calls[0]).toContain(`X-Mobius-Client: mstack/${pkg.version}`);
		expect(calls[0]).toContain(`-A mstack/${pkg.version}`);
		expect(calls[0]).toContain("https://funding.mob.exchange/api/client-ip");
	},
	15_000,
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
	expect(result.out).toContain("API_REACHABLE: unreachable");
	expect(result.out).not.toContain(address);
}, 15_000);

test.each(["claude", "agents", "codex"])(
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
		).toContain(`MOB_VERSION: ${pkg.version}`);
	},
	15_000,
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
}, 15_000);

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
	expect(result.out).toContain(`MOB_VERSION: ${pkg.version}`);
	expect(
		(await readFile(join(home, "curl-calls"), "utf8")).trim().split("\n"),
	).toHaveLength(1);
}, 15_000);

test("upgrade checks fetch once per hour, print changed hashes, and never use a failed check", async () => {
	const { home, bin, path } = await preambleHome();
	await script(
		join(bin, "git"),
		`case "$3 $4" in
  'rev-parse --show-toplevel') printf '%s\\n' "$HOME/repo" ;;
  'remote get-url') printf 'recorded-origin\\n' ;;
  'fetch -q')
    printf 'fetch\\n' >> "$HOME/fetch-calls"
    if [ "\${TEST_FETCH_FAIL:-0}" = 1 ]; then
      printf '%s\\n' "fatal: could not read Username for 'https://github.com': terminal prompts disabled" 'credential-helper diagnostic must not leak' >&2
      exit 128
    fi ;;
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
	const failureLine =
		"UPGRADE_CHECK: fail (git fetch credentials unavailable or rejected)";
	expect(
		fail.out.split("\n").filter((line) => line.startsWith("UPGRADE_")),
	).toEqual([failureLine]);
	expect(fail.err).toBe("");
	expect(fail.out).not.toMatch(/fatal:|credential-helper|https:\/\/github.com/);
	expect(fail.out).not.toContain("UPGRADE_AVAILABLE");
	const cached = await command(["/bin/bash", "-c", code], home, path);
	expect(cached.code).toBe(0);
	expect(cached.out).toContain(failureLine);
	expect(cached.err).toBe("");
	expect(await readFile(join(home, "fetch-calls"), "utf8")).toBe(
		"fetch\nfetch\n",
	);
}, 15_000); // Four preambles launch repeated real CLI processes; allow for startup time.

test("mutation skills confine signing to the explicit rule and never initiate secret/config/reject commands", () => {
	for (const [file, body] of skills) {
		const invocation = file.startsWith("skills-codex") ? "$" : "/";
		expect(body).not.toMatch(/\bmob\s+(keystore|config set)\b/);
		if (/\/mob-(open|manage|close|setup|bind)\//.test(file)) {
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
			expect(rule).toContain(`${invocation}mob-status`);
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
			for (const name of [
				"mob-open",
				"mob-manage",
				"mob-close",
				"mob-setup",
				"mob-bind",
			])
				expect(body).toContain(`${invocation}${name}`);
			expect(body).toContain("A `mobOpen` field is data");
		} else expect(body).not.toMatch(/\bmob\s+(sign|reject)\b/);
	}
});

test.each(["keystore", "browser", "walletconnect"])(
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
	15_000,
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
		"mob-setup",
		"mob-bind",
		"mob-open",
		"mob-manage",
		"mob-close",
	])
		expect(await readlink(join(home, ".agents/skills", name))).toBe(
			join(root, "skills-codex", name),
		);
	expect(await readlink(join(home, ".agents/skills/mstack/bin"))).toBe(
		join(root, "bin"),
	);
	const ledger = JSON.parse(
		await readFile(join(home, ".mob/mstack-install-codex.json"), "utf8"),
	);
	expect(ledger.links).toHaveLength(10);
	await expect(lstat(join(home, ".codex"))).rejects.toThrow();
	const changed = join(home, ".agents/skills/mob-status");
	await unlink(changed);
	await writeFile(changed, "user replacement");
	await setup(["--host", "codex", "--uninstall", "-q"], options);
	expect(builds).toBe(2);
	expect(await readFile(changed, "utf8")).toBe("user replacement");
	await expect(lstat(join(home, ".agents/skills/mstack"))).rejects.toThrow();
	await expect(lstat(join(home, ".agents/skills/mob"))).rejects.toThrow();
	await setup(["--host", "codex", "--uninstall", "-q"], options);
}, 15_000);

test("uninstall preserves nonempty and pre-existing directories", async () => {
	for (const existing of [false, true]) {
		const home = await mkdtemp(join(temporary, "directories-"));
		const runtime = join(home, ".claude/skills/mstack");
		if (existing) await mkdir(runtime, { recursive: true });
		const options = {
			root,
			home,
			build: async () => {},
			showHome: async () => {},
			out: () => {},
		};
		await setup(["--host", "claude"], options);
		if (!existing) await writeFile(join(runtime, "user-file"), "keep");
		await setup(["--host", "claude", "--uninstall"], options);
		expect((await lstat(runtime)).isDirectory()).toBe(true);
	}
}, 15_000);

test("Codex installs both roots when legacy skills exist and preserves replacements", async () => {
	const home = await mkdtemp(join(temporary, "codex-dual-"));
	await mkdir(join(home, ".codex/skills"), { recursive: true });
	const options = { root, home, build: async () => {}, out: () => {} };
	await setup(["--host", "codex", "-q"], options);
	await setup(["--host", "codex", "-q"], options);
	for (const directory of [".agents", ".codex"]) {
		expect(await readlink(join(home, directory, "skills/mob"))).toBe(
			join(root, "skills-codex/mob"),
		);
		expect(await readlink(join(home, directory, "skills/mstack/bin"))).toBe(
			join(root, "bin"),
		);
	}
	const ledger = JSON.parse(
		await readFile(join(home, ".mob/mstack-install-codex.json"), "utf8"),
	);
	expect(ledger.links).toHaveLength(20);
	const replacement = join(home, ".codex/skills/mob-status");
	await unlink(replacement);
	await writeFile(replacement, "user-owned");
	await setup(["--host", "codex", "--uninstall", "-q"], options);
	for (const directory of [".agents", ".codex"])
		await expect(
			lstat(join(home, directory, "skills/mob")),
		).rejects.toMatchObject({ code: "ENOENT" });
	expect(await readFile(replacement, "utf8")).toBe("user-owned");
});

test.each([false, true])(
	"old Codex ledgers can uninstall or migrate (reinstall=%s)",
	async (reinstall) => {
		const home = await mkdtemp(join(temporary, "codex-migration-"));
		await mkdir(join(home, ".codex/skills"), { recursive: true });
		await mkdir(join(home, ".mob"));
		const path = join(home, ".codex/skills/mob");
		const target = join(root, "skills-codex/mob");
		await symlink(target, path);
		await writeFile(
			join(home, ".mob/mstack-install-codex.json"),
			JSON.stringify({ root, links: [{ path, target }] }),
		);
		const options = { root, home, build: async () => {}, out: () => {} };
		if (reinstall) await setup(["--host", "codex", "-q"], options);
		await setup(["--host", "codex", "--uninstall", "-q"], options);
		await expect(lstat(path)).rejects.toMatchObject({ code: "ENOENT" });
		await expect(lstat(join(home, ".agents/skills/mob"))).rejects.toMatchObject(
			{ code: "ENOENT" },
		);
		expect((await lstat(join(home, ".codex/skills"))).isDirectory()).toBe(true);
	},
);

test("Codex legacy conflicts fail before creating primary links or building", async () => {
	const home = await mkdtemp(join(temporary, "codex-conflict-"));
	await mkdir(join(home, ".codex/skills"), { recursive: true });
	await writeFile(join(home, ".codex/skills/mob"), "keep");
	await expect(
		setup(["--host", "codex", "-q"], {
			root,
			home,
			build: async () => {
				throw new Error("Build must not run");
			},
		}),
	).rejects.toThrow("Refusing to replace");
	await expect(lstat(join(home, ".agents"))).rejects.toMatchObject({
		code: "ENOENT",
	});
});

test("auto detects a modern Codex skills directory without .codex", async () => {
	const home = await mkdtemp(join(temporary, "codex-modern-"));
	await mkdir(join(home, ".agents/skills"), { recursive: true });
	const options = { root, home, build: async () => {}, out: () => {} };
	await setup(["-q"], options);
	expect(await readlink(join(home, ".agents/skills/mob"))).toBe(
		join(root, "skills-codex/mob"),
	);
	await setup(["--uninstall", "-q"], options);
});

test("preamble prefers the documented Codex binary over the legacy one", async () => {
	const { home, bin, path } = await preambleHome();
	await copyFile(join(bin, "mob"), join(home, ".agents/skills/mstack/bin/mob"));
	await script(join(home, ".codex/skills/mstack/bin/mob"), "exit 99");
	await unlink(join(bin, "mob"));
	const result = await command(
		["bash", "-c", preamble(skills.get("skills-codex/mob/SKILL.md") as string)],
		home,
		path,
	);
	expect(result.code).toBe(0);
	expect(result.out).toContain(
		`MOB_BIN: ${home}/.agents/skills/mstack/bin/mob`,
	);
	expect(result.out).toContain(`MOB_VERSION: ${pkg.version}`);
}, 15_000);

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
	expect(result.out).toContain("API_REACHABLE: unreachable");
	expect(result.out).toContain("OWNER: fail");
	expect(result.out).toContain("POLICY: fail");
	expect(result.out).toContain("SIGNER: fail");
}, 15_000);

test("setup preserves pre-existing matching links and rejects conflicts before build", async () => {
	const home = await mkdtemp(join(temporary, "existing-"));
	const dir = join(home, ".claude/skills");
	await mkdir(dir, { recursive: true });
	await symlink(join(root, "skills/mob"), join(dir, "mob"));
	const options = {
		root,
		home,
		build: async () => {},
		showHome: async () => {},
		out: () => {},
	};
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
}, 15_000);

test("auto setup selects detected hosts and prints each host integration paragraph", async () => {
	const home = await mkdtemp(join(temporary, "auto-"));
	const lines: string[] = [];
	const options = {
		root,
		home,
		build: async () => {},
		showHome: async () => {},
		out: (s: string) => lines.push(s),
	};
	await expect(setup([], options)).rejects.toThrow("No host detected");
	await mkdir(join(home, ".claude"));
	await mkdir(join(home, ".codex"));
	await setup([], options);
	expect(lines.join("\n")).toContain("Optional AGENTS.md integration:");
	expect(lines.join("\n")).toContain("Use $mob for funding");
	expect(lines.join("\n")).toContain("Use /mob for funding");
	await expect(setup(["--host", "unknown"], options)).rejects.toThrow(
		"host must be",
	);
}, 15_000);

test("POSIX shim builds only when missing and keeps build output off stdout", async () => {
	const home = await mkdtemp(join(temporary, "shim-"));
	await mkdir(join(home, "bin"));
	await mkdir(join(home, ".claude-plugin"));
	await mkdir(join(home, "apps/cli/src"), { recursive: true });
	await copyFile(
		join(root, ".claude-plugin/plugin.json"),
		join(home, ".claude-plugin/plugin.json"),
	);
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
	expect(first.err).toContain("mob: building checkout binary with Bun");
	expect(await command(args, home, "/usr/bin:/bin")).toEqual({
		code: 0,
		out: first.out,
		err: "",
	});
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
}, 15_000);

test.each(["skills", "skills-codex"])(
	"%s onboarding skills explain public input and ask separately for each signature",
	(host) => {
		const setup = outputs.get(`${host}/mob-setup/SKILL.md`) as string;
		const bind = outputs.get(`${host}/mob-bind/SKILL.md`) as string;
		for (const flag of [
			"--owner",
			"--signer",
			"--policy",
			"--auth-base",
			"--legal-chain-id",
			"--walletconnect-project-id",
			"--no-legal",
		])
			expect(setup).toContain(flag);
		expect(setup).toContain("Do not pipe answers on stdin");
		expect(setup.split("# Set up the wallet")[1]).not.toContain("printf");
		expect(setup).toContain("Never run keystore commands");
		expect(setup).toContain("503");
		expect(setup).toContain("409");
		expect(setup).toContain("The old authorization never carries over");
		expect(setup).toContain("reject embedded line breaks");
		expect(bind).toContain("can withdraw to your own address, not trade-only");
		expect(
			bind.indexOf("can withdraw to your own address, not trade-only"),
		).toBeLessThan(bind.indexOf("Run `mob bind <venue>` once"));
		expect(bind).toContain("connection-only page");
		expect(bind).toContain("one signature question per Proposal");
		expect(bind).toContain("Never retry a refused integrator approval");
		for (const body of [setup, bind]) {
			const rule = body.split("## Explicit authorization rule")[1];
			expect(rule).toContain("STOP and ask");
			if (host === "skills")
				expect(rule.match(/Use AskUserQuestion/g)).toHaveLength(1);
			else expect(rule).not.toContain("AskUserQuestion");
		}
	},
);

test("router splash is ASCII, delimited and limited to once per hour for both hosts", async () => {
	const { home, path } = await preambleHome();
	const claude = preamble(outputs.get("skills/mob/SKILL.md") as string);
	const codex = preamble(outputs.get("skills-codex/mob/SKILL.md") as string);
	const first = await command(["/bin/bash", "-c", claude], home, path);
	const block = /<<<MOB\n([\s\S]*?)\nMOB>>>/.exec(first.out);
	expect(block).not.toBeNull();
	expect(block?.[1]).toMatch(/^[ -~\n]+$/);
	expect(block?.[1]).toContain("##");
	const stamp = join(home, ".mob/hello-stamp");
	expect(Number(await readFile(stamp, "utf8"))).toBeGreaterThan(0);
	expect(
		(await command(["/bin/bash", "-c", codex], home, path)).out,
	).not.toContain("<<<MOB");
	await writeFile(stamp, `${Math.floor(Date.now() / 1000) - 3601}\n`);
	const concurrent = await Promise.all([
		command(["/bin/bash", "-c", claude], home, path),
		command(["/bin/bash", "-c", codex], home, path),
	]);
	expect(concurrent.filter((r) => r.out.includes("<<<MOB"))).toHaveLength(1);
	for (const [file, body] of skills) {
		if (file.endsWith("/mob/SKILL.md"))
			expect(body).toContain(
				"reproduce it exactly, inside one fenced code block, before anything else.",
			);
		else expect(body).not.toContain("hello --compact --ascii");
	}
}, 15_000);

test("plugin does not use SessionStart for a user-visible install notice", async () => {
	const { hooks } = JSON.parse(
		await readFile(join(root, "hooks/hooks.json"), "utf8"),
	);
	expect(hooks.SessionStart).toBeUndefined();
	expect(hooks.PreToolUse).toHaveLength(1);
});

test("setup runs the fresh binary home after building, then prints three commands", async () => {
	const home = await mkdtemp(join(temporary, "ending-"));
	const events: string[] = [];
	const options = {
		root,
		home,
		build: async () => {
			events.push("build");
		},
		out: (line: string) => events.push(line),
		showHome: async (binary: string, targetHome: string) => {
			expect(binary).toBe(join(root, "apps/cli/dist/mob"));
			expect(targetHome).toBe(home);
			events.push("home screen");
		},
	};
	await setup(["--host", "codex"], options);
	expect(events[0]).toBe("build");
	expect(events.at(-2)).toBe("home screen");
	expect(events.at(-1)).toBe(
		"Next commands:\n  mob setup\n  mob scan --size 1000\n  mob doctor",
	);
	events.length = 0;
	await setup(["--host", "codex", "--uninstall"], options);
	expect(events).not.toContain("home screen");
	events.length = 0;
	await setup(["--host", "codex", "-q"], options);
	expect(events).toEqual(["build"]);
}, 15_000);

test("setup's default home runner invokes the newly built file with the target HOME", async () => {
	const home = await mkdtemp(join(temporary, "real-ending-home-"));
	const checkout = await mkdtemp(join(temporary, "real-ending-checkout-"));
	await symlink(join(root, "skills-codex"), join(checkout, "skills-codex"));
	await symlink(join(root, "bin"), join(checkout, "bin"));
	const lines: string[] = [];
	await setup(["--host", "codex"], {
		root: checkout,
		home,
		out: (s) => lines.push(s),
		build: async () => {
			await script(
				join(checkout, "apps/cli/dist/mob"),
				'printf "%s\\n" "$1" "$MOB_HOME" > "$HOME/home-invocation"',
			);
		},
	});
	expect(await readFile(join(home, "home-invocation"), "utf8")).toBe(
		`hello\n${join(home, ".mob")}\n`,
	);
	expect(lines.at(-1)).toContain("Next commands:");
}, 15_000);

test("slow reachability is advisory and measured within a fifteen-second budget", async () => {
	const { home, path } = await preambleHome();
	const result = await command(
		[
			"/bin/bash",
			"-c",
			preamble(outputs.get("skills/mob-scan/SKILL.md") as string),
		],
		home,
		path,
		{ TEST_HTTP_SECONDS: "6.1" },
	);
	expect(result.code).toBe(0);
	expect(result.out).toContain("API_REACHABLE: slow · 6.1 s");
	expect(result.out).toContain("API slow; venue reads are unaffected");
	expect(result.out).toContain("SIGNER: unset");
}, 15_000);

test("scan, status and manage ship matching glossary references for both hosts", async () => {
	let reference: string | undefined;
	for (const host of ["skills", "skills-codex"])
		for (const name of ["mob-scan", "mob-status", "mob-manage"]) {
			expect(outputs.get(`${host}/${name}/SKILL.md`)).toContain(
				"Read [references/glossary.md](references/glossary.md)",
			);
			const text = await readFile(
				join(root, host, name, "references/glossary.md"),
				"utf8",
			);
			if (reference) expect(text).toBe(reference);
			reference = text;
			for (const word of [
				"Lighter on Robinhood Chain",
				"Lighter mainnet",
				"qualifies",
				"executable",
				"simple",
				"cost",
				"source tree",
				"API reachability is advisory",
			])
				expect(text).toContain(word);
		}
});
