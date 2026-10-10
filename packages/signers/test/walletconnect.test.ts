import { expect, test } from "bun:test";
import {
	hashTypedData,
	keccak256,
	stringToHex,
	type TypedDataDefinition,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { deferred, type SigningView } from "../src/interactive.ts";
import { walletConnectSigner } from "../src/walletconnect.ts";
import {
	type WalletConnectClient,
	type WalletConnectSession,
	walletConnectInitOptions,
} from "../src/walletconnect-client.ts";
import { fakeWalletConnect } from "./fake-walletconnect-client.ts";

const wallet = privateKeyToAccount(generatePrivateKey());
const stranger = privateKeyToAccount(generatePrivateKey());
const projectId = "c".repeat(32);
const typedData: TypedDataDefinition = {
	domain: { name: "mstack fixture", version: "1", chainId: 97 },
	primaryType: "Test",
	types: { Test: [{ name: "purpose", type: "string" }] },
	message: { purpose: "no live transaction" },
};
function view(typed = false): SigningView {
	const message = "Exact UTF-8 café 🦊 1e-7";
	return {
		id: "p-1",
		purpose: "WalletConnect test",
		owner: wallet.address,
		expiresAt: Date.now() + 10_000,
		signing: typed ? { type: "typed", typedData } : { type: "text", message },
		digest: typed ? hashTypedData(typedData) : keccak256(stringToHex(message)),
	};
}
test.each([false, true])(
	"WalletConnect signs once with exact parameters and recovery (typed=%s)",
	async (typed) => {
		const p = view(typed);
		const fake = fakeWalletConnect(wallet, typed ? 97 : 1);
		const uris: string[] = [];
		const signer = walletConnectSigner(p, {
			projectId,
			createClient: fake.factory,
			onPairing: (uri) => uris.push(uri),
		});
		try {
			expect(await signer.address()).toBe(wallet.address);
			expect(await signer.chainId?.()).toBe(typed ? 97 : 1);
			expect(fake.calls.requests).toHaveLength(0);
			expect(uris).toHaveLength(1);
			expect(uris[0]).toStartWith("wc:");
			expect(fake.calls.connects).toEqual([
				{
					requiredNamespaces: {
						eip155: {
							chains: [`eip155:${typed ? 97 : 1}`],
							methods: [typed ? "eth_signTypedData_v4" : "personal_sign"],
							events: ["accountsChanged", "chainChanged"],
						},
					},
				},
			]);
			const signature =
				p.signing.type === "text"
					? await signer.signMessage({ message: p.signing.message })
					: await signer.signTypedData(p.signing.typedData);
			expect(signature).toMatch(/^0x[\da-f]{130}$/i);
			expect(fake.calls.requests).toEqual([
				{
					topic: fake.session.topic,
					chainId: `eip155:${typed ? 97 : 1}`,
					request: {
						method: typed ? "eth_signTypedData_v4" : "personal_sign",
						params:
							p.signing.type === "text"
								? [stringToHex(p.signing.message), wallet.address]
								: [wallet.address, JSON.stringify(typedData)],
					},
				},
			]);
			await expect(signer.signMessage({ message: "again" })).rejects.toThrow(
				"completed",
			);
			expect(fake.calls.signals[0].aborted).toBe(true);
			expect(fake.calls.closes).toBe(1);
		} finally {
			await signer.close();
		}
	},
);
test.each(["owner", "chain", "method", "session-expiry", "multiple-owners"])(
	"WalletConnect refuses invalid session %s before request",
	async (problem) => {
		const fake = fakeWalletConnect(wallet, 97);
		const ns = fake.session.namespaces.eip155;
		if (problem === "owner") ns.accounts = [`eip155:97:${stranger.address}`];
		if (problem === "chain") ns.accounts = [`eip155:1:${wallet.address}`];
		if (problem === "method") ns.methods = ["eth_sendTransaction"];
		if (problem === "session-expiry") fake.session.expiry = 1;
		if (problem === "multiple-owners")
			ns.accounts.push(`eip155:97:${stranger.address}`);
		const signer = walletConnectSigner(view(true), {
			projectId,
			createClient: fake.factory,
			onPairing: () => {},
		});
		await expect(signer.address()).rejects.toThrow("WalletConnect session");
		await signer.close();
		expect(fake.calls.requests).toHaveLength(0);
		expect(fake.calls.closes).toBe(1);
	},
);
test("WalletConnect rejects payload drift and forged recovery", async () => {
	const p = view();
	const fake = fakeWalletConnect(wallet);
	fake.client.request = async () =>
		stranger.signMessage({
			message: p.signing.type === "text" ? p.signing.message : "",
		});
	const signer = walletConnectSigner(p, {
		projectId,
		createClient: fake.factory,
		onPairing: () => {},
	});
	await expect(signer.signMessage({ message: "changed" })).rejects.toThrow(
		"differs",
	);
	if (p.signing.type !== "text") throw new Error("Expected text");
	await expect(
		signer.signMessage({ message: p.signing.message }),
	).rejects.toThrow("does not recover");
	await signer.close();
	expect(fake.calls.closes).toBe(1);
});
test("WalletConnect expires during pairing and ignores late approval", async () => {
	const fake = fakeWalletConnect(wallet);
	const approved = deferred<WalletConnectSession>();
	const connect = fake.client.connect;
	fake.client.connect = async (params) => ({
		...(await connect(params)),
		approval: () => approved.promise,
	});
	const signer = walletConnectSigner(
		{ ...view(), expiresAt: Date.now() + 60 },
		{ projectId, createClient: fake.factory, onPairing: () => {} },
	);
	await expect(signer.address()).rejects.toThrow("Proposal expired");
	expect(fake.calls.closes).toBe(1);
	expect(fake.calls.signals[0].aborted).toBe(true);
	approved.resolve(fake.session);
	await expect(signer.address()).rejects.toThrow("expired");
	await signer.close();
	expect(fake.calls.requests).toHaveLength(0);
});
test("WalletConnect expires during signing and refuses late signatures", async () => {
	const fake = fakeWalletConnect(wallet);
	const result = deferred<unknown>();
	fake.client.request = () => result.promise;
	const p = { ...view(), expiresAt: Date.now() + 60 };
	if (p.signing.type !== "text") throw new Error("Expected text");
	const signer = walletConnectSigner(p, {
		projectId,
		createClient: fake.factory,
		onPairing: () => {},
	});
	await expect(
		signer.signMessage({ message: p.signing.message }),
	).rejects.toThrow("Proposal expired");
	result.resolve(await wallet.signMessage({ message: p.signing.message }));
	await expect(
		signer.signMessage({ message: p.signing.message }),
	).rejects.toThrow("expired");
	await signer.close();
	expect(fake.calls.closes).toBe(1);
});
test("WalletConnect closes late initialization after expiry", async () => {
	const fake = fakeWalletConnect(wallet);
	const created = deferred<WalletConnectClient>();
	const signer = walletConnectSigner(
		{ ...view(), expiresAt: Date.now() + 30 },
		{ projectId, createClient: () => created.promise, onPairing: () => {} },
	);
	await expect(signer.address()).rejects.toThrow("Proposal expired");
	created.resolve(fake.client);
	await Bun.sleep(0);
	expect(fake.calls.closes).toBe(1);
	expect(fake.calls.connects).toHaveLength(0);
	await signer.close();
});
test.each([
	"session_update",
	"session_event",
	"session_delete",
	"session_expire",
] as const)("WalletConnect ends on %s", async (event) => {
	const fake = fakeWalletConnect(wallet);
	const signer = walletConnectSigner(view(), {
		projectId,
		createClient: fake.factory,
		onPairing: () => {},
	});
	await signer.address();
	fake.emit(event);
	await expect(signer.signMessage({ message: "unused" })).rejects.toThrow(
		"changed or disconnected",
	);
	await signer.close();
	expect(fake.calls.closes).toBe(1);
});
test("WalletConnect refuses missing project ID and already-expired Proposal without initializing", async () => {
	expect(() =>
		walletConnectSigner(view(), { projectId: "", onPairing: () => {} }),
	).toThrow("project ID");
	const signer = walletConnectSigner(
		{ ...view(), expiresAt: 1 },
		{ projectId, onPairing: () => {} },
	);
	await expect(signer.address()).rejects.toThrow("expired");
});
test("WalletConnect initialization disables telemetry and uses isolated in-memory storage", async () => {
	const a = walletConnectInitOptions(projectId),
		b = walletConnectInitOptions(projectId);
	expect(a.projectId).toBe(projectId);
	expect(a.telemetryEnabled).toBe(false);
	expect(a.logger).toBe("silent");
	expect(a.customStoragePrefix).not.toBe(b.customStoragePrefix);
	expect(a.metadata.icons).toEqual([]);
	await a.storage.setItem("key", { fixture: true });
	expect(await a.storage.getItem<{ fixture: boolean }>("key")).toEqual({
		fixture: true,
	});
	expect(await b.storage.getItem("key")).toBeUndefined();
	expect(await a.storage.getKeys()).toEqual(["key"]);
	expect(await a.storage.getEntries()).toEqual([["key", { fixture: true }]]);
	await a.storage.removeItem("key");
	expect(await a.storage.getKeys()).toEqual([]);
});
