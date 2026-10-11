import { expect, test } from "bun:test";
import { type Hex, hashTypedData, type TypedDataDefinition } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
	buildApproveAgentTypedRequest,
	hlTypedAction,
	lighterIntegratorApprovalMessage,
	lighterPrepareMessage,
	splitHlSignature,
} from "../src/index.ts";
import fixture from "./onboarding-parity.json";

const sha = (s: string) =>
	new Bun.CryptoHasher("sha256").update(s).digest("hex");
test.each(["aster", "legal", "lighter"])(
	"%s port preserves upstream source bytes",
	async (name) => {
		const source = await Bun.file(
			new URL(`../src/onboarding/${name}.ts`, import.meta.url),
		).text();
		expect(source.startsWith("// Ported from mobius@33ed2ece ")).toBe(true);
		if (name === "aster")
			expect(sha(source.slice(source.indexOf("\n") + 1))).toBe(
				fixture.asterSourceSha256,
			);
		else if (name === "legal")
			expect(sha(source.slice(source.indexOf("export const")))).toBe(
				fixture.legalBlockSha256,
			);
		else
			expect(sha(source.slice(source.indexOf("export function")))).toBe(
				fixture.lighterBlockSha256,
			);
	},
);
test.each(fixture.cases)(
	"HL $action.type hash equals reference _userSigned.js",
	async (c) => {
		expect(sha(fixture.hlReferenceFunction)).toBe(
			fixture.hlReferenceFunctionSha256,
		);
		// Execute the exact supplied reference function with an injected hashing wallet adapter.
		const reference = new Function(
			"signTypedData",
			`${fixture.hlReferenceFunction.replace("export ", "")}; return signUserSignedAction;`,
		)(
			({
				wallet: _wallet,
				...typed
			}: { wallet: unknown } & TypedDataDefinition) => hashTypedData(typed),
		);
		const referenceHash = await reference({
			wallet: {},
			action: c.action,
			types: c.types,
		});
		const port = hlTypedAction(
			c.action as unknown as Record<string, string | number>,
		);
		expect<unknown>(port.types).toEqual(c.types);
		expect(referenceHash).toBe(c.digest);
		expect(hashTypedData(port)).toBe(referenceHash);
		const wallet = privateKeyToAccount(`0x${"01".repeat(32)}`);
		const sig = await wallet.signTypedData(port);
		const split = splitHlSignature(sig);
		expect(split.r + split.s.slice(2) + split.v.toString(16)).toBe(sig);
		expect(
			splitHlSignature(
				`${sig.slice(0, -2)}${(split.v - 27).toString(16).padStart(2, "0")}` as Hex,
			),
		).toEqual(split);
	},
);
test("HL invalid actions and recovery bytes fail closed", () => {
	expect(() => hlTypedAction({ type: "withdraw" })).toThrow("Unsupported");
	expect(() => splitHlSignature("0x00")).toThrow("65-byte");
	expect(() => splitHlSignature(`0x${"01".repeat(64)}02`)).toThrow("recovery");
});
test("Aster order and address-as-string schema match upstream management signing", () => {
	const params = {
		user: "0x0000000000000000000000000000000000000001" as const,
		agentName: "test",
		agentAddress: "0x0000000000000000000000000000000000000002" as const,
		expired: 1800000000000,
		canSpotTrade: false,
		canPerpTrade: true,
		canWithdraw: false,
		asterChain: "Mainnet" as const,
		nonce: 1791690000000000,
	};
	const typed = buildApproveAgentTypedRequest(params, 56);
	expect(typed.domain).toEqual({
		name: "AsterSignTransaction",
		version: "1",
		chainId: 56,
		verifyingContract: "0x0000000000000000000000000000000000000000",
	});
	expect(typed.types.ApproveAgent).toEqual([
		{ name: "User", type: "string" },
		{ name: "AgentName", type: "string" },
		{ name: "AgentAddress", type: "string" },
		{ name: "Expired", type: "uint256" },
		{ name: "CanSpotTrade", type: "bool" },
		{ name: "CanPerpTrade", type: "bool" },
		{ name: "CanWithdraw", type: "bool" },
		{ name: "AsterChain", type: "string" },
		{ name: "Nonce", type: "uint256" },
	]);
	expect(Object.values(typed.message)).toEqual(Object.values(params));
});
test("Lighter deployment segments and integrator owner casing are byte exact", () => {
	const p = {
		accountIndex: 12,
		chainId: 466324,
		nonce: "fixed",
		timestamp: 1791690000,
		venue: null,
	};
	expect(lighterPrepareMessage(p)).toBe(
		"Prepare Lighter binding accountIndex=12 chainId=466324 nonce=fixed timestamp=1791690000",
	);
	expect(
		lighterPrepareMessage({ ...p, chainId: 304, venue: "lighter-mainnet" }),
	).toBe(
		"Prepare Lighter binding accountIndex=12 chainId=304 nonce=fixed timestamp=1791690000 venue=lighter-mainnet",
	);
	expect(
		lighterIntegratorApprovalMessage({
			ownerAddress: "0xAbCd",
			venue: "lighter-mainnet",
			integratorIndex: 7,
			nonce: "fixed",
			timestamp: 1791690000,
		}),
	).toBe(
		"Approve zero-fee Lighter integrator owner=0xabcd venue=lighter-mainnet integratorIndex=7 nonce=fixed timestamp=1791690000",
	);
});
