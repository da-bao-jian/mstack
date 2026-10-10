import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getConfig, readConfig, setConfig } from "../src/config.ts";
import { walletConnectFlow } from "./fixtures/walletconnect-flow.ts";

test.each([false, true])(
	"CLI WalletConnect Proposal flow (override=%s)",
	async (override) => {
		await walletConnectFlow(() => {}, override);
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
