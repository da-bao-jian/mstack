// Ported from mobius@33ed2ece packages/funding-rates/src/index.test.ts
import { describe, expect, test } from "bun:test";
import {
	calculateNetFundingRate,
	createFundingRate,
	findFundingRate,
	meetsFundingThreshold,
	type FundingRateSnapshot,
} from "./index.ts";

describe("funding rate snapshot math", () => {
	test("annualizes Aster by its reported one-hour interval", () => {
		const rate = createFundingRate({
			venue: "aster",
			market: "SUI",
			ratePerInterval: 0.0004,
			intervalHours: 1,
		});
		expect(rate?.annualizedPct).toBeCloseTo(350.4, 10);
	});

	test("calculates a positive cross-venue yield only when the short earns more", () => {
		const long = createFundingRate({
			venue: "aster",
			market: "SUI",
			ratePerInterval: -0.0001,
			intervalHours: 1,
		});
		const short = createFundingRate({
			venue: "hl",
			market: "SUI",
			ratePerInterval: 0.0002,
			intervalHours: 1,
		});
		if (!long || !short) throw new Error("test rates must be valid");

		const net = calculateNetFundingRate(long, short);
		expect(net?.netApy).toBeCloseTo(262.8, 10);
		expect(meetsFundingThreshold(net?.netApy ?? Number.NaN, 250)).toBe(true);
		expect(meetsFundingThreshold(net?.netApy ?? Number.NaN, 300)).toBe(false);
	});

	test("normalizes worker market names to the same canonical snapshot key", () => {
		const rate = createFundingRate({
			venue: "lighter",
			market: "BTC",
			ratePerInterval: 0.0008,
			intervalHours: 8,
		});
		if (!rate) throw new Error("test rate must be valid");
		const snapshot: FundingRateSnapshot = {
			observedAt: 0,
			rates: [rate],
			listed: ["lighter:BTC"],
			failed: [],
		};
		expect(findFundingRate(snapshot, "lighter", "BTC-PERP")).toEqual(rate);
	});

	test("resolves HL markets exactly, with a base fallback for legacy bare tasks", () => {
		const xyz = createFundingRate({
			venue: "hl",
			market: "XYZ:SNDK",
			ratePerInterval: 0.0001,
			intervalHours: 1,
		});
		const io = createFundingRate({
			venue: "hl",
			market: "IO:SNDK",
			ratePerInterval: 0.0002,
			intervalHours: 1,
		});
		if (!xyz || !io) throw new Error("test rates must be valid");
		const snapshot: FundingRateSnapshot = {
			observedAt: 0,
			rates: [xyz, io],
			listed: ["hl:XYZ:SNDK", "hl:IO:SNDK"],
			failed: [],
		};
		// Dex-qualified references pin the exact listing.
		expect(findFundingRate(snapshot, "hl", "io:SNDK")).toEqual(io);
		expect(findFundingRate(snapshot, "hl", "xyz:SNDK")).toEqual(xyz);
		// A legacy bare market resolves like resolveHlMarket: first base match
		// in snapshot order (core first, then builder dexes in registry order).
		expect(findFundingRate(snapshot, "hl", "SNDK")).toEqual(xyz);
		expect(findFundingRate(snapshot, "hl", "AAPL")).toBeNull();
	});

	test("keeps the dex qualifier through the write, so colliding bases stay distinct", () => {
		// Regression guard for the #1206 / #1181 merge. #1206 fixed a real
		// "rate not found" for a dex-qualified market by stripping the prefix in
		// `createFundingRate`, which also collapsed every listing of one base into
		// a single row. That is not a naming detail: on the live snapshot XYZ:NBIS
		// funds at ~23.9% while IO:NBIS funds at ~1.4%, so whichever row lost the
		// collision took the other's rate — a 17x error on the number the
		// delta-neutral carry is priced from. The lookup is fixed on the QUERY
		// side instead (below); the stored row must stay venue-native.
		const anth = createFundingRate({
			venue: "hl",
			market: "io:ANTH",
			ratePerInterval: 0.0001,
			intervalHours: 1,
		});
		if (!anth) throw new Error("test rate must be valid");
		expect(anth.market).toBe("IO:ANTH");

		const snapshot: FundingRateSnapshot = {
			observedAt: 0,
			rates: [anth],
			listed: ["hl:IO:ANTH"],
			failed: [],
		};
		// The #1206 bug itself stays fixed: a dex-qualified reference resolves,
		// with or without the -PERP suffix a caller may carry.
		expect(findFundingRate(snapshot, "hl", "io:ANTH")).toEqual(anth);
		expect(findFundingRate(snapshot, "hl", "io:ANTH-PERP")).toEqual(anth);
	});
});
