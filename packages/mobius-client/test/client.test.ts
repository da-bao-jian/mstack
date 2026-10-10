import { expect, test } from "bun:test";
import {
	ApiError,
	buildAutoCloseTaskMessage,
	buildCloseTaskMessage,
	buildNeutralizeTaskMessage,
	buildOpenTaskMessage,
	createRateLimiter,
	isVenueReadinessError,
	MobiusClient,
	stageOpenBody,
} from "../src/index.ts";

test("per-host pacer shares slots across concurrent requests without bursts", async () => {
	let time = 10_000;
	const waits: number[] = [];
	const limit = createRateLimiter(
		() => time,
		async (ms) => {
			waits.push(ms);
			time += ms;
		},
	);
	await Promise.all([limit("one"), limit("one"), limit("one")]);
	expect(waits).toEqual([500, 500]);
	await limit("two");
	expect(waits).toEqual([500, 500]);
	const signal = AbortSignal.abort();
	await expect(limit("one", signal)).rejects.toThrow();
});
test("writes carry exact body and client headers, with no retries on readiness failure", async () => {
	let count = 0;
	const body = {
		taskId: "t1",
		timestamp: 1787555739,
		signature: "0x1234" as const,
	};
	const readiness = {
		error: "Venue readiness check failed.",
		readiness: {
			ready: false,
			venues: [{ venue: "hl", ready: false, issue: "builder_fee_missing" }],
		},
	};
	const client = new MobiusClient({
		version: "0.2.0",
		limit: async () => {},
		fetch: async (url, init) => {
			count++;
			expect(url).toBe("https://funding.mob.exchange/api/arbitrage/close");
			expect(init?.redirect).toBe("error");
			expect(init?.signal).toBeUndefined();
			expect(new Headers(init?.headers).get("X-Mobius-Client")).toBe(
				"mstack/0.2.0",
			);
			expect(new Headers(init?.headers).get("User-Agent")).toBe("mstack/0.2.0");
			expect(JSON.parse(String(init?.body))).toEqual(body);
			return Response.json(readiness, { status: 409 });
		},
	});
	try {
		await client.write("/api/arbitrage/close", body);
		throw new Error("expected failure");
	} catch (error) {
		expect(error).toBeInstanceOf(ApiError);
		expect((error as ApiError).data).toEqual(readiness);
		expect((error as Error).message).toBe(JSON.stringify(readiness));
	}
	expect(count).toBe(1);
	expect(isVenueReadinessError(readiness)).toBe(true);
	expect(isVenueReadinessError({ readiness: { venues: [] } })).toBe(false);
});
test("staging freezes native names, marks, timestamp, nonce, and zero minimum", () => {
	const a = stageOpenBody(
		{
			longVenue: "hl",
			longMarket: "xyz:NVDA",
			shortVenue: "aster",
			shortMarket: "USD1:NVDA",
			sizeUsd: 1000,
			longPrice: 1e-7,
			shortPrice: 123.5,
			autoClose: false,
		},
		1787555739123,
	);
	expect(a.body.timestamp).toBe(1787555739);
	expect(a.body.nonce).toMatch(/^[0-9a-f-]{36}$/);
	expect(a.body.minFundingApy).toBe(0);
	expect(a.message).toBe(
		`Open arbitrage task: long=hl:xyz:NVDA short=aster:USD1:NVDA sizeUsd=1000 longPrice=1e-7 shortPrice=123.5 minFundingApy=0 nonce=${a.body.nonce} timestamp=1787555739 autoClose=off`,
	);
	expect(() => stageOpenBody({ ...a.body, longLeverage: 5 })).toThrow(
		"venue verification",
	);
	expect(buildOpenTaskMessage({ ...a.body, sizeUsd: 0.1 })).toContain(
		"sizeUsd=0.1",
	);
});
// Literals extracted from ManageView.tsx lines 883, 1003, 1025 at mobius@33ed2ece.
test("inlined management messages preserve exact upstream strings", () => {
	expect(buildCloseTaskMessage({ taskId: "t1", timestamp: 1787555739 })).toBe(
		"Close arbitrage task: t1 timestamp=1787555739",
	);
	expect(
		buildNeutralizeTaskMessage({ taskId: "t1", timestamp: 1787555739 }),
	).toBe("Neutralize arbitrage task: t1 timestamp=1787555739");
	expect(
		buildAutoCloseTaskMessage({
			taskId: "t1",
			autoClose: true,
			minFundingApy: 0,
			timestamp: 1787555739,
		}),
	).toBe(
		"Set arbitrage auto-close: t1 autoClose=on minFundingApy=0 timestamp=1787555739",
	);
	expect(
		buildAutoCloseTaskMessage({
			taskId: "t1",
			autoClose: false,
			minFundingApy: 1e-7,
			timestamp: 1787555739,
		}),
	).toBe(
		"Set arbitrage auto-close: t1 autoClose=off minFundingApy=1e-7 timestamp=1787555739",
	);
});
test("malformed successful reads fail instead of returning an empty result", async () => {
	const client = new MobiusClient({
		version: "0.2.0",
		limit: async () => {},
		fetch: async () => Response.json({ bound: "true" }),
	});
	await expect(
		client.read("/api/binding/hl/credential", { ownerAddress: "0x1" }),
	).rejects.toThrow("invalid bound");
});
