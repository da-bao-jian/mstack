import { expect, test } from "bun:test";
import {
	hashTypedData,
	keccak256,
	stringToHex,
	type TypedDataDefinition,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { SigningView } from "../src/interactive.ts";
import { walletConnectCeremonySigner } from "../src/walletconnect-ceremony.ts";
import { fakeWalletConnect } from "./fake-walletconnect-client.ts";

const wallet = privateKeyToAccount(`0x${"05".repeat(32)}`);
const expiresAt = Date.now() + 30_000;

function text(): SigningView {
	const message = "prepare exact bytes";
	return {
		id: "c-1:prepare",
		owner: wallet.address,
		purpose: "prepare",
		expiresAt,
		digest: keccak256(stringToHex(message)),
		signing: { type: "text", message },
	};
}

function typed(chainId: number): SigningView {
	const typedData: TypedDataDefinition = {
		domain: { name: "ceremony", chainId },
		types: { Bind: [{ name: "owner", type: "address" }] },
		primaryType: "Bind",
		message: { owner: wallet.address },
	};
	return {
		id: `c-1:chain-${chainId}`,
		owner: wallet.address,
		purpose: `chain ${chainId}`,
		expiresAt,
		digest: hashTypedData(typedData),
		signing: { type: "typed", typedData },
	};
}

test("WalletConnect ceremony pairs once and requests each step on its pinned chain", async () => {
	const fake = fakeWalletConnect(wallet);
	fake.session.namespaces.eip155.accounts = [1, 56, 42161].map(
		(chain) => `eip155:${chain}:${wallet.address}`,
	);
	const pairings: string[] = [];
	const signer = walletConnectCeremonySigner("c-1", wallet.address, expiresAt, {
		projectId: "c".repeat(32),
		createClient: fake.factory,
		onPairing: (uri) => pairings.push(uri),
	});
	expect(await signer.address()).toBe(wallet.address);
	for (const step of [text(), typed(42161), typed(56)])
		expect(await signer.sign(step)).toMatch(/^0x[\da-f]{130}$/i);
	expect(pairings).toHaveLength(1);
	expect(fake.calls.connects).toHaveLength(1);
	expect(fake.calls.requests.map((call) => call.chainId)).toEqual([
		"eip155:1",
		"eip155:42161",
		"eip155:56",
	]);
	await signer.close();
	expect(fake.calls.closes).toBe(1);
});
