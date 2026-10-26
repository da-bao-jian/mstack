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
		["git", "symbolic-ref", "-q", "HEAD"],
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
			return ["remote", "symbolic-ref"].includes(args[1])
				? { code: 0, out: "origin\n", err: "" }
				: { code: 1, out: "", err: "Not possible to fast-forward" };
		}),
	).rejects.toThrow("Not possible to fast-forward");
	expect(seen).toHaveLength(3);
});

test("a release-tag checkout moves to the newest tag instead of pulling", async () => {
	const answers: Record<string, { code: number; out: string }> = {
		remote: { code: 0, out: "origin\n" },
		"symbolic-ref": { code: 1, out: "" },
		tag: { code: 0, out: "v0.10.0\nv0.9.2\nv0.5.1\n" },
		describe: { code: 0, out: "v0.5.1\n" },
	};
	const seen: string[][] = [];
	const exec = async (args: string[]) => {
		seen.push(args);
		return { ...(answers[args[1]] ?? { code: 0, out: "" }), err: "" };
	};
	expect(await upgrade("/fixture", exec)).toBe(
		"Updated mstack to v0.10.0 and rebuilt the binary. If the release adds skills, run ./setup --host codex again.",
	);
	expect(seen).toContainEqual(["git", "fetch", "--quiet", "--tags", "origin"]);
	expect(seen).toContainEqual([
		"git",
		"-c",
		"advice.detachedHead=false",
		"checkout",
		"--quiet",
		"v0.10.0",
	]);
	expect(seen).not.toContainEqual(["git", "pull", "--ff-only"]);
	answers.describe = { code: 0, out: "v0.10.0\n" };
	seen.length = 0;
	expect(await upgrade("/fixture", exec)).toBe(
		"mstack v0.10.0 is the latest release; nothing to do.",
	);
	expect(seen.some((args) => args[0] === "bun")).toBe(false);
});
