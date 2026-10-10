import { expect, test } from "bun:test";
import {
	baseToUsd,
	HL_MIN_ORDER_VALUE_USD,
	planResize,
	quantizeBaseDown,
	quantizeBaseUp,
	quantizeTargetTowardCurrent,
	usdToBase,
} from "../src/preflight/resizePlan.ts";
import hash from "./fixtures/resize-plan-sha256.json";

test("resize planner retains upstream source through planResize", async () => {
	const source = await Bun.file(
		new URL("../src/preflight/resizePlan.ts", import.meta.url),
	).text();
	const header =
		"// Ported from mobius@33ed2ece frontend/src/features/delta-neutral/lib/resizePlan.ts\n";
	expect(source.startsWith(header)).toBe(true);
	expect(
		new Bun.CryptoHasher("sha256")
			.update(source.slice(header.length))
			.digest("hex"),
	).toBe(hash);
});
// resizePlan.test.ts is absent from the supplied upstream tree. These pin the
// concrete examples in resizePlan.ts and its 1e-9 floating-point guard instead.
test("upstream resize examples: fine BTC precision and rounding toward current", () => {
	expect(quantizeTargetTowardCurrent(0.00016, 0.00032, 5)).toBe(0.00016);
	expect(quantizeTargetTowardCurrent(12.347, 10, 2)).toBe(12.34);
	expect(quantizeTargetTowardCurrent(12.347, 15, 2)).toBe(12.35);
	expect(quantizeBaseDown(0.29, 2)).toBe(0.29);
	expect(quantizeBaseUp(0.07, 2)).toBe(0.07);
	expect(quantizeBaseDown(Number.NaN, 2)).toBe(0);
	expect(quantizeBaseUp(-1, 2)).toBe(0);
	expect(HL_MIN_ORDER_VALUE_USD).toBe(10);
	expect(baseToUsd(0.01, 100000)).toBe(1000);
	expect(usdToBase(1000, 100000)).toBe(0.01);
	expect(baseToUsd(1, null)).toBeNull();
	expect(usdToBase(1, 0)).toBeNull();
});
test("linked pair uses coarser lot; unread precision cannot invert a reduce", () => {
	const long = {
		side: "long" as const,
		currentBase: 1,
		markPrice: 100,
		minBase: 0,
		minNotionalUsd: 0,
		sizeDecimals: 2,
	};
	const short = { ...long, side: "short" as const, sizeDecimals: 3 };
	const linked = planResize({
		long,
		short,
		targets: { long: 1.2345, short: 1.2345 },
		linked: true,
	});
	expect(linked.legs.long?.targetBase).toBe(1.23);
	expect(linked.legs.short?.targetBase).toBe(1.23);
	expect(linked.neutral).toBe(true);
	const unknown = planResize({
		long: { ...long, sizeDecimals: null },
		short,
		targets: { long: 0.5, short: null },
		linked: false,
	});
	expect(unknown.submittable).toBe(false);
	expect(unknown.problems[0]?.kind).toBe("precision-unknown");
});
