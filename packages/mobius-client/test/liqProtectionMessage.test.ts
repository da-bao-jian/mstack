// Ported from mobius@33ed2ece frontend/test/features/delta-neutral/liqProtectionMessage.test.ts
import { describe, expect, it } from "bun:test";
import { buildLiqProtectionMessage } from "../src/liqProtectionMessage.ts";

/**
 * These literals must stay byte-identical to the ones in
 * `funding-server/src/server/routes/arbitrage.test.ts`. They are written out in
 * full rather than composed, so a change to either builder fails here loudly
 * instead of producing a different-but-self-consistent string on one side —
 * which the server would answer with "invalid signature" and no other clue.
 */
const TS = 1787555739;

describe("frontend buildLiqProtectionMessage mirror", () => {
	it("names the threshold as the number", () => {
		expect(
			buildLiqProtectionMessage({
				taskId: "t1",
				timestamp: TS,
				liqProtectionPct: 8,
			}),
		).toBe(
			"Set arbitrage liquidation protection: t1 liqProtectionPct=8 timestamp=1787555739",
		);
	});

	it("spells off as `off`, not 0 or null", () => {
		// The server's bound is (0, 100], so `0` would be indistinguishable from a
		// threshold it rejects — and `null` says nothing to someone reading the
		// prompt in their wallet.
		expect(
			buildLiqProtectionMessage({
				taskId: "t1",
				timestamp: TS,
				liqProtectionPct: null,
			}),
		).toBe(
			"Set arbitrage liquidation protection: t1 liqProtectionPct=off timestamp=1787555739",
		);
	});

	it("keeps a fractional threshold verbatim", () => {
		// The input step is 0.5, so a half-point threshold is ordinary rather than
		// exotic, and default number stringification must round-trip it.
		expect(
			buildLiqProtectionMessage({
				taskId: "t1",
				timestamp: TS,
				liqProtectionPct: 7.5,
			}),
		).toBe(
			"Set arbitrage liquidation protection: t1 liqProtectionPct=7.5 timestamp=1787555739",
		);
	});

	it("turning protection off signs a different string from any threshold", () => {
		expect(
			buildLiqProtectionMessage({
				taskId: "t1",
				timestamp: TS,
				liqProtectionPct: null,
			}),
		).not.toBe(
			buildLiqProtectionMessage({
				taskId: "t1",
				timestamp: TS,
				liqProtectionPct: 8,
			}),
		);
	});
});
