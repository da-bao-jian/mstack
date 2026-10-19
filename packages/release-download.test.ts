import { afterAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
	chmod,
	copyFile,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	readlink,
	realpath,
	rm,
	stat,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const temporary = await mkdtemp(join(tmpdir(), "mob-release-download-"));
const servers: ReturnType<typeof Bun.serve>[] = [];
afterAll(async () => {
	for (const server of servers) await server.stop(true);
	await rm(temporary, { recursive: true, force: true });
});
const fakeBinary = '#!/bin/sh\nprintf "fixture binary: %s\\n" "$*"\n';
const version = "1.2.3";
const asset = `mob-${process.platform}-${process.arch}`;

function fixture(mode = "ok", fixtureAsset = asset) {
	const calls: string[] = [];
	const digest = createHash("sha256").update(fakeBinary).digest("hex");
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch(request) {
			const path = new URL(request.url).pathname;
			calls.push(path);
			if (path === "/install.sh")
				return new Response(Bun.file(join(root, "install.sh")));
			if (path === "/releases/latest/download/VERSION")
				return Response.redirect(`/releases/download/v${version}/VERSION`);
			if (path === `/releases/download/v${version}/VERSION`)
				return new Response(
					mode === "bad-version" ? "../../escape" : `${version}\n`,
				);
			if (path === `/releases/download/v${version}/SHA256SUMS`) {
				if (mode === "missing-sums")
					return new Response("missing", { status: 404 });
				const hash = mode === "wrong" ? "0".repeat(64) : digest;
				const row = `${hash}  ${fixtureAsset}\n`;
				return new Response(mode === "duplicate" ? row + row : row);
			}
			if (path === `/releases/download/v${version}/${fixtureAsset}`)
				return new Response(fakeBinary);
			return new Response("fixture: unknown route", { status: 404 });
		},
	});
	servers.push(server);
	return { base: `${server.url.origin}/releases/download`, calls, server };
}

async function script(path: string, body: string) {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `#!/bin/sh\nset -eu\n${body}\n`, { mode: 0o755 });
}

async function home() {
	const path = await mkdtemp(join(temporary, "home with spaces-"));
	for (const file of ["bin/mob", "install.sh"]) {
		await mkdir(dirname(join(path, "plugin", file)), { recursive: true });
		await copyFile(join(root, file), join(path, "plugin", file));
	}
	await mkdir(join(path, "plugin/.claude-plugin"));
	await writeFile(
		join(path, "plugin/.claude-plugin/plugin.json"),
		`{\n  "version": "${version}"\n}\n`,
	);
	return path;
}

async function run(
	args: string[],
	taskHome: string,
	base: string,
	extra: Record<string, string> = {},
) {
	const child = Bun.spawn(args, {
		cwd: taskHome,
		env: {
			...process.env,
			HOME: taskHome,
			PATH: "/usr/bin:/bin",
			MSTACK_ROOT: "",
			MSTACK_MOB_BIN: "",
			MSTACK_VERBOSE: "",
			MSTACK_RELEASE_BASE_URL: base,
			...extra,
		},
		stdout: "pipe",
		stderr: "pipe",
	});
	const [code, out, err] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	return { code, out, err };
}

const shim = (taskHome: string) => [
	join(taskHome, "plugin/bin/mob"),
	"--json",
	"two words",
];
const installer = ["/bin/sh", join(root, "install.sh")];
const upgrade = [
	process.execPath,
	"-e",
	`import { upgrade } from ${JSON.stringify(join(root, "apps/cli/src/upgrade.ts"))}; console.log(await upgrade(null));`,
];

test("shim downloads the pinned binary once, verifies it, then uses cache with clean stdout", async () => {
	const taskHome = await home();
	const { base, calls } = fixture();
	const first = await run(shim(taskHome), taskHome, base);
	expect(first.code).toBe(0);
	expect(first.out).toBe("fixture binary: --json two words\n");
	expect(first.err).toContain("verified SHA-256");
	expect(calls).toEqual([
		`/releases/download/v${version}/${asset}`,
		`/releases/download/v${version}/SHA256SUMS`,
	]);
	expect((await stat(join(taskHome, ".mob/bin"))).mode & 0o777).toBe(0o700);
	expect(
		(await stat(join(taskHome, `.mob/bin/mob-${version}`))).mode & 0o777,
	).toBe(0o755);
	const second = await run(shim(taskHome), taskHome, base);
	expect(second.code).toBe(0);
	expect(second.out).toBe(first.out);
	expect(second.err).toBe("");
	expect(calls).toHaveLength(2);
});

test("MSTACK_MOB_BIN wins over checkout and cache; checkout wins over cache", async () => {
	const taskHome = await home();
	const { base, calls } = fixture();
	await script(join(taskHome, "override"), "printf 'override\\n'");
	await script(
		join(taskHome, "plugin/apps/cli/dist/mob"),
		"printf 'checkout\\n'",
	);
	await script(join(taskHome, `.mob/bin/mob-${version}`), "printf 'cache\\n'");
	const override = await run(shim(taskHome), taskHome, base, {
		MSTACK_MOB_BIN: join(taskHome, "override"),
	});
	expect(override).toEqual({ code: 0, out: "override\n", err: "" });
	expect(await run(shim(taskHome), taskHome, base)).toEqual({
		code: 0,
		out: "checkout\n",
		err: "",
	});
	const invalid = await run(shim(taskHome), taskHome, base, {
		MSTACK_MOB_BIN: join(taskHome, "absent"),
	});
	expect(invalid.code).toBe(1);
	expect(invalid.err).toContain("MSTACK_MOB_BIN is not executable");
	expect(calls).toEqual([]);
});

test.each([
	["MSTACK_MOB_BIN", "override"],
	["checkout binary", "plugin/apps/cli/dist/mob"],
	["cached binary", `.mob/bin/mob-${version}`],
])(
	"shim logs %s resolution only with MSTACK_VERBOSE=1",
	async (source, path) => {
		const taskHome = await home();
		const { base, calls } = fixture();
		const binary = join(taskHome, path);
		await script(binary, "printf 'selected\\n'");
		const loggedBinary =
			source === "checkout binary" ? await realpath(binary) : binary;
		const env: Record<string, string> =
			source === "MSTACK_MOB_BIN" ? { MSTACK_MOB_BIN: binary } : {};
		for (const value of ["0", "true", "1"]) {
			const result = await run(shim(taskHome), taskHome, base, {
				...env,
				MSTACK_VERBOSE: value,
			});
			expect(result.code).toBe(0);
			expect(result.out).toBe("selected\n");
			expect(result.err).toBe(
				value === "1" ? `mob: using ${source} ${loggedBinary}\n` : "",
			);
		}
		expect(calls).toEqual([]);
	},
);

test("cache wins over Bun; Bun without source downloads instead of building", async () => {
	const taskHome = await home();
	const { base, calls } = fixture();
	await script(join(taskHome, "tools/bun"), "exit 99");
	const env = { PATH: `${taskHome}/tools:/usr/bin:/bin` };
	expect((await run(shim(taskHome), taskHome, base, env)).code).toBe(0);
	await mkdir(join(taskHome, "plugin/apps/cli/src"), { recursive: true });
	expect(await run(shim(taskHome), taskHome, base, env)).toEqual({
		code: 0,
		out: "fixture binary: --json two words\n",
		err: "",
	});
	expect(calls).toHaveLength(2);
});

test.each(["wrong", "duplicate", "missing-sums"])(
	"shim refuses %s checksums and installs nothing",
	async (mode) => {
		const taskHome = await home();
		const { base } = fixture(mode);
		const result = await run(shim(taskHome), taskHome, base);
		expect(result.code).toBe(1);
		expect(result.out).toBe("");
		expect(result.err).toContain("Install options:");
		expect(await readdir(join(taskHome, ".mob/bin"))).toEqual([]);
	},
);

test("offline shim prints all three install options", async () => {
	const taskHome = await home();
	const { base, server } = fixture();
	await server.stop(true);
	const result = await run(shim(taskHome), taskHome, base);
	expect(result.code).toBe(1);
	expect(result.err).toContain("1. Install Bun");
	expect(result.err).toContain("2. Install the release binary");
	expect(result.err).toContain("3. Download mob");
	expect(await readdir(join(taskHome, ".mob/bin"))).toEqual([]);
});

test("curl-to-sh installer discovers latest, installs, links, and prints next steps", async () => {
	const taskHome = await home();
	const { base, calls } = fixture();
	const result = await run(
		[
			"/bin/sh",
			"-c",
			'curl -fsSL "$1" | sh',
			"fixture",
			`${new URL(base).origin}/install.sh`,
		],
		taskHome,
		base,
	);
	expect(result.code).toBe(0);
	expect(result.err).toContain("verified SHA-256");
	for (const expected of [
		"export PATH=",
		"home screen",
		"/plugin marketplace add da-bao-jian/mstack",
		"/plugin install mstack",
		"./setup",
	])
		expect(result.out).toContain(expected);
	expect(await readlink(join(taskHome, ".local/bin/mob"))).toBe(
		join(taskHome, `.mob/bin/mob-${version}`),
	);
	expect(
		(await run([join(taskHome, ".local/bin/mob"), "--version"], taskHome, base))
			.out,
	).toBe("fixture binary: --version\n");
	expect(calls.slice(0, 2)).toEqual([
		"/install.sh",
		"/releases/latest/download/VERSION",
	]);
	const repeated = await run(installer, taskHome, base, {
		PATH: `${taskHome}/.local/bin:/usr/bin:/bin`,
	});
	expect(repeated.code).toBe(0);
	expect(repeated.out).not.toContain("export PATH=");
});

test.each(["wrong", "bad-version"])(
	"installer refuses %s and leaves the old install intact",
	async (mode) => {
		const taskHome = await home();
		const { base } = fixture(mode);
		const old = join(taskHome, ".mob/bin/mob-1.0.0");
		await script(old, "printf 'old\\n'");
		await mkdir(join(taskHome, ".local/bin"), { recursive: true });
		await symlink(old, join(taskHome, ".local/bin/mob"));
		expect((await run(installer, taskHome, base)).code).toBe(1);
		expect(await readdir(join(taskHome, ".mob/bin"))).toEqual(["mob-1.0.0"]);
		expect(await readlink(join(taskHome, ".local/bin/mob"))).toBe(old);
	},
);

test("downloaded upgrade uses the same fixture contract and replaces the command link", async () => {
	const taskHome = await home();
	const { base, calls } = fixture();
	const old = join(taskHome, ".mob/bin/mob-1.0.0");
	await script(old, "printf 'old\\n'");
	await mkdir(join(taskHome, ".local/bin"), { recursive: true });
	await symlink(old, join(taskHome, ".local/bin/mob"));
	const result = await run(upgrade, taskHome, base);
	expect(result.code).toBe(0);
	expect(result.out).toContain(`Downloaded mob ${version}, verified SHA-256`);
	expect(await readlink(join(taskHome, ".local/bin/mob"))).toBe(
		join(taskHome, `.mob/bin/mob-${version}`),
	);
	expect(
		await readFile(join(taskHome, `.mob/bin/mob-${version}`), "utf8"),
	).toBe(fakeBinary);
	expect((await stat(join(taskHome, ".mob/bin"))).mode & 0o777).toBe(0o700);
	expect(
		(await stat(join(taskHome, `.mob/bin/mob-${version}`))).mode & 0o777,
	).toBe(0o755);
	expect(calls).toContain(`/releases/download/v${version}/SHA256SUMS`);
});

test.each(["wrong", "duplicate", "missing-sums", "bad-version", "offline"])(
	"downloaded upgrade refuses %s without replacing old files",
	async (mode) => {
		const taskHome = await home();
		const { base, server } = fixture(mode);
		if (mode === "offline") await server.stop(true);
		const old = join(taskHome, ".mob/bin/mob-1.0.0");
		await script(old, "printf 'old\\n'");
		await mkdir(join(taskHome, ".local/bin"), { recursive: true });
		await symlink(old, join(taskHome, ".local/bin/mob"));
		expect((await run(upgrade, taskHome, base)).code).toBe(1);
		expect(await readdir(join(taskHome, ".mob/bin"))).toEqual(["mob-1.0.0"]);
		expect(await readlink(join(taskHome, ".local/bin/mob"))).toBe(old);
	},
);

test.each([
	"http://example.test/releases/download",
	"http://127.0.0.1.example.test/releases/download",
	"ftp://127.0.0.1/releases/download",
	"file:///tmp/releases/download",
])(
	"installer and upgrade refuse a non-https release base: %s",
	async (base) => {
		const taskHome = await home();
		for (const args of [installer, upgrade]) {
			const result = await run(args, taskHome, base);
			expect(result.code).toBe(1);
			expect(result.err).toContain("https");
		}
		expect(await readdir(taskHome)).not.toContain(".local");
		expect(
			await Bun.file(join(taskHome, `.mob/bin/mob-${version}`)).exists(),
		).toBe(false);
	},
);

test("installer pins every curl to https and TLS 1.2", async () => {
	const script = await readFile(join(root, "install.sh"), "utf8");
	const curls = script.split("\n").filter((line) => /\bcurl\s+-/.test(line));
	expect(curls.length).toBeGreaterThan(0);
	for (const line of curls) {
		expect(line).toContain('--proto "$proto"');
		expect(line).toContain('--proto-redir "$proto"');
		expect(line).toContain("--tlsv1.2");
	}
	expect(script).toContain("proto='=https'");
});

test("shell scripts pass POSIX syntax checks", async () => {
	for (const file of ["bin/mob", "install.sh"])
		expect(
			(await run(["/bin/sh", "-n", join(root, file)], temporary, "unused"))
				.code,
		).toBe(0);
});

test.each([
	["Darwin", "arm64", "mob-darwin-arm64", "darwin", "arm64"],
	["Darwin", "x86_64", "mob-darwin-x64", "darwin", "x64"],
	["Linux", "aarch64", "mob-linux-arm64", "linux", "arm64"],
	["Linux", "x86_64", "mob-linux-x64", "linux", "x64"],
	["MINGW64_NT-10.0", "x86_64", "mob-windows-x64.exe", "win32", "x64"],
])(
	"installer and upgrade select the %s %s release asset",
	async (os, arch, name, platform, nodeArch) => {
		const taskHome = await home();
		const { base, calls } = fixture("ok", name);
		await script(
			join(taskHome, "tools/uname"),
			`case "$1" in -s) printf '%s\\n' '${os}' ;; -m) printf '%s\\n' '${arch}' ;; esac`,
		);
		const result = await run([...installer, "--cache-only"], taskHome, base, {
			PATH: `${taskHome}/tools:/usr/bin:/bin`,
		});
		expect(result.code).toBe(0);
		const upgraded = await run(
			[
				process.execPath,
				"-e",
				`import { installLatestRelease } from ${JSON.stringify(join(root, "apps/cli/src/release-download.ts"))}; console.log(await installLatestRelease({platform:${JSON.stringify(platform)},arch:${JSON.stringify(nodeArch)}}));`,
			],
			taskHome,
			base,
		);
		expect(upgraded.code).toBe(0);
		expect(calls.filter((url) => url.endsWith(`/${name}`))).toHaveLength(2);
	},
);

test.each([
	{ name: "installer", args: installer },
	{ name: "upgrade", args: upgrade },
])(
	"install paths refuse to overwrite an unrelated mob command ($name)",
	async ({ args }) => {
		const taskHome = await home();
		const { base } = fixture();
		const other = join(taskHome, ".local/bin/mob");
		await script(other, "printf 'unrelated\\n'");
		const before = await readFile(other, "utf8");
		expect((await run(args, taskHome, base)).code).toBe(1);
		expect(await readFile(other, "utf8")).toBe(before);
		expect(
			await Bun.file(join(taskHome, `.mob/bin/mob-${version}`)).exists(),
		).toBe(false);
	},
);

test("shell installer verifies through sha256sum when shasum is unavailable", async () => {
	const taskHome = await home();
	const { base } = fixture();
	const tools = join(taskHome, "tools");
	await mkdir(tools);
	for (const name of [
		"uname",
		"curl",
		"mkdir",
		"chmod",
		"mktemp",
		"cat",
		"grep",
		"awk",
		"tr",
		"mv",
		"rm",
	]) {
		const path = Bun.which(name);
		if (!path) throw new Error(`Missing test tool ${name}`);
		await symlink(path, join(tools, name));
	}
	// Emulate GNU sha256sum's output with Bun when the host only has shasum.
	const hashTool = join(tools, "sha256sum");
	await writeFile(
		hashTool,
		`#!${process.execPath}\nimport {createHash} from "node:crypto"; console.log(createHash("sha256").update(await Bun.file(process.argv[2]).bytes()).digest("hex") + "  " + process.argv[2]);\n`,
	);
	await chmod(hashTool, 0o755);
	const result = await run([...installer, "--cache-only"], taskHome, base, {
		PATH: tools,
	});
	expect(result.code).toBe(0);
	expect(result.err).toContain("verified SHA-256");
});
