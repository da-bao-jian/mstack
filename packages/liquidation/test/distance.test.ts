// Cases from mobius@33ed2ece frontend/test/features/delta-neutral/deltaNeutralMath.test.ts
import { describe, expect, it } from "bun:test";
import {
	crossDistanceToLiqPct,
	distanceToLiqPct,
	estimateCrossLiquidationPrice,
	estimateLiquidationPrice,
	healthTone,
} from "../src/index.ts";

describe("health bands (§6)", () => {
	it("healthy ≥20, caution 8–20, danger <8", () => {
		expect(healthTone(20)).toBe("healthy");
		expect(healthTone(19.99)).toBe("caution");
		expect(healthTone(8)).toBe("caution");
		expect(healthTone(7.99)).toBe("danger");
	});
});

describe("distance to liquidation", () => {
	it("is |mark − liq| / mark", () => {
		expect(distanceToLiqPct(100, 80)).toBeCloseTo(20);
		expect(distanceToLiqPct(100, 120)).toBeCloseTo(20);
	});
	it("is null when liq price is missing/invalid", () => {
		expect(distanceToLiqPct(100, null)).toBeNull();
		expect(distanceToLiqPct(100, 0)).toBeNull();
	});
});

describe("cross-margin distance-to-liq (Lighter fallback)", () => {
	// The measure must be the SAME one distanceToLiqPct returns — percent of
	// mark — or the rebalance equalizes two different quantities. This is the
	// regression that mattered: the old formula returned equity/notional − mmf,
	// which read 95% where the price could really only move 90.5%.
	it("agrees with the venue's own liquidation price — short", () => {
		// size 1, mark 100 → notional 100, equity 100, mmf 5%.
		// Liquidates on the way up at (E + N) / (size · (1 + mmf)) = 190.476…
		const liq = (100 + 100) / (1 * 1.05);
		expect(crossDistanceToLiqPct(100, 100, 0.05, "short")).toBeCloseTo(
			distanceToLiqPct(100, liq) as number,
		);
		expect(crossDistanceToLiqPct(100, 100, 0.05, "short")).toBeCloseTo(
			90.476,
			2,
		);
	});

	it("agrees with the venue's own liquidation price — long", () => {
		// Same leg long: liquidates on the way DOWN at (N − E) / (size · (1 − mmf)).
		const liq = (100 - 60) / (1 * 0.95);
		expect(crossDistanceToLiqPct(60, 100, 0.05, "long")).toBeCloseTo(
			distanceToLiqPct(100, liq) as number,
		);
	});

	it("is not symmetric between sides — the notional moves with the price", () => {
		const short = crossDistanceToLiqPct(50, 100, 0.06, "short") as number;
		const long = crossDistanceToLiqPct(50, 100, 0.06, "long") as number;
		expect(short).not.toBeCloseTo(long);
		expect(long).toBeGreaterThan(short); // a falling price shrinks the requirement
	});

	it("is large (safe) for a well-collateralized leg — the Lighter=0 case", () => {
		// $22 leg on a well-funded account → miles from liq (why Lighter returns 0).
		expect(crossDistanceToLiqPct(500, 22, 0.05, "short")).toBeGreaterThan(100);
	});

	it("extrapolates past 100% for an unliquidatable long rather than clamping", () => {
		// equity ≥ notional: no price can liquidate it. The proposal still needs a
		// monotonic measure to solve against, so this must not saturate.
		const a = crossDistanceToLiqPct(120, 100, 0.06, "long") as number;
		const b = crossDistanceToLiqPct(140, 100, 0.06, "long") as number;
		expect(a).toBeGreaterThan(100);
		expect(b).toBeGreaterThan(a);
	});

	it("clamps to 0 rather than going negative", () => {
		expect(crossDistanceToLiqPct(1, 100, 0.05, "short")).toBe(0);
	});

	it("is null on invalid inputs", () => {
		expect(crossDistanceToLiqPct(100, 0, 0.05, "short")).toBeNull();
		expect(crossDistanceToLiqPct(100, 100, -1, "short")).toBeNull();
		expect(crossDistanceToLiqPct(100, 100, 1, "long")).toBeNull();
	});
});

describe("cross-margin liquidation estimate (§3 Details)", () => {
	// The regression Stanley caught: the Details panel priced every leg with the
	// ISOLATED formula, so a small position on a well-funded cross account looked
	// close to liquidation when it was nowhere near it.
	it("is far further out than the isolated estimate on a funded account", () => {
		// $400 notional at 5x on an account holding $2,000, long, mmf 3%.
		const isolated = estimateLiquidationPrice(100, 5, 0.03, "long") as number;
		const cross = estimateCrossLiquidationPrice(100, 2000, 400, 0.03, "long");
		expect(isolated).toBeCloseTo(83); // 1/5 − 3% = 17% below mark
		expect(cross).toBeNull(); // equity ≥ notional: no price can liquidate it
	});

	it("agrees with the isolated formula when equity IS just the position margin", () => {
		// Equity = notional/leverage is exactly the isolated case, so the two must
		// meet there — this is what pins the cross formula to something known.
		const notional = 400;
		const lev = 5;
		const cross = estimateCrossLiquidationPrice(
			100,
			notional / lev,
			notional,
			0,
			"long",
		);
		expect(cross).toBeCloseTo(
			estimateLiquidationPrice(100, lev, 0, "long") as number,
			6,
		);
	});

	it("prices a short above the mark and a long below it", () => {
		const short = estimateCrossLiquidationPrice(
			100,
			40,
			400,
			0.03,
			"short",
		) as number;
		const long = estimateCrossLiquidationPrice(
			100,
			40,
			400,
			0.03,
			"long",
		) as number;
		expect(short).toBeGreaterThan(100);
		expect(long).toBeLessThan(100);
	});

	it("moves further away as the account holds more equity", () => {
		const thin = estimateCrossLiquidationPrice(
			100,
			40,
			400,
			0.03,
			"short",
		) as number;
		const fat = estimateCrossLiquidationPrice(
			100,
			120,
			400,
			0.03,
			"short",
		) as number;
		expect(fat).toBeGreaterThan(thin);
	});

	it("is null on unusable inputs", () => {
		expect(estimateCrossLiquidationPrice(0, 100, 400, 0.03, "long")).toBeNull();
		expect(estimateCrossLiquidationPrice(100, 100, 0, 0.03, "long")).toBeNull();
	});
});
