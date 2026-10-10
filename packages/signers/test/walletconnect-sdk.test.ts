import { expect, spyOn, test } from "bun:test";
import { SignClient } from "@walletconnect/sign-client";
import { privateKeyToAccount } from "viem/accounts";
import { createSdkClient } from "../src/walletconnect-sdk.ts";
import { fakeWalletConnect } from "./fake-walletconnect-client.ts";

test.each([false, true])(
	"installed SDK adapter forwards methods and closes once (stalled disconnect=%s)",
	async (stalled) => {
		const wallet = privateKeyToAccount(`0x${"01".repeat(32)}`);
		const fake = fakeWalletConnect(wallet);
		const calls: string[] = [];
		const sessionGet = fake.client.session.get;
		const sdk = {
			...fake.client,
			session: {
				get(topic: string) {
					calls.push(`get:${topic}`);
					return sessionGet(topic);
				},
				getAll: () => [fake.session],
			},
			async disconnect({ topic }: { topic: string }) {
				calls.push(`disconnect:${topic}`);
				if (stalled) await new Promise(() => {});
			},
			core: {
				pairing: {
					getPairings: () => [{ topic: "pairing" }],
					async disconnect({ topic }: { topic: string }) {
						calls.push(`disconnect:${topic}`);
					},
				},
				heartbeat: { stop: () => calls.push("heartbeat.stop") },
				relayer: {
					async transportClose() {
						calls.push("relayer.transportClose");
					},
				},
			},
		};
		const init = spyOn(SignClient, "init").mockImplementation(
			async (options) => {
				expect(options?.telemetryEnabled).toBe(false);
				expect(options?.logger).toBe("silent");
				expect(options?.projectId).toBe("c".repeat(32));
				expect(await options?.storage?.getKeys()).toEqual([]);
				// Only this test double omits the SDK's unused stores and engine internals.
				return sdk as unknown as Awaited<ReturnType<typeof SignClient.init>>;
			},
		);
		const abort = new AbortController();
		try {
			const client = await createSdkClient("c".repeat(32), abort.signal);
			const pairing = await client.connect({
				requiredNamespaces: {
					eip155: {
						chains: ["eip155:1"],
						methods: ["personal_sign"],
						events: [],
					},
				},
			});
			expect((await pairing.approval()).topic).toBe(fake.session.topic);
			expect(client.session.get(fake.session.topic)).toEqual(fake.session);
			const params = {
				topic: fake.session.topic,
				chainId: "eip155:1",
				request: {
					method: "personal_sign",
					params: ["0x74657374", wallet.address],
				},
			};
			expect(await client.request(params)).toBe(
				await wallet.signMessage({ message: "test" }),
			);
			expect(fake.calls.requests).toEqual([params]);
			let events = 0;
			const listener = () => {
				events++;
			};
			client.on("session_delete", listener);
			fake.emit("session_delete");
			client.off("session_delete", listener);
			fake.emit("session_delete");
			expect(events).toBe(1);
			abort.abort();
			await client.close();
			await client.close();
			expect(calls).toEqual([
				"get:fixture-session",
				"disconnect:fixture-session",
				"disconnect:pairing",
				"heartbeat.stop",
				"relayer.transportClose",
			]);
			expect(init).toHaveBeenCalledTimes(1);
		} finally {
			init.mockRestore();
		}
	},
);
