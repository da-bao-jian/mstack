import { expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { keccak256, stringToHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { walletConnectSigner } from "../src/walletconnect.ts";
import { createWorkerClient } from "../src/walletconnect-client.ts";

const wallet = privateKeyToAccount(`0x${"01".repeat(32)}`);
const message = "Worker isolation fixture, no relay";
const view = () => ({
	id: "p-1",
	owner: wallet.address,
	purpose: message,
	expiresAt: Date.now() + 10_000,
	digest: keccak256(stringToHex(message)),
	signing: { type: "text" as const, message },
});
function fixture() {
	const worker = new Worker(
		new URL("./fake-walletconnect-worker.ts", import.meta.url).href,
	);
	return {
		worker,
		terminate: spyOn(worker, "terminate"),
		factory: (projectId: string, signal: AbortSignal) =>
			createWorkerClient(worker, projectId, signal),
	};
}
test("worker bridge preserves pairing, session and exact signature, then terminates retained SDK timers", async () => {
	const f = fixture();
	const signer = walletConnectSigner(view(), {
		projectId: "c".repeat(32),
		createClient: f.factory,
		onPairing: () => {},
	});
	try {
		expect(await signer.address()).toBe(wallet.address);
		expect(await signer.signMessage({ message })).toBe(
			await wallet.signMessage({ message }),
		);
		await signer.close();
		expect(f.terminate).toHaveBeenCalledTimes(1);
	} finally {
		await signer.close();
	}
});
test.each(["a", "d", "e"])(
	"worker bridge expires and terminates pending SDK phase %s",
	async (mode) => {
		const f = fixture();
		const signer = walletConnectSigner(
			{ ...view(), expiresAt: Date.now() + 350 },
			{
				projectId: mode.repeat(32),
				createClient: f.factory,
				onPairing: () => {},
			},
		);
		try {
			await expect(signer.signMessage({ message })).rejects.toThrow("expired");
			await signer.close();
			// A late initialization cleanup is asynchronous, but must still terminate.
			for (let n = 0; n < 100 && !f.terminate.mock.calls.length; n++)
				await Bun.sleep(10);
			expect(f.terminate).toHaveBeenCalledTimes(1);
			await expect(signer.signMessage({ message })).rejects.toThrow("expired");
		} finally {
			f.worker.terminate();
		}
	},
);
test("worker cleanup is bounded even if SDK close never settles", async () => {
	const f = fixture();
	const client = await f.factory("f".repeat(32), new AbortController().signal);
	const started = Date.now();
	await client.close();
	expect(Date.now() - started).toBeLessThan(1800);
	expect(f.terminate).toHaveBeenCalledTimes(1);
	await expect(client.connect({ requiredNamespaces: {} })).rejects.toThrow(
		"closed",
	);
});

test("compiled executable embeds the worker and exits after a mocked SDK signs", async () => {
	const temporary = await mkdtemp(join(tmpdir(), "mstack-wc-compiled-"));
	try {
		const result = await Bun.build({
			entrypoints: [
				join(import.meta.dir, "walletconnect-compiled.ts"),
				join(import.meta.dir, "../src/walletconnect-worker.ts"),
			],
			target: "bun",
			naming: "[name].[ext]",
			compile: { outfile: join(temporary, "probe") },
			plugins: [
				{
					name: "offline-sdk",
					setup(build) {
						build.onLoad({ filter: /walletconnect-sdk\.ts$/ }, () => ({
							loader: "ts",
							contents: `
import { privateKeyToAccount } from "viem/accounts";
import { fakeWalletConnect } from "../test/fake-walletconnect-client.ts";
export const createSdkClient = async () => {
  setInterval(() => {}, 60_000);
  return fakeWalletConnect(privateKeyToAccount('0x' + '01'.repeat(32))).client;
};`,
						}));
					},
				},
			],
		});
		expect(result.success).toBe(true);
		const process = Bun.spawn([join(temporary, "probe")], {
			cwd: temporary,
			stdout: "pipe",
			stderr: "pipe",
		});
		const timer = setTimeout(() => process.kill(), 5000);
		try {
			const [code, out, error] = await Promise.all([
				process.exited,
				new Response(process.stdout).text(),
				new Response(process.stderr).text(),
			]);
			expect({ code, error }).toEqual({ code: 0, error: "" });
			expect(out).toContain(
				"Compiled worker: exact signature recovered, closed, no relay",
			);
		} finally {
			clearTimeout(timer);
			process.kill();
		}
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
}, 10_000);
