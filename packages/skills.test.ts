import { afterAll, beforeAll, expect, test } from "bun:test";
import {
	chmod,
	copyFile,
	cp,
	lstat,
	mkdir,
	mkdtemp,
	readFile,
	readlink,
	realpath,
	rm,
	symlink,
	unlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setConfig } from "../apps/cli/src/config.ts";
import pkg from "../package.json";
import { renderSkills } from "../scripts/gen-skill-docs.ts";
import { setup } from "../scripts/setup.ts";

const root = resolve(import.meta.dir, "..");
// Resolve before subprocesses change cwd to a disposable HOME. Never fall back
// to source mode if an explicitly selected binary is missing or fails to start.
const testBinary = process.env.MSTACK_TEST_MOB_BIN
	? resolve(root, process.env.MSTACK_TEST_MOB_BIN)
	: undefined;
const proxySink = "http://127.0.0.1:9";
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
	extra: Record<string, string | undefined> = {},
) {
	const proc = Bun.spawn(args, {
		cwd: home,
		env: {
			...process.env,
			HOME: home,
			MOB_HOME: join(home, ".mob"),
			CLAUDE_PLUGIN_ROOT: undefined,
			CLAUDE_SKILL_DIR: undefined,
			CLAUDE_PROJECT_DIR: undefined,
			CLAUDE_PLUGIN_DATA: undefined,
			MSTACK_MOB_BIN: "",
			MSTACK_ROOT: "",
			MSTACK_VERBOSE: "",
			PATH: path ?? process.env.PATH,
			...extra,
			// Compiled Bun cannot use the source preload. Block HTTP(S) in both
			// modes, including router hello reads; inherited NO_PROXY must not win.
			http_proxy: proxySink,
			https_proxy: proxySink,
			HTTP_PROXY: proxySink,
			HTTPS_PROXY: proxySink,
			all_proxy: proxySink,
			ALL_PROXY: proxySink,
			no_proxy: "",
			NO_PROXY: "",
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
		join(home, "plugin"),
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
	for (const [file, body] of outputs) {
		if (!file.startsWith("skills/")) continue;
		const target = join(home, "plugin", file);
		await mkdir(dirname(target), { recursive: true });
		await writeFile(target, body);
	}
	await script(
		join(bin, "mob"),
		testBinary
			? `exec ${quote(testBinary)} "$@"`
			: `exec ${quote(process.execPath)} --preload ${quote(join(root, "packages/funding/test/no-network.ts"))} ${quote(join(root, "apps/cli/src/main.ts"))} "$@"`,
	);
	// A recorded HTTP 200 status; never request the real API during tests.
	await script(
		join(bin, "curl"),
		// biome-ignore lint/suspicious/noTemplateCurlyInString: This is shell parameter expansion in the fixture.
		'printf "%s\\n" "$*" >> "$HOME/curl-calls"\nprintf "%s\\n" "$http_proxy" "$https_proxy" "$HTTP_PROXY" "$HTTPS_PROXY" "$all_proxy" "$ALL_PROXY" "$no_proxy" "$NO_PROXY" > "$HOME/proxy-env"\nprintf "%s" "${TEST_HTTP_STATUS:-200} ${TEST_HTTP_SECONDS:-0.312}"',
	);
	await script(join(bin, "git"), "exit 1");
	return { home, bin, path: `${bin}:/usr/bin:/bin` };
}

beforeAll(async () => {
	const { home, path } = await preambleHome();
	// Warm the source transpiler once, or verify the selected compiled binary.
	expect(await command(["mob", "--version"], home, path)).toEqual({
		code: 0,
		out: `${pkg.version}\n`,
		err: "",
	});
}, 60_000); // One CLI spawn; cold source startup shares the loaded CI runner.

function preamble(body: string, home: string, skillDirectory?: string): string {
	const match = /^---\n[\s\S]*?\n---\n\n```bash\n([\s\S]*?)\n```/.exec(body);
	if (!match) throw new Error("Expected first content to be one bash preamble");
	const name = /^name: (.+)$/m.exec(body)?.[1];
	if (!name) throw new Error("Missing skill name");
	return match[1].replaceAll(
		`\${CLAUDE_SKILL_DIR}`,
		skillDirectory ?? join(home, "plugin/skills", name),
	);
}

test("generator is deterministic and committed output matches both host overlays", async () => {
	expect(await renderSkills()).toEqual(outputs);
	expect(skills.size).toBe(20);
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

test("each Claude skill has a generated executable wrapper and exact host substitutions (G1)", async () => {
	for (const [file, body] of skills) {
		if (!file.startsWith("skills/")) {
			expect(body).toContain("bash ~/.agents/skills/mstack/bin/mob-preamble");
			continue;
		}
		expect(body).not.toContain(":-");
		expect(body).toContain(`bash "\${CLAUDE_SKILL_DIR}/scripts/preamble.sh"`);
		expect(body).toContain(`Bash(\${CLAUDE_SKILL_DIR}/scripts/preamble.sh *)`);
		const wrapper = join(dirname(file), "scripts/preamble.sh");
		expect(await readFile(join(root, wrapper), "utf8")).toBe(
			outputs.get(wrapper) as string,
		);
		expect((await lstat(join(root, wrapper))).mode & 0o111).toBe(0o111);
	}
});

test.each(["plugin root", "personal symlink", "copied plugin cache"])(
	"Claude preamble resolves from %s outside the checkout, without exported host variables (G1)",
	async (layout) => {
		const { home, bin, path } = await preambleHome();
		const binary = join(home, "test-mob");
		await copyFile(join(bin, "mob"), binary);
		await unlink(join(bin, "mob"));
		let plugin = root;
		if (layout === "copied plugin cache") {
			plugin = join(home, "plugin cache/mstack/0.4.0");
			for (const directory of ["bin", "skills"])
				await cp(join(root, directory), join(plugin, directory), {
					recursive: true,
				});
			await mkdir(join(plugin, "scripts"));
			for (const name of ["skill-preamble.sh", "skill-splash.sh"])
				await copyFile(
					join(root, "scripts", name),
					join(plugin, "scripts", name),
				);
		}
		if (layout === "personal symlink") {
			await rm(join(home, ".claude"), { recursive: true, force: true });
			// Run the real setup entry point. Keep install/build offline and out of this test.
			await script(
				join(bin, "bun"),
				`case "$1 $2" in
  'install --frozen-lockfile'|'run build') exit 0 ;;
  *) exec ${quote(process.execPath)} "$@" ;;
esac`,
			);
			const installed = await command(
				[join(root, "setup"), "--host", "claude", "-q"],
				home,
				path,
			);
			expect(installed).toEqual({ code: 0, out: "", err: "" });
			expect(await readlink(join(home, ".claude/skills/mob"))).toBe(
				join(root, "skills/mob"),
			);
		}
		for (const name of ["mob", "mob-scan"]) {
			const directory =
				layout === "personal symlink"
					? join(home, ".claude/skills", name)
					: join(plugin, "skills", name);
			const body = await readFile(join(directory, "SKILL.md"), "utf8");
			const result = await command(
				["bash", "-c", preamble(body, home, directory)],
				home,
				path,
				{ MSTACK_MOB_BIN: binary, CDPATH: join(home, "unrelated") },
			);
			expect(result.code).toBe(0);
			expect(result.err).toBe("");
			expect(result.out).toContain(
				`MOB_BIN: ${await realpath(plugin)}/bin/mob`,
			);
			expect(result.out).toContain(`MOB_VERSION: ${pkg.version}`);
			expect(result.out).toContain("API_REACHABLE: ok");
			expect(result.out.includes("<mob-home>")).toBe(name === "mob");
		}
	},
	60_000, // Two preambles (11 CLI spawns); symlink setup adds two build stubs.
);

test.each([...skills.keys()])(
	"%s has valid bash and prints expected preamble keys",
	async (file) => {
		const { home, path } = await preambleHome();
		const body = preamble(outputs.get(file) as string, home);
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
		expect(await readFile(join(home, "proxy-env"), "utf8")).toBe(
			`${Array(6).fill(proxySink).join("\n")}\n\n\n`,
		);
	},
	60_000, // One syntax-check shell and one preamble (five or six CLI spawns).
);

test("preamble fixtures block CLI network reads even without the source preload", async () => {
	const { home, path } = await preambleHome();
	let requests = 0;
	const origin = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch: () => {
			requests++;
			return Response.json({ error: "Fixture proxy was bypassed" });
		},
	});
	try {
		// api_base needs the human's terminal through the CLI; write it directly.
		await setConfig("api_base", origin.url.href, join(home, ".mob"));
		const hello = await command(["mob", "hello", "--json"], home, path);
		expect(hello.code).toBe(0);
		expect(JSON.parse(hello.out).api.state).toBe("unreachable");
		const result = await command(
			[
				"bash",
				"-c",
				preamble(outputs.get("skills/mob-scan/SKILL.md") as string, home),
			],
			home,
			path,
		);
		expect(result.code).toBe(0);
		// Only the recorded curl succeeds. A real CLI request would hit the trap.
		expect(result.out).toContain("API_REACHABLE: ok");
		expect(
			(await readFile(join(home, "curl-calls"), "utf8")).trim().split("\n"),
		).toHaveLength(1);
		expect(requests).toBe(0);
	} finally {
		await origin.stop(true);
	}
}, 60_000); // Two direct CLI spawns and one preamble (five CLI spawns).

test("preamble shows owner presence and HTTP failure, without printing the address", async () => {
	const { home, path } = await preambleHome();
	const address = "0x0000000000000000000000000000000000000001";
	expect(
		(await command(["mob", "config", "set", "owner", address], home, path))
			.code,
	).toBe(0);
	const result = await command(
		[
			"/bin/bash",
			"-c",
			preamble(outputs.get("skills/mob/SKILL.md") as string, home),
		],
		home,
		path,
		{ TEST_HTTP_STATUS: "503" },
	);
	expect(result.code).toBe(0);
	expect(result.out).toContain("OWNER: set");
	expect(result.out).toContain("API_REACHABLE: unreachable");
	expect(result.out).not.toContain(address);
}, 60_000); // One config CLI and one router preamble (six CLI spawns).

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
						preamble(outputs.get("skills/mob/SKILL.md") as string, home),
					],
					home,
					path,
				)
			).out,
		).toContain(`MOB_VERSION: ${pkg.version}`);
	},
	60_000, // One router preamble (six CLI spawns) per install layout.
);

test("missing binary stops with an install line before any API call", async () => {
	const { home, bin, path } = await preambleHome();
	await unlink(join(bin, "mob"));
	const result = await command(
		[
			"/bin/bash",
			"-c",
			preamble(outputs.get("skills/mob/SKILL.md") as string, home),
		],
		home,
		path,
	);
	expect(result.code).toBe(1);
	expect(result.out).toContain("MOB_MISSING\nInstall:");
	expect(result.out).not.toContain("API_BASE");
}, 60_000); // One preamble shell; missing mob prevents all CLI spawns.

test("skill wrapper puts the shipped shim on PATH without exported Claude variables", async () => {
	const { home, bin } = await preambleHome();
	const plugin = join(home, "plugin");
	await copyFile(join(bin, "mob"), join(plugin, "bin/mob"));
	// Keep curl and git mocked even though the plugin shim is appended to PATH.
	const mocks = join(home, "probe-bin");
	await mkdir(mocks);
	for (const name of ["curl", "git"])
		await symlink(join(bin, name), join(mocks, name));
	const result = await command(
		[
			"/bin/bash",
			"-c",
			preamble(outputs.get("skills/mob/SKILL.md") as string, home),
		],
		home,
		`${mocks}:/usr/bin:/bin`,
		{ CLAUDE_PLUGIN_ROOT: undefined },
	);
	expect(result.code).toBe(0);
	expect(result.out).toContain(`MOB_VERSION: ${pkg.version}`);
	expect(result.out).toContain(`MOB_BIN: ${await realpath(plugin)}/bin/mob`);
	expect(
		(await readFile(join(home, "curl-calls"), "utf8")).trim().split("\n"),
	).toHaveLength(1);
}, 60_000); // One router preamble (six CLI spawns) through the shipped shim.

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
	const code = preamble(outputs.get("skills/mob/SKILL.md") as string, home);
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
}, 60_000); // Four preambles (21 CLI spawns, including one uncached hello).

test("open skills stop on missing readiness before asking about risk (E3)", () => {
	for (const host of ["skills", "skills-codex"]) {
		const body = outputs.get(`${host}/mob-open/SKILL.md`) as string;
		expect(body.indexOf("mob status --readiness --json")).toBeLessThan(
			body.indexOf("ask three risk questions"),
		);
		expect(body).toContain("mob hello --json");
		expect(body).toContain("legal.value.accepted");
		expect(body).toContain("unsigned, expired, missing, or cannot be checked");
		expect(body).toContain(
			"Do not ask the risk questions while readiness is missing",
		);
	}
});

test("every generated skill plus its fresh-home preamble stays below 8 KiB (D2)", async () => {
	const costs = new Map<boolean, number>();
	for (const router of [false, true]) {
		const { home, path } = await preambleHome();
		const body = outputs.get(
			`skills/${router ? "mob" : "mob-scan"}/SKILL.md`,
		) as string;
		const result = await command(
			["/bin/bash", "-c", preamble(body, home)],
			home,
			path,
		);
		expect(result.code).toBe(0);
		costs.set(
			router,
			Buffer.byteLength(result.out) + Buffer.byteLength(result.err),
		);
	}
	for (const [file, body] of skills)
		expect(
			Buffer.byteLength(body) +
				(costs.get(file.endsWith("/mob/SKILL.md")) as number),
		).toBeLessThanOrEqual(8192);
}, 60_000); // Two fresh-home preambles (11 CLI spawns).

test("credential-free public clone prints a successful update check without git diagnostics (D3)", async () => {
	const { home, bin, path } = await preambleHome();
	await unlink(join(bin, "git"));
	const checkout = join(home, "checkout"),
		origin = join(home, "public-origin.git");
	const git = async (args: string[]) => {
		const result = await command(
			[
				"/usr/bin/git",
				"-c",
				"credential.helper=",
				"-c",
				"user.name=W17 fixture",
				"-c",
				"user.email=w17@example.invalid",
				...args,
			],
			home,
			path,
			{ GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_NOSYSTEM: "1" },
		);
		expect(result.code).toBe(0);
	};
	await git(["init", "--bare", "--initial-branch=main", origin]);
	await git(["clone", origin, checkout]);
	await mkdir(join(checkout, "bin"));
	await copyFile(join(bin, "mob"), join(checkout, "bin/mob"));
	await git(["-C", checkout, "add", "bin/mob"]);
	await git(["-C", checkout, "commit", "-m", "fixture"]);
	// Populate the local anonymous remote without any push command.
	await git(["--git-dir", origin, "fetch", checkout, "main:main"]);
	const result = await command(
		["/bin/bash", join(root, "scripts/skill-preamble.sh")],
		home,
		`${checkout}/bin:${path}`,
		{ GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_NOSYSTEM: "1" },
	);
	expect(result.code).toBe(0);
	expect(result.out).toContain("UPGRADE_CHECK: ok");
	expect(result.out).not.toContain("UPGRADE_CHECK: fail");
	expect(result.err).toBe("");
	expect(result.out).not.toMatch(/fatal:|Username|Password|credential-helper/);
}, 60_000); // Five local git commands and one preamble (five CLI spawns).

test("session skills keep keys off argv and require exact ids for manual mutations", () => {
	for (const host of ["skills", "skills-codex"]) {
		const invocation = host === "skills-codex" ? "$" : "/";
		const setup = outputs.get(`${host}/mob-setup/SKILL.md`) as string;
		const keys = outputs.get(`${host}/mob-keys/SKILL.md`) as string;
		for (const body of [setup, keys]) {
			expect(body).toContain(
				`printf '%s' 'mobius_…' | mob keys import --stdin --name '<name>' --venues '<a,b>' --max-size '<usd>'`,
			);
			expect(body.toLowerCase()).toContain("never echo");
			expect(body).toContain("shell builtin");
			expect(body).toContain("carries it on its own command line");
			expect(body).toContain("could not verify; not stored");
			expect(body.toLowerCase()).toContain(
				"use `--unverified` only when the user explicitly asks for it",
			);
			expect(body).not.toContain('"$KEY"');
			expect(body).not.toMatch(/mob keys import mobius_/);
		}
		for (const name of ["mob-open", "mob-manage", "mob-close"]) {
			const body = outputs.get(`${host}/${name}/SKILL.md`) as string;
			expect(body).toContain("`mob submit p-N`");
			expect(body).toContain("latest user message says `submit p-N`");
			expect(body).toContain("latest user message says `sign p-N`");
			expect(body).toContain("auto policy allowed");
			expect(body).toContain("submitted, not confirmed");
		}
		const bind = outputs.get(`${host}/mob-bind/SKILL.md`) as string;
		expect(bind).toContain("mob bind --all");
		expect(bind).toContain("mob onboard --native");
		expect(bind).toContain("latest message says `sign c-N`");
		const router = outputs.get(`${host}/mob/SKILL.md`) as string;
		for (const name of [
			"mob-open",
			"mob-manage",
			"mob-close",
			"mob-setup",
			"mob-bind",
			"mob-keys",
		])
			expect(router).toContain(`${invocation}${name}`);
	}
	// Only /mob-setup names keystore or config commands, and only for the human
	// to run in a separate terminal; the hook denies them to the agent.
	for (const [path, body] of skills) {
		const named = [
			...body.matchAll(/\bmob\s+(?:keystore|config set)\b[^`]*/g),
		].map((match) => match[0]);
		if (!path.endsWith("/mob-setup/SKILL.md")) {
			expect(named).toEqual([]);
			continue;
		}
		expect(new Set(named)).toEqual(
			new Set([
				"mob config set walletconnect_project_id <id>",
				"mob keystore import",
				"mob keystore create",
			]),
		);
		expect(body).toContain("in a separate terminal window, never in this chat");
		expect(body).toContain(
			"Never ask for or accept a private key, seed phrase, or passphrase in the chat.",
		);
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
		// policy needs the human's terminal through the CLI; write it directly.
		await setConfig("policy", "locked", join(home, ".mob"));
		const result = await command(
			[
				"/bin/bash",
				"-c",
				preamble(outputs.get("skills/mob/SKILL.md") as string, home),
			],
			home,
			path,
		);
		expect(result.out).toContain("POLICY: locked");
		expect(result.out).toContain(`SIGNER: ${signer}`);
	},
	60_000, // Two config CLI spawns and one router preamble (six CLI spawns).
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
		"mob-keys",
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
	expect(ledger.links).toHaveLength(11);
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
});

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
});

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
	expect(ledger.links).toHaveLength(22);
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
		[
			"bash",
			"-c",
			preamble(skills.get("skills-codex/mob/SKILL.md") as string, home),
		],
		home,
		path,
	);
	expect(result.code).toBe(0);
	expect(result.out).toContain(
		`MOB_BIN: ${await realpath(home)}/.agents/skills/mstack/bin/mob`,
	);
	expect(result.out).toContain(`MOB_VERSION: ${pkg.version}`);
}, 60_000); // One router preamble (six CLI spawns) through the preferred install.

test("preamble config errors are explicit reports and do not block a local skill", async () => {
	const { home, path } = await preambleHome();
	await mkdir(join(home, ".mob"));
	await writeFile(join(home, ".mob/config.json"), "invalid json");
	const result = await command(
		[
			"/bin/bash",
			"-c",
			preamble(outputs.get("skills/mob/SKILL.md") as string, home),
		],
		home,
		path,
	);
	expect(result.code).toBe(0);
	expect(result.out).toContain("API_BASE: fail");
	expect(result.out).toContain("API_REACHABLE: unreachable");
	expect(result.out).toContain("OWNER: fail");
	expect(result.out).toContain("POLICY: fail");
	expect(result.out).toContain("SIGNER: fail");
}, 60_000); // One router preamble (six CLI spawns) reading malformed config.

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
});

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
});

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
}, 60_000); // Five shell spawns; the first shim also launches two build stubs.

test.each(["skills", "skills-codex"])(
	"%s onboarding skills cover page, paste, repair and native paths",
	(host) => {
		const setup = outputs.get(`${host}/mob-setup/SKILL.md`) as string;
		const bind = outputs.get(`${host}/mob-bind/SKILL.md`) as string;
		expect(setup).toContain("mob onboard");
		expect(setup).toContain("modest USD cap");
		expect(setup).toContain("chat transcript and agent session logs");
		expect(setup).toContain("Ready · …");
		expect(bind).toContain("ceremony `c-N`");
		expect(bind).toContain("mob sign c-N --with keystore");
		expect(bind).toContain("partial or refused ceremony stays partial");
	},
);

test("shared splash greets once per owner or home while the router always greets", async () => {
	const { home, path } = await preambleHome();
	const claudeSkill = preamble(
		outputs.get("skills/mob-scan/SKILL.md") as string,
		home,
	);
	const codexSkill = preamble(
		outputs.get("skills-codex/mob-status/SKILL.md") as string,
		home,
	);
	const claudeRouter = preamble(
		outputs.get("skills/mob/SKILL.md") as string,
		home,
	);
	const codexRouter = preamble(
		outputs.get("skills-codex/mob/SKILL.md") as string,
		home,
	);
	const first = await command(["/bin/bash", "-c", claudeSkill], home, path);
	const block = /<mob-home>\n([\s\S]*?)\n<\/mob-home>/.exec(first.out);
	expect(block).not.toBeNull();
	expect(block?.[1]).toMatch(/^[ -~\n]+$/);
	expect(block?.[1]).toContain("##");
	const stamp = join(home, ".mob/hello-home-stamp");
	expect(Number(await readFile(stamp, "utf8"))).toBeGreaterThan(0);
	expect(
		(await command(["/bin/bash", "-c", codexSkill], home, path)).out,
	).not.toContain("<mob-home>");
	for (const router of [claudeRouter, codexRouter])
		expect(
			(await command(["/bin/bash", "-c", router], home, path)).out,
		).toContain("<mob-home>");
	await writeFile(stamp, `${Math.floor(Date.now() / 1000) - 3601}\n`);
	const concurrent = await Promise.all([
		command(["/bin/bash", "-c", claudeSkill], home, path),
		command(["/bin/bash", "-c", codexSkill], home, path),
	]);
	expect(concurrent.filter((r) => r.out.includes("<mob-home>"))).toHaveLength(
		1,
	);
	const owner = "0x0000000000000000000000000000000000000001";
	expect(
		(await command(["mob", "config", "set", "owner", owner], home, path)).code,
	).toBe(0);
	expect(
		(await command(["/bin/bash", "-c", codexSkill], home, path)).out,
	).toContain("<mob-home>");
	expect([
		...new Bun.Glob("hello-owner-*-stamp").scanSync(join(home, ".mob")),
	]).toHaveLength(1);
	const greeting =
		"If the preamble output contains a block between the lines `<mob-home>` and `</mob-home>`, reproduce every line between those two tags verbatim in a fenced code block at the top of your reply, and leave the two tag lines out; never strip, trim or summarize the block.";
	for (const [file, body] of skills) {
		expect(body).toContain(greeting);
		expect(body.indexOf(greeting)).toBeGreaterThan(body.indexOf("```bash"));
		expect(body).not.toContain("hello --compact --ascii");
		if (file.endsWith("/mob-setup/SKILL.md"))
			expect(body).toContain("home-screen block printed with Ready verbatim");
	}
}, 60_000);

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
});

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
}, 60_000); // One fake binary spawn through setup's default home runner.

test("slow reachability is advisory and measured within a fifteen-second budget", async () => {
	const { home, path } = await preambleHome();
	const result = await command(
		[
			"/bin/bash",
			"-c",
			preamble(outputs.get("skills/mob-scan/SKILL.md") as string, home),
		],
		home,
		path,
		{ TEST_HTTP_SECONDS: "6.1" },
	);
	expect(result.code).toBe(0);
	expect(result.out).toContain("API_REACHABLE: slow · 6.1 s");
	expect(result.out).toContain("API slow; venue reads are unaffected");
	expect(result.out).toContain("SIGNER: unset");
}, 60_000); // One scan preamble (five CLI spawns); curl latency is recorded.

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
