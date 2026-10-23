import type { Candle } from "@mstack/funding";

// The price spread between two markets over time: B over A, in percent,
// from closes at the same open time, per base unit. The legs can be one
// asset on two venues or two assets, such as WTI and Brent.

export interface SpreadPoint {
	time: number;
	a: number;
	b: number;
	/** (b − a) / a × 100. */
	spreadPct: number;
}

export interface SpreadStats {
	points: number;
	last: number;
	mean: number;
	min: number;
	max: number;
	/** Share of points at or below the last value, in percent. */
	lastPercentile: number;
}

export function spreadSeries(
	a: readonly Candle[],
	b: readonly Candle[],
	aMultiplier = 1,
	bMultiplier = 1,
): SpreadPoint[] {
	const right = new Map(
		b.map((candle) => [candle.time, candle.close / bMultiplier]),
	);
	return a.flatMap((candle) => {
		const other = right.get(candle.time);
		if (other === undefined) return [];
		const price = candle.close / aMultiplier;
		return [
			{
				time: candle.time,
				a: price,
				b: other,
				spreadPct: ((other - price) / price) * 100,
			},
		];
	});
}

export function spreadStats(
	points: readonly SpreadPoint[],
): SpreadStats | null {
	if (!points.length) return null;
	const values = points.map((point) => point.spreadPct);
	const last = values[values.length - 1];
	return {
		points: values.length,
		last,
		mean: values.reduce((sum, value) => sum + value, 0) / values.length,
		min: Math.min(...values),
		max: Math.max(...values),
		lastPercentile:
			(values.filter((value) => value <= last).length / values.length) * 100,
	};
}
