import { expect, test } from "bun:test";
import {
	crossDistanceToLiqPct,
	distanceToLiqPct,
	protectionOpenBlock,
	trimFractionToTarget,
} from "../src/index.ts";
import hashes from "./upstream-hashes.json";

test.each(Object.entries(hashes))(
	"%s retains the complete upstream source",
	async (name, hash) => {
		const source = await Bun.file(
			new URL(`../src/${name}.ts`, import.meta.url),
		).text();
		const header = `// Ported from mobius@33ed2ece packages/liquidation/src/${name}.ts\n`;
		expect(source.startsWith(header)).toBe(true);
		expect(
			new Bun.CryptoHasher("sha256")
				.update(source.slice(header.length))
				.digest("hex"),
		).toBe(hash);
	},
);

test("hand-computed distance, boundary and trim examples", () => {
	expect(distanceToLiqPct(200, 150)).toBe(25);
	expect(crossDistanceToLiqPct(250, 1000, 0.05, "long")).toBeCloseTo(
		(100 * 0.2) / 0.95,
		12,
	);
	expect(crossDistanceToLiqPct(250, 1000, 0.05, "short")).toBeCloseTo(
		(100 * 0.2) / 1.05,
		12,
	);
	expect(
		protectionOpenBlock([{ leg: "long", openDistPct: 7.5 }], 5),
	).toBeNull();
	expect(protectionOpenBlock([{ leg: "long", openDistPct: 7.5 }], 6)).toEqual({
		leg: "long",
		openDistPct: 7.5,
		targetPct: 9,
		largestUsablePct: 5,
		noWorkableThreshold: false,
	});
	expect(trimFractionToTarget(8, 12, 0, "long")).toBeCloseTo(1 / 3, 12);
	expect(trimFractionToTarget(8, 12, 0.05, "short")).toBeCloseTo(
		4.2 / 17.6,
		12,
	);
});
