// Ported from mobius@33ed2ece frontend/test/features/delta-neutral/openTaskMessage.test.ts
import { describe, expect, it } from "bun:test";
import { buildOpenTaskMessage } from "../src/openTaskMessage.ts";

const BASE = {
	longVenue: "hl",
	longMarket: "BTC",
	shortVenue: "lighter",
	shortMarket: "BTC",
	sizeUsd: 2000,
	longPrice: 60000,
	shortPrice: 60000.5,
	minFundingApy: 0,
	nonce: "abc123",
	timestamp: 1786892865,
};

// Must stay byte-identical to funding-server's LEGACY_MESSAGE literal.
const LEGACY_MESSAGE =
	"Open arbitrage task: long=hl:BTC short=lighter:BTC sizeUsd=2000 longPrice=60000 shortPrice=60000.5 minFundingApy=0 nonce=abc123 timestamp=1786892865";

describe("frontend buildOpenTaskMessage mirror", () => {
	it("omitting autoClose is byte-identical to the legacy message", () => {
		expect(buildOpenTaskMessage(BASE)).toBe(LEGACY_MESSAGE);
		expect(buildOpenTaskMessage({ ...BASE, autoClose: undefined })).toBe(
			LEGACY_MESSAGE,
		);
	});
	it("appends a single trailing autoClose segment when present", () => {
		expect(buildOpenTaskMessage({ ...BASE, autoClose: true })).toBe(
			`${LEGACY_MESSAGE} autoClose=on`,
		);
		expect(buildOpenTaskMessage({ ...BASE, autoClose: false })).toBe(
			`${LEGACY_MESSAGE} autoClose=off`,
		);
	});
});

describe("new optional segments stay byte-identical to the server", () => {
	// These literals are duplicated in funding-server's own test. If the two
	// builders ever disagree the server's ecrecover returns a different address
	// and every open fails with "invalid signature" — a failure that gives no
	// hint about which side drifted, which is why both sides pin the string.
	it("appends each field in the server's order", () => {
		expect(
			buildOpenTaskMessage({
				...BASE,
				autoClose: true,
				longLeverage: 5,
				shortLeverage: 3,
				longMarginMode: "cross",
				shortMarginMode: "isolated",
				maxSpreadBps: 25,
				liqProtectionPct: 8,
				sizeMismatchPct: 5,
			}),
		).toBe(
			`${LEGACY_MESSAGE} autoClose=on longLeverage=5 shortLeverage=3 longMarginMode=cross shortMarginMode=isolated maxSpreadBps=25 liqProtectionPct=8 sizeMismatchPct=5`,
		);
	});

	it("omits every field the caller did not set", () => {
		expect(buildOpenTaskMessage(BASE)).toBe(LEGACY_MESSAGE);
		expect(buildOpenTaskMessage({ ...BASE, maxSpreadBps: 40 })).toBe(
			`${LEGACY_MESSAGE} maxSpreadBps=40`,
		);
		// Protection alone, with none of the older optional fields.
		expect(buildOpenTaskMessage({ ...BASE, liqProtectionPct: 8 })).toBe(
			`${LEGACY_MESSAGE} liqProtectionPct=8`,
		);
		expect(buildOpenTaskMessage({ ...BASE, sizeMismatchPct: 5 })).toBe(
			`${LEGACY_MESSAGE} sizeMismatchPct=5`,
		);
	});

	it("configures a single leg without implying the other", () => {
		expect(buildOpenTaskMessage({ ...BASE, longLeverage: 2 })).toBe(
			`${LEGACY_MESSAGE} longLeverage=2`,
		);
	});
});
