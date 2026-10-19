import { afterEach, expect, test } from "bun:test";
import {
	chmod,
	lstat,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createKeyStore,
	type KeyMeta,
	type KeyStoreBackend,
} from "../src/index.ts";

const owner = "0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD";
const key = `mobius_01234567-89ab-cdef-0123-456789abcdef.${"ab".repeat(32)}`;
const meta: KeyMeta = {
	name: "desk",
	venues: ["hl", "lighter"],
	maxSizeUsd: 5000,
	importedAt: 1_800_000_000_000,
	verifiedAt: 1_800_000_000_123,
	apiBase: "https://api.mob.exchange",
};
const homes: string[] = [];
afterEach(async () => {
	await Promise.all(
		homes.splice(0).map((path) => rm(path, { recursive: true, force: true })),
	);
});

async function home() {
	const path = await mkdtemp(join(tmpdir(), "mstack-keys-"));
	homes.push(path);
	return path;
}

type FakeRun = (
	argv: string[],
	stdin?: string,
) => Promise<{ code: number; stdout: string; stderr: string }>;
function memoryRunner() {
	let secret: string | undefined;
	const calls: { argv: string[]; stdin?: string }[] = [];
	const run: FakeRun = async (argv, stdin) => {
		calls.push({ argv, stdin });
		if (argv.includes("add-generic-password")) secret = argv.at(-1);
		else if (argv.includes("store")) secret = stdin?.trimEnd();
		else if (argv.includes("delete-generic-password") || argv.includes("clear"))
			secret = undefined;
		else if (
			argv.includes("find-generic-password") ||
			argv.includes("lookup")
		) {
			if (!secret) return { code: 1, stdout: "", stderr: "missing" };
			return { code: 0, stdout: `${secret}\n`, stderr: "" };
		}
		return { code: 0, stdout: "", stderr: "" };
	};
	return { run, calls };
}

for (const backend of ["keychain", "secret-tool", "file"] as const) {
	test(`${backend} implements the common store contract without exposing the secret`, async () => {
		const root = await home();
		const fake = memoryRunner();
		const store = await createKeyStore({
			home: root,
			selection: backend,
			env: {},
			platform: backend === "keychain" ? "darwin" : "linux",
			which: () => "/fake/secret-tool",
			securityPath: "/fake/security",
			run: fake.run,
		});
		expect(store.backend).toBe(backend);
		await store.put(owner, key, meta);
		expect(await store.get(owner)).toEqual({ key, meta });
		expect(await store.describe(owner)).toEqual({
			prefix: "mobius_01234567-89ab-cdef-0123-456789abcdef…",
			backend,
			meta,
		});
		expect(JSON.stringify(await store.describe(owner))).not.toContain(
			"ab".repeat(32),
		);
		expect(await store.delete(owner)).toBe(true);
		expect(await store.get(owner)).toBeNull();
	});
}

test("keychain uses the fixed security command and the required arguments", async () => {
	const fake = memoryRunner();
	const root = await home();
	const store = await createKeyStore({
		home: root,
		defaultHome: root,
		selection: "keychain",
		env: {},
		platform: "darwin",
		securityPath: "/usr/bin/security",
		run: fake.run,
	});
	await store.put(owner, key, meta);
	await store.get(owner);
	await store.delete(owner);
	expect(fake.calls.map((call) => call.argv)).toEqual([
		[
			"/usr/bin/security",
			"add-generic-password",
			"-U",
			"-s",
			"mstack.mobius-api",
			"-a",
			owner.toLowerCase(),
			"-w",
			key,
		],
		[
			"/usr/bin/security",
			"find-generic-password",
			"-w",
			"-s",
			"mstack.mobius-api",
			"-a",
			owner.toLowerCase(),
		],
		[
			"/usr/bin/security",
			"find-generic-password",
			"-w",
			"-s",
			"mstack.mobius-api",
			"-a",
			owner.toLowerCase(),
		],
		[
			"/usr/bin/security",
			"delete-generic-password",
			"-s",
			"mstack.mobius-api",
			"-a",
			owner.toLowerCase(),
		],
	]);
});

test("secret-tool sends the secret only on stdin", async () => {
	const fake = memoryRunner();
	const root = await home();
	const store = await createKeyStore({
		home: root,
		defaultHome: root,
		selection: "secret-tool",
		env: {},
		platform: "linux",
		which: () => "/fake/secret-tool",
		run: fake.run,
	});
	await store.put(owner, key, meta);
	expect(fake.calls[0]).toEqual({
		argv: [
			"/fake/secret-tool",
			"store",
			"--label",
			"mstack Mobius API key",
			"service",
			"mstack.mobius-api",
			"owner",
			owner.toLowerCase(),
		],
		stdin: `${key}\n`,
	});
	expect(fake.calls[0].argv.join(" ")).not.toContain(key);
});

/** A credential store shared by every home, keyed like the real one. */
function sharedRunner() {
	const items = new Map<string, string>();
	const calls: string[][] = [];
	const after = (argv: string[], flag: string) =>
		argv[argv.indexOf(flag) + 1] ?? "";
	const id = (argv: string[]) =>
		argv.includes("-s")
			? `${after(argv, "-s")}|${after(argv, "-a")}`
			: `${after(argv, "service")}|${after(argv, "owner")}`;
	const run: FakeRun = async (argv, stdin) => {
		calls.push(argv);
		if (argv.includes("add-generic-password"))
			items.set(id(argv), argv.at(-1) ?? "");
		else if (argv.includes("store"))
			items.set(id(argv), stdin?.trimEnd() ?? "");
		else if (argv.includes("delete-generic-password") || argv.includes("clear"))
			items.delete(id(argv));
		else {
			const secret = items.get(id(argv));
			if (!secret) return { code: 1, stdout: "", stderr: "missing" };
			return { code: 0, stdout: `${secret}\n`, stderr: "" };
		}
		return { code: 0, stdout: "", stderr: "" };
	};
	return { run, calls, items };
}

for (const backend of ["keychain", "secret-tool"] as const) {
	test(`${backend}: two homes for one wallet keep separate keys; the default home keeps the original name`, async () => {
		const shared = sharedRunner();
		const defaultHome = await home();
		const sandbox = await home();
		const open = (root: string) =>
			createKeyStore({
				home: root,
				defaultHome,
				selection: backend,
				env: {},
				platform: backend === "keychain" ? "darwin" : "linux",
				which: () => "/fake/secret-tool",
				securityPath: "/fake/security",
				run: shared.run,
			});
		const real = await open(defaultHome);
		const lab = await open(sandbox);
		const labKey = `mobius_00000000-0000-4000-8000-000000000001.${"cd".repeat(32)}`;
		const labMeta = { ...meta, apiBase: "http://127.0.0.1:4000" };
		await real.put(owner, key, meta);
		await lab.put(owner, labKey, labMeta);
		expect(await real.get(owner)).toEqual({ key, meta });
		expect(await lab.get(owner)).toEqual({ key: labKey, meta: labMeta });
		const services = [...shared.items.keys()].map((item) => item.split("|")[0]);
		expect(services).toContain("mstack.mobius-api");
		expect(
			services.filter((name) => /^mstack\.mobius-api:[0-9a-f]{16}$/.test(name)),
		).toHaveLength(1);
		expect(await lab.delete(owner)).toBe(true);
		expect(await lab.get(owner)).toBeNull();
		expect(await real.get(owner)).toEqual({ key, meta });
	});
}

test("env always wins, is read-only, and does not write files", async () => {
	const root = await home();
	const store = await createKeyStore({
		home: root,
		selection: "file",
		env: { MOBIUS_API_KEY: key },
		platform: "linux",
		apiBase: meta.apiBase,
		now: () => meta.importedAt,
	});
	expect(store.backend).toBe("env");
	expect((await store.get(owner))?.key).toBe(key);
	await expect(store.put(owner, key, meta)).rejects.toThrow("read-only");
	await expect(store.delete(owner)).rejects.toThrow("read-only");
	expect(await lstat(root).then(() => true)).toBe(true);
	expect(
		await lstat(join(root, "keys")).then(
			() => true,
			() => false,
		),
	).toBe(false);
});

test("auto chooses the platform store and falls back to file", async () => {
	for (const [platform, found, backend] of [
		["darwin", null, "keychain"],
		["linux", "/usr/bin/secret-tool", "secret-tool"],
		["linux", null, "file"],
	] as const) {
		const store = await createKeyStore({
			home: await home(),
			selection: "auto",
			env: {},
			platform,
			which: () => found,
			securityPath: "/fake/security",
			run: memoryRunner().run,
		});
		expect(store.backend).toBe(backend as KeyStoreBackend);
	}
});

test("file storage is private and rejects symlinks or wrong modes", async () => {
	const root = await home();
	const store = await createKeyStore({
		home: root,
		selection: "file",
		env: {},
		platform: "linux",
	});
	await store.put(owner, key, meta);
	const dir = join(root, "keys");
	const file = join(dir, `${owner.toLowerCase()}.json`);
	expect((await lstat(dir)).mode & 0o777).toBe(0o700);
	expect((await lstat(file)).mode & 0o777).toBe(0o600);
	expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ key, meta });
	await chmod(file, 0o644);
	await expect(store.get(owner)).rejects.toThrow("mode 0600");
	await rm(file);
	await writeFile(join(root, "target"), "x");
	await symlink(join(root, "target"), file);
	await expect(store.get(owner)).rejects.toThrow("symlink");
	await rm(file);
	await chmod(dir, 0o755);
	await expect(store.get(owner)).rejects.toThrow("mode 0700");
	await expect(store.delete(owner)).rejects.toThrow("mode 0700");
});

test("file storage rejects a symlinked keys directory", async () => {
	const root = await home();
	const target = join(root, "target");
	await mkdir(target, { mode: 0o700 });
	await symlink(target, join(root, "keys"));
	const store = await createKeyStore({
		home: root,
		selection: "file",
		env: {},
		platform: "linux",
	});
	await expect(store.put(owner, key, meta)).rejects.toThrow("symlink");
});
