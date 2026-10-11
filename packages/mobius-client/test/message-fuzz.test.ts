import { expect, test } from "bun:test";
import {
	hashTypedData,
	keccak256,
	stringToHex,
	type TypedDataDefinition,
} from "viem";
import { seeded } from "../../test-seed.ts";
import {
	ACCEPT_LEGAL_TERMS_STATEMENT,
	ACCEPT_LEGAL_TERMS_TYPES,
	bindingPrepareMessage,
	buildApproveAgentTypedRequest,
	buildCloseTaskMessage,
	buildLiqProtectionMessage,
	buildOpenTaskMessage,
	buildResizeTaskMessage,
	hlTypedAction,
	lighterIntegratorApprovalMessage,
	lighterPrepareMessage,
} from "../src/index.ts";
import fixture from "./onboarding-parity.json";

const textHash = (s: string) => keccak256(stringToHex(s));
function changed<T extends object>(
	p: T,
	build: (p: T) => string,
	mutations: Partial<T>[],
) {
	const original = build(p);
	expect(build(JSON.parse(JSON.stringify(p)))).toBe(original);
	for (const mutation of mutations)
		expect(build({ ...p, ...mutation })).not.toBe(original);
	return original;
}
function typedChanges(data: TypedDataDefinition) {
	const original = hashTypedData(data);
	for (const field of data.types[data.primaryType]) {
		const value = data.message?.[field.name];
		const next =
			field.type === "address"
				? value === "0x0000000000000000000000000000000000000009"
					? "0x0000000000000000000000000000000000000008"
					: "0x0000000000000000000000000000000000000009"
				: field.type === "bool"
					? !value
					: field.type.startsWith("uint")
						? Number(value) + 1
						: `${value}!`;
		expect(
			hashTypedData({
				...data,
				message: { ...data.message, [field.name]: next },
			}),
		).not.toBe(original);
	}
	expect(
		hashTypedData({
			...data,
			domain: { ...data.domain, chainId: Number(data.domain?.chainId) + 1 },
		}),
	).not.toBe(original);
	expect(hashTypedData(JSON.parse(JSON.stringify(data)))).toBe(original);
	return original;
}

test("seed 0x1707: byte-stable builders and every signed field affects its digest", async () => {
	const random = seeded(0x1707);
	const corpus: string[] = [];
	const reference = new Function(
		"signTypedData",
		`${fixture.hlReferenceFunction.replace("export ", "")}; return signUserSignedAction;`,
	)(
		({
			wallet: _wallet,
			...typed
		}: { wallet: unknown } & TypedDataDefinition) => hashTypedData(typed),
	);
	for (let i = 0; i < 32; i++) {
		const timestamp = 1_790_000_000 + random(1e6),
			nonce = `seed-${random(1e9)}`;
		const taskId = `task-${random(1e6)}`,
			amount = (1 + random(1e6)) / 1e4;
		const open = {
			longVenue: "hl",
			longMarket: "xyz:NVDA",
			shortVenue: "aster",
			shortMarket: "USD1:NVDA",
			sizeUsd: amount,
			longPrice: 1e-7 * (1 + random(10)),
			shortPrice: 100 + amount,
			minFundingApy: random(100) - 50,
			nonce,
			timestamp,
			autoClose: i % 2 === 0,
			longLeverage: 2,
			shortLeverage: 3,
			longMarginMode: "cross" as const,
			shortMarginMode: "isolated" as const,
			maxSpreadBps: random(100),
			liqProtectionPct: 8,
			sizeMismatchPct: 5,
		};
		expect(buildOpenTaskMessage(open)).toBe(
			`Open arbitrage task: long=hl:xyz:NVDA short=aster:USD1:NVDA sizeUsd=${amount} longPrice=${open.longPrice} shortPrice=${open.shortPrice} minFundingApy=${open.minFundingApy} nonce=${nonce} timestamp=${timestamp} autoClose=${open.autoClose ? "on" : "off"} longLeverage=2 shortLeverage=3 longMarginMode=cross shortMarginMode=isolated maxSpreadBps=${open.maxSpreadBps} liqProtectionPct=8 sizeMismatchPct=5`,
		);
		corpus.push(
			changed(
				open,
				(p) => textHash(buildOpenTaskMessage(p)),
				Object.entries(open).map(([key, value]) => ({
					[key]:
						typeof value === "boolean"
							? !value
							: typeof value === "number"
								? value + 1
								: key.endsWith("MarginMode")
									? value === "cross"
										? "isolated"
										: "cross"
									: `${value}x`,
				})),
			),
		);
		const close = { taskId, timestamp };
		expect(buildCloseTaskMessage(close)).toBe(
			`Close arbitrage task: ${taskId} timestamp=${timestamp}`,
		);
		corpus.push(
			changed(close, (p) => textHash(buildCloseTaskMessage(p)), [
				{ taskId: `${taskId}x` },
				{ timestamp: timestamp + 1 },
			]),
		);
		const resize = {
			taskId,
			timestamp,
			longTargetBase: amount,
			shortTargetBase: amount * 2,
			disableSizeMismatchAutoClose: true,
		};
		expect(buildResizeTaskMessage(resize)).toBe(
			`Resize arbitrage task: ${taskId} timestamp=${timestamp} longTarget=${amount} shortTarget=${amount * 2} disableSizeMismatchAutoClose=on`,
		);
		corpus.push(
			changed(resize, (p) => textHash(buildResizeTaskMessage(p)), [
				{ taskId: `${taskId}x` },
				{ timestamp: timestamp + 1 },
				{ longTargetBase: amount + 1 },
				{ shortTargetBase: amount + 1 },
				{ disableSizeMismatchAutoClose: false },
			]),
		);
		const protection = {
			taskId,
			timestamp,
			liqProtectionPct: i % 2 ? null : amount % 100,
		};
		expect(buildLiqProtectionMessage(protection)).toBe(
			`Set arbitrage liquidation protection: ${taskId} liqProtectionPct=${protection.liqProtectionPct ?? "off"} timestamp=${timestamp}`,
		);
		corpus.push(
			changed(protection, (p) => textHash(buildLiqProtectionMessage(p)), [
				{ taskId: `${taskId}x` },
				{ timestamp: timestamp + 1 },
				{ liqProtectionPct: 100 },
			]),
		);
		const lighter: Parameters<typeof lighterPrepareMessage>[0] = {
			accountIndex: random(1e6),
			chainId: 304,
			nonce,
			timestamp,
			venue: "lighter-mainnet" as const,
		};
		expect(lighterPrepareMessage(lighter)).toBe(
			`Prepare Lighter binding accountIndex=${lighter.accountIndex} chainId=304 nonce=${nonce} timestamp=${timestamp} venue=lighter-mainnet`,
		);
		corpus.push(
			changed(lighter, (p) => textHash(lighterPrepareMessage(p)), [
				{ accountIndex: lighter.accountIndex + 1 },
				{ chainId: 466324 },
				{ nonce: `${nonce}x` },
				{ timestamp: timestamp + 1 },
				{ venue: null },
			]),
		);
		const integrator: Parameters<typeof lighterIntegratorApprovalMessage>[0] = {
			ownerAddress: "0x0000000000000000000000000000000000000001",
			venue: "lighter-mainnet" as const,
			integratorIndex: random(100),
			nonce,
			timestamp,
		};
		corpus.push(
			changed(
				integrator,
				(p) => textHash(lighterIntegratorApprovalMessage(p)),
				[
					{ ownerAddress: "0x0000000000000000000000000000000000000002" },
					{ integratorIndex: integrator.integratorIndex + 1 },
					{ nonce: `${nonce}x` },
					{ timestamp: timestamp + 1 },
					{ venue: "lighter" },
				],
			),
		);
		for (const item of fixture.cases.filter(
			(c) => c.action.type !== "updateLeverage",
		)) {
			const action = {
				...item.action,
				nonce: timestamp * 1000,
			} as unknown as Record<string, string | number>;
			const typed = hlTypedAction(action);
			expect(hashTypedData(typed)).toBe(
				await reference({ wallet: {}, action, types: item.types }),
			);
			corpus.push(typedChanges(typed));
		}
		const prepare = { nonce, timestamp };
		expect(bindingPrepareMessage("hl", prepare)).toBe(
			`Prepare HL binding nonce=${nonce} timestamp=${timestamp}`,
		);
		expect(bindingPrepareMessage("aster", prepare)).toBe(
			`Prepare Aster binding nonce=${nonce} timestamp=${timestamp}`,
		);
		corpus.push(
			changed(prepare, (p) => textHash(bindingPrepareMessage("hl", p)), [
				{ nonce: `${nonce}x` },
				{ timestamp: timestamp + 1 },
			]),
		);
		const legal: TypedDataDefinition = {
			domain: { name: "Mobius Legal", version: "1", chainId: 97 },
			types: ACCEPT_LEGAL_TERMS_TYPES,
			primaryType: "AcceptLegalTerms",
			message: {
				statement: ACCEPT_LEGAL_TERMS_STATEMENT,
				wallet: integrator.ownerAddress,
				termsVersion: nonce,
				termsUrl: `https://mob.exchange/terms/${i}`,
				privacyVersion: nonce,
				privacyUrl: `https://mob.exchange/privacy/${i}`,
				signedAt: timestamp,
			},
		};
		corpus.push(typedChanges(legal));
		const aster = buildApproveAgentTypedRequest(
			{
				user: integrator.ownerAddress as `0x${string}`,
				agentName: nonce,
				agentAddress: "0x0000000000000000000000000000000000000002",
				expired: timestamp * 1000 + 86400_000,
				canSpotTrade: false,
				canPerpTrade: true,
				canWithdraw: false,
				asterChain: "Mainnet",
				nonce: timestamp * 1e6,
			},
			56,
		) as unknown as TypedDataDefinition;
		corpus.push(typedChanges(aster));
	}
	// Golden corpus anchored by onboarding-parity.json and the byte-exact upstream tests.
	expect(
		new Bun.CryptoHasher("sha256").update(corpus.join("\n")).digest("hex"),
	).toBe("2365f254134f54191ed444924abeef34d8676cf559950df917ccbff3855e28fd");
});
