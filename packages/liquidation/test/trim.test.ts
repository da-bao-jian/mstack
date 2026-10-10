// Cases from mobius@33ed2ece packages/liquidation/src/trim.test.ts
import { describe, expect, test } from "bun:test";
import { crossDistanceToLiqPct, type DnSide } from "../src/distance.ts";
import {
	distanceAfterTrimPct,
	LIQ_PROTECTION_DEFAULT_PCT,
	LIQ_PROTECTION_TARGET_MULT,
	largestUsableThresholdPct,
	liqProtectionTargetPct,
	NotImplementedError,
	protectionOpenBlock,
	trimFractionToTarget,
} from "../src/trim.ts";

describe("constants", () => {
	test("target multiple and default threshold match the PRD", () => {
		expect(LIQ_PROTECTION_TARGET_MULT).toBe(1.5);
		expect(LIQ_PROTECTION_DEFAULT_PCT).toBe(8);
	});

	test("the 8% default trims back to 12%", () => {
		expect(liqProtectionTargetPct(LIQ_PROTECTION_DEFAULT_PCT)).toBe(12);
	});
});

describe("trimFractionToTarget — round trip", () => {
	/**
	 * THE load-bearing test. The whole contract of `trimFractionToTarget` is
	 * "apply this fraction and the leg lands at the target", so the only honest
	 * check is to apply it and measure — via `crossDistanceToLiqPct`, which is
	 * the function the formula was inverted FROM.
	 *
	 * A test that merely re-stated the closed form would pass against a
	 * transcription error in the very expression it was copied from.
	 */
	test("over a grid of (equity, notional, mmf, side), the trim reaches the target exactly", () => {
		const notional = 10_000;
		const sides: DnSide[] = ["long", "short"];
		let checked = 0;

		for (const side of sides) {
			for (const mmf of [0, 0.005, 0.0125, 0.02, 0.05, 0.1]) {
				for (const targetPct of [6, 12, 20, 45]) {
					for (const startPct of [1, 3, 8, 11]) {
						if (startPct >= targetPct) continue;

						// Build an account whose distance really is `startPct`, by
						// inverting the same affine map the derivation uses.
						const k = side === "short" ? 1 + mmf : 1 - mmf;
						const x = (k * startPct) / 100 + mmf;
						const equity = x * notional;

						// Sanity: the constructed account is where we think it is.
						const d0 = crossDistanceToLiqPct(equity, notional, mmf, side);
						expect(d0).not.toBeNull();
						expect(d0 as number).toBeCloseTo(startPct, 9);

						const f = trimFractionToTarget(startPct, targetPct, mmf, side);
						expect(f).not.toBeNull();
						expect(f as number).toBeGreaterThan(0);
						expect(f as number).toBeLessThan(1);

						const after = distanceAfterTrimPct(
							equity,
							notional,
							mmf,
							side,
							f as number,
						);
						expect(after).not.toBeNull();
						expect(after as number).toBeCloseTo(targetPct, 9);
						checked++;
					}
				}
			}
		}
		// Guard against a grid that silently `continue`s its way to zero cases.
		expect(checked).toBeGreaterThan(100);
	});
});

describe("trimFractionToTarget — the numbers the PRD quotes", () => {
	/**
	 * The PRD says the 8% default is "a ~28% trim". It is, but only near
	 * mmf = 2%: the real answer runs from 33.3% at mmf 0 down to 23.2% at
	 * mmf 5% on a long. This table is here so that claim cannot be quietly
	 * promoted into a hardcoded 28 anywhere in the product.
	 */
	const cases: { mmf: number; side: DnSide; expected: number }[] = [
		{ mmf: 0, side: "short", expected: 1 / 3 },
		{ mmf: 0, side: "long", expected: 1 / 3 },
		{ mmf: 0.02, side: "short", expected: 0.2865168539325843 },
		{ mmf: 0.02, side: "long", expected: 0.28488372093023256 },
		{ mmf: 0.05, side: "short", expected: 0.23863636363636365 },
		{ mmf: 0.05, side: "long", expected: 0.23170731707317074 },
	];

	for (const { mmf, side, expected } of cases) {
		test(`8% → 12% at mmf ${mmf * 100}% on a ${side} trims ${(expected * 100).toFixed(1)}%`, () => {
			const f = trimFractionToTarget(8, 12, mmf, side);
			expect(f as number).toBeCloseTo(expected, 12);
		});
	}

	test("a short always trims at least as much as a long", () => {
		for (const mmf of [0, 0.01, 0.02, 0.05, 0.1]) {
			const short = trimFractionToTarget(8, 12, mmf, "short") as number;
			const long = trimFractionToTarget(8, 12, mmf, "long") as number;
			expect(short).toBeGreaterThanOrEqual(long);
		}
	});

	test("the required trim strictly decreases as mmf rises, on both sides", () => {
		for (const side of ["long", "short"] as DnSide[]) {
			const series = [0, 0.005, 0.0125, 0.02, 0.05, 0.1].map(
				(m) => trimFractionToTarget(8, 12, m, side) as number,
			);
			for (let i = 1; i < series.length; i++) {
				expect(series[i]).toBeLessThan(series[i - 1] as number);
			}
		}
	});
});

describe("trimFractionToTarget — unknown mmf is the conservative bound", () => {
	test("null mmf solves at mmf 0", () => {
		for (const side of ["long", "short"] as DnSide[]) {
			expect(trimFractionToTarget(8, 12, null, side)).toBe(
				trimFractionToTarget(8, 12, 0, side),
			);
		}
	});

	test("and that is the MAXIMUM over every real mmf — it over-trims, never under", () => {
		for (const side of ["long", "short"] as DnSide[]) {
			const unknown = trimFractionToTarget(8, 12, null, side) as number;
			for (const m of [0.005, 0.0125, 0.02, 0.05, 0.1, 0.25]) {
				expect(
					trimFractionToTarget(8, 12, m, side) as number,
				).toBeLessThanOrEqual(unknown);
			}
		}
	});
});

describe("trimFractionToTarget — edges", () => {
	test("already at or past the target trims nothing, and never returns a negative", () => {
		expect(trimFractionToTarget(12, 12, 0.05, "short")).toBe(0);
		expect(trimFractionToTarget(30, 12, 0.05, "short")).toBe(0);
		expect(trimFractionToTarget(30, 12, 0.05, "long")).toBe(0);
	});

	test("a solved fraction is always in [0, 1) — a trim is a partial close", () => {
		for (const side of ["long", "short"] as DnSide[]) {
			// A leg at 0% distance wanting a very large target is the extreme case.
			const f = trimFractionToTarget(0, 500, 0, side) as number;
			expect(f).toBeGreaterThanOrEqual(0);
			expect(f).toBeLessThanOrEqual(1);
		}
	});

	test("unusable inputs return null rather than a plausible number", () => {
		expect(trimFractionToTarget(Number.NaN, 12, 0.05, "short")).toBeNull();
		expect(trimFractionToTarget(-1, 12, 0.05, "short")).toBeNull();
		expect(trimFractionToTarget(8, 0, 0.05, "short")).toBeNull();
		expect(trimFractionToTarget(8, -12, 0.05, "short")).toBeNull();
		expect(trimFractionToTarget(8, 12, 1, "short")).toBeNull();
		expect(trimFractionToTarget(8, 12, 1.5, "short")).toBeNull();
		expect(trimFractionToTarget(8, 12, -0.01, "short")).toBeNull();
	});
});

describe("distanceAfterTrimPct", () => {
	test("a zero trim leaves the distance where it was", () => {
		const before = crossDistanceToLiqPct(1340, 10_000, 0.05, "short");
		expect(distanceAfterTrimPct(1340, 10_000, 0.05, "short", 0)).toBeCloseTo(
			before as number,
			12,
		);
	});

	test("rejects a full or over-full trim rather than dividing by zero", () => {
		expect(distanceAfterTrimPct(1340, 10_000, 0.05, "short", 1)).toBeNull();
		expect(distanceAfterTrimPct(1340, 10_000, 0.05, "short", 1.2)).toBeNull();
		expect(distanceAfterTrimPct(1340, 10_000, 0.05, "short", -0.1)).toBeNull();
	});
});

describe("protectionOpenBlock", () => {
	/**
	 * The PRD's own worked example, which is also the case that decides the
	 * boundary: a Hyperliquid leg opening 7.5% out under an 8% threshold blocks,
	 * and the message says "Use 5% or less".
	 */
	test("the PRD's example blocks and names 5%", () => {
		const hit = protectionOpenBlock([{ leg: "hl", openDistPct: 7.5 }], 8);
		expect(hit).not.toBeNull();
		expect(hit?.leg).toBe("hl");
		expect(hit?.openDistPct).toBe(7.5);
		expect(hit?.largestUsablePct).toBe(5);
	});

	test("and 5% is actually usable — the quoted number is not off by one tick", () => {
		// This is what makes the copy honest. An inclusive boundary would block
		// here too, leaving the largest usable value unquotable.
		expect(
			protectionOpenBlock([{ leg: "hl", openDistPct: 7.5 }], 5),
		).toBeNull();
	});

	test("a leg comfortably out does not block", () => {
		expect(protectionOpenBlock([{ leg: "hl", openDistPct: 40 }], 8)).toBeNull();
	});

	test("names the WORST leg, not the first", () => {
		const hit = protectionOpenBlock(
			[
				{ leg: "hl", openDistPct: 11 },
				{ leg: "lighter", openDistPct: 6 },
			],
			8,
		);
		expect(hit?.leg).toBe("lighter");
		expect(hit?.openDistPct).toBe(6);
	});

	test("a null distance never blocks — that is a loading spinner, not a breach", () => {
		expect(
			protectionOpenBlock([{ leg: "hl", openDistPct: null }], 8),
		).toBeNull();
		const hit = protectionOpenBlock(
			[
				{ leg: "hl", openDistPct: null },
				{ leg: "lighter", openDistPct: 6 },
			],
			8,
		);
		expect(hit?.leg).toBe("lighter");
	});

	test("no legs, or a nonsense threshold, is not a block", () => {
		expect(protectionOpenBlock([], 8)).toBeNull();
		expect(protectionOpenBlock([{ leg: "hl", openDistPct: 1 }], 0)).toBeNull();
		expect(
			protectionOpenBlock([{ leg: "hl", openDistPct: 1 }], Number.NaN),
		).toBeNull();
	});

	test("the named threshold always clears the block it was named for", () => {
		// The property the copy promises: taking the advice works. Checked across
		// a range rather than on the one example, since it is the whole contract.
		for (const dist of [0.4, 1, 2.5, 6, 7.5, 11.9, 30]) {
			const hit = protectionOpenBlock([{ leg: "x", openDistPct: dist }], 100);
			expect(hit).not.toBeNull();
			const advised = hit?.largestUsablePct as number;
			if (advised <= 0) continue; // Too close to liquidation for any threshold.
			expect(
				protectionOpenBlock([{ leg: "x", openDistPct: dist }], advised),
			).toBeNull();
		}
	});

	test("largestUsableThresholdPct floors to one decimal", () => {
		expect(largestUsableThresholdPct(7.5)).toBe(5);
		// 11.9 / 1.5 = 7.933… -> 7.9, a value a user can actually type.
		expect(largestUsableThresholdPct(11.9)).toBe(7.9);
	});
});

describe("scaffolded, not yet built", () => {
	/**
	 * Nothing in this module is a stub any more, but `NotImplementedError` stays
	 * exported: the funding-server's decision ladder and venue adapters still
	 * use the same convention, and a stub must be unmistakable when reached —
	 * never a null or a 0 that a caller reads as a real answer.
	 */
	test("NotImplementedError names what is missing", () => {
		expect(new NotImplementedError("decideLiqAction").message).toContain(
			"decideLiqAction",
		);
		expect(new NotImplementedError("x").name).toBe("NotImplementedError");
	});
});

describe("protectionOpenBlock — what the message needs to be honest", () => {
	test("reports the target, because the target is the REASON", () => {
		// A leg opening at 8.0% blocked by an 8% threshold reads as "8 is not
		// less than 8, why?" until the message can say it trims back to 12%.
		const hit = protectionOpenBlock([{ leg: "hl", openDistPct: 8 }], 8);
		expect(hit?.targetPct).toBeCloseTo(12, 9);
		expect(hit?.largestUsablePct).toBe(5.3);
	});

	test("the advised threshold is the largest that actually clears", () => {
		// Pinning the boundary: 5.4 would still trim at open, 5.3 would not.
		const dist = 8;
		expect(
			protectionOpenBlock([{ leg: "hl", openDistPct: dist }], 5.4),
		).not.toBeNull();
		expect(
			protectionOpenBlock([{ leg: "hl", openDistPct: dist }], 5.3),
		).toBeNull();
	});

	test("a distance too small to advise ANY threshold is flagged", () => {
		// floor(0.1 / 1.5, 1dp) = 0.0 — there is no number to quote, so
		// `largestUsablePct` must not be handed over as advice.
		const hit = protectionOpenBlock([{ leg: "hl", openDistPct: 0.1 }], 8);
		expect(hit?.largestUsablePct).toBe(0);
		expect(hit?.noWorkableThreshold).toBe(true);
	});

	test("a quotable threshold is never flagged, however thin the leg", () => {
		// 25x isolated: 2% to liquidation, advice 1.3%. This used to be flagged
		// as a dead end by comparing 1.3% against the venue's 2% maintenance
		// margin — a price distance from MARK against a margin ratio whose
		// price-axis meaning starts at the LIQUIDATION PRICE. The two segments do
		// not overlap and nothing derived the coefficient joining them, so the
		// rule is gone: 1.3% is a real, usable answer.
		const hit = protectionOpenBlock([{ leg: "hl", openDistPct: 2 }], 8);
		expect(hit?.largestUsablePct).toBe(1.3);
		expect(hit?.noWorkableThreshold).toBe(false);
	});
});
