import {
	CANDLE_INTERVALS,
	type CandleInterval,
	fetchCandles,
} from "@mstack/funding";
import {
	classifyMarket,
	spreadSeries,
	spreadStats,
} from "@mstack/opportunities";
import { numberFlag, readConfig, UsageError } from "../config.ts";
import { type Runtime, selectedVenues } from "./runtime.ts";

const MAX_DAYS: Record<CandleInterval, number> = {
	"15m": 7,
	"1h": 60,
	"4h": 180,
	"1d": 365,
};

export interface SpreadOptions {
	a?: string;
	b?: string;
	interval?: string;
	days?: number;
}

function leg(value: string | undefined, name: string) {
	const colon = value?.indexOf(":") ?? -1;
	if (!value || colon <= 0 || colon === value.length - 1)
		throw new UsageError(`${name} must be venue:market`);
	const venue = value.slice(0, colon);
	const market = value.slice(colon + 1);
	selectedVenues([venue]);
	const classification = classifyMarket(venue, market);
	if (!classification)
		throw new UsageError(`${value} is not a market mstack reads`);
	return { venue, market, multiplier: classification.contractMultiplier };
}

/** `mob spread A B`: B over A from aligned candle closes. */
export async function spread(options: SpreadOptions, rt: Runtime) {
	await readConfig(rt.home);
	const a = leg(options.a, "the first leg");
	const b = leg(options.b, "the second leg");
	if (a.venue === b.venue && a.market === b.market)
		throw new UsageError("Choose two different markets");
	const interval = (options.interval ?? "1h") as CandleInterval;
	if (!CANDLE_INTERVALS.includes(interval))
		throw new UsageError(
			`--interval must be one of ${CANDLE_INTERVALS.join(", ")}`,
		);
	const days = numberFlag(options.days ?? 7, "days", Number.MIN_VALUE);
	if (days > MAX_DAYS[interval])
		throw new UsageError(
			`--days is capped at ${MAX_DAYS[interval]} for ${interval} candles`,
		);
	const endTime = rt.now();
	const startTime = Math.floor(endTime - days * 86_400_000);
	const read = (side: typeof a) =>
		fetchCandles(side.venue, side.market, {
			interval,
			startTime,
			endTime,
			fetch: rt.fetch,
			now: rt.now,
		});
	const [left, right] = await Promise.all([read(a), read(b)]);
	const points = spreadSeries(
		left.candles,
		right.candles,
		a.multiplier,
		b.multiplier,
	);
	return {
		a: `${a.venue}:${a.market}`,
		b: `${b.venue}:${b.market}`,
		interval,
		startTime,
		endTime,
		observedAt: Math.max(left.observedAt, right.observedAt),
		candles: { a: left.candles.length, b: right.candles.length },
		stats: spreadStats(points),
		points,
	};
}
