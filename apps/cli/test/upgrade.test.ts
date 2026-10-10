import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { installationRoot, upgrade } from "../src/upgrade.ts";

test("upgrade finds the checkout above the binary or an installed shim", async () => {
	expect(await installationRoot(resolve(import.meta.dir, "../src"))).toBe(
		resolve(import.meta.dir, "../../.."),
	);
	expect(await installationRoot("/tmp")).toBeNull();
});

test("upgrade with no origin reports no remote and makes no changes", async () => {
	const seen: string[][] = [];
	const exec = async (args: string[]) => {
		seen.push(args);
		return { code: 0, out: "", err: "" };
	};
	expect(await upgrade("/fixture", exec)).toBe("no remote configured");
	expect(seen).toEqual([["git", "remote"]]);
	expect(await upgrade(null, exec)).toBe("no remote configured");
	expect(seen).toHaveLength(1);
});

test("a plugin cache without Git metadata has no upgrade remote", async () => {
	const root = await mkdtemp(join(tmpdir(), "mob-plugin-cache-test-"));
	try {
		await mkdir(join(root, ".claude-plugin"));
		await writeFile(
			join(root, ".claude-plugin/plugin.json"),
			JSON.stringify({ name: "mstack" }),
		);
		expect(await installationRoot(root)).toBeNull();
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("upgrade uses a fast-forward pull, frozen install, then build", async () => {
	const seen: string[][] = [];
	await upgrade("/fixture", async (args, cwd) => {
		expect(cwd).toBe("/fixture");
		seen.push(args);
		return { code: 0, out: args[1] === "remote" ? "origin\n" : "", err: "" };
	});
	expect(seen).toEqual([
		["git", "remote"],
		["git", "pull", "--ff-only"],
		["bun", "install", "--frozen-lockfile"],
		["bun", "run", "build"],
	]);
});

test("upgrade stops at a failed pull without building or retrying", async () => {
	const seen: string[][] = [];
	await expect(
		upgrade("/fixture", async (args) => {
			seen.push(args);
			return args[1] === "remote"
				? { code: 0, out: "origin\n", err: "" }
				: { code: 1, out: "", err: "Not possible to fast-forward" };
		}),
	).rejects.toThrow("Not possible to fast-forward");
	expect(seen).toHaveLength(2);
});
