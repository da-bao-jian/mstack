import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import inventory from "../docs/licenses/dependency-inventory.json";

const root = resolve(import.meta.dir, "..");
const lock = JSON.parse(
	(await readFile(join(root, "bun.lock"), "utf8")).replace(
		/,\s*([}\]])/g,
		"$1",
	),
) as {
	workspaces: Record<
		string,
		{
			dependencies?: Record<string, string>;
			optionalDependencies?: Record<string, string>;
			devDependencies?: Record<string, string>;
		}
	>;
	packages: Record<string, [string, ...unknown[]]>;
};

test("every external dependency is exact and notices cover every lockfile resolution", async () => {
	for (const manifest of Object.values(lock.workspaces)) {
		for (const [name, version] of Object.entries({
			...manifest.dependencies,
			...manifest.optionalDependencies,
			...manifest.devDependencies,
		})) {
			if (name.startsWith("@mstack/")) {
				expect(version).toBe("workspace:*");
				continue;
			}
			expect(version).toMatch(/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/);
		}
	}
	const actual = [
		...new Set(
			Object.values(lock.packages)
				.map(([id]) => id)
				.filter((id) => !id.includes("@workspace:")),
		),
	].sort();
	expect(
		inventory.packages.map((p) => `${p.package}@${p.version}`).sort(),
	).toEqual(actual);
	const notices = await readFile(join(root, "THIRD_PARTY_NOTICES.md"), "utf8");
	expect(notices).toContain("dependency-inventory.json");
	for (const name of [
		"viem",
		"@modelcontextprotocol/sdk",
		"qrcode-terminal",
		"@walletconnect/sign-client",
	]) {
		const resolved = inventory.packages.find((p) => p.package === name);
		expect(resolved).toBeDefined();
		expect(notices).toContain(resolved?.version as string);
	}
});

test("WalletConnect remains optional and has exactly one runtime SDK import", async () => {
	expect(lock.workspaces["packages/signers"].dependencies).not.toHaveProperty(
		"@walletconnect/sign-client",
	);
	expect(
		lock.workspaces["packages/signers"].optionalDependencies?.[
			"@walletconnect/sign-client"
		],
	).toBe("2.25.0");
	const imports: string[] = [];
	for await (const file of new Bun.Glob("{apps,packages}/*/src/**/*.ts").scan(
		root,
	)) {
		const source = await readFile(join(root, file), "utf8");
		if (source.includes('"@walletconnect/sign-client"')) {
			imports.push(file);
			expect(source).toContain('await import("@walletconnect/sign-client")');
			expect(source).not.toMatch(/from ["']@walletconnect/);
		}
	}
	expect(imports).toEqual(["packages/signers/src/walletconnect-sdk.ts"]);
});

test("tracked files stay below 256 KiB outside assets and contain no compiled executables", async () => {
	const child = Bun.spawn(["git", "ls-files", "-z"], {
		cwd: root,
		stdout: "pipe",
		stderr: "pipe",
	});
	const files = (await new Response(child.stdout).text())
		.split("\0")
		.filter(Boolean);
	expect(await child.exited).toBe(0);
	for (const file of files) {
		const bytes = await readFile(join(root, file));
		if (!file.startsWith("assets/"))
			expect(bytes.length).toBeLessThanOrEqual(256 * 1024);
		const magic = bytes.subarray(0, 4).toString("hex");
		expect([
			"7f454c46",
			"cffaedfe",
			"cefaedfe",
			"feedfacf",
			"feedface",
			"cafebabe",
			"0061736d",
		]).not.toContain(magic);
		expect(bytes.subarray(0, 2).toString()).not.toBe("MZ");
	}
	const ignore = Bun.spawn(
		[
			"git",
			"check-ignore",
			".codex-runs/test",
			"reference/test",
			"apps/cli/dist/mob",
			".mob/config.json",
			"test-fixtures/.mob/keystore/key.json",
		],
		{ cwd: root, stdout: "pipe", stderr: "pipe" },
	);
	expect(
		(await new Response(ignore.stdout).text()).trim().split("\n"),
	).toHaveLength(5);
	expect(await ignore.exited).toBe(0);
});
