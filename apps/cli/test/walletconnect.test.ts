import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getConfig, readConfig, setConfig } from "../src/config.ts";
import { walletConnectFlow } from "./fixtures/walletconnect-flow.ts";

test.each([false, true])(
	"CLI WalletConnect Proposal flow (override=%s)",
	async (override) => {
		const lines: string[] = [];
		await walletConnectFlow((line) => lines.push(line), override);
		const index = lines.findIndex((line) => line.startsWith("wc:"));
		expect(index).toBeGreaterThan(0);
		expect(lines[index + 1]).toStartWith("p-1: submitted · Server answer:");
		expect(lines[index + 1]).not.toContain("\n");
		expect(lines[index + 2]).toBe("exit=0");
		expect(lines.join("\n")).not.toContain("Waiting for your wallet");
		expect(lines.join("\n")).not.toContain("If no page opened");
	},
);
test("WalletConnect project ID has no default and rejects malformed IDs", async () => {
	const home = await mkdtemp(join(tmpdir(), "mstack-wc-config-"));
	try {
		expect(getConfig(await readConfig(home), "walletconnect_project_id")).toBe(
			"",
		);
		for (const value of ["", "fake", "g".repeat(32), ` ${"c".repeat(32)}`])
			await expect(
				setConfig("walletconnect_project_id", value, home),
			).rejects.toThrow("Reown project ID");
		const id = "f".repeat(32);
		expect(await setConfig("walletconnect_project_id", id, home)).toBe(id);
		expect(getConfig(await readConfig(home), "walletconnect_project_id")).toBe(
			id,
		);
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});

test("human WalletConnect smoke fails in one line before pairing when config or live opt-in is missing", async () => {
	const home = await mkdtemp(join(tmpdir(), "mstack-wc-smoke-"));
	async function invoke(live: string) {
		const child = Bun.spawn(
			[
				process.execPath,
				join(import.meta.dir, "../scripts/smoke-walletconnect.ts"),
			],
			{
				env: { ...process.env, MOB_HOME: home, MOB_LIVE: live },
				stdout: "pipe",
				stderr: "pipe",
			},
		);
		const [code, out, err] = await Promise.all([
			child.exited,
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
		]);
		return { code, out, err };
	}
	try {
		expect(await invoke("1")).toEqual({
			code: 1,
			out: "",
			err: "Missing config: owner, walletconnect_project_id. Set with mob config before the live smoke.\n",
		});
		await setConfig(
			"owner",
			"0x0000000000000000000000000000000000000001",
			home,
		);
		for (const live of ["", "1"])
			expect(await invoke(live)).toEqual({
				code: 1,
				out: "",
				err: "Missing config: walletconnect_project_id. Set with mob config before the live smoke.\n",
			});
		await setConfig("walletconnect_project_id", "a".repeat(32), home);
		expect(await invoke("")).toEqual({
			code: 1,
			out: "",
			err: "Live WalletConnect smoke requires MOB_LIVE=1 and a mobile wallet. No relay contacted.\n",
		});
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});
