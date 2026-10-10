import { type FundingHistory, fetchFundingHistory } from "@mstack/funding";
import { classifyMarket } from "@mstack/opportunities";
import { numberFlag, readConfig, UsageError } from "../config.ts";
import {
	base,
	snapshot as fetchInput,
	type Runtime,
	selectedVenues,
	withRateCount,
} from "./runtime.ts";

export interface HistoryOptions {
	base: string;
	days?: number;
	venues?: readonly string[];
}

export async function history(options: HistoryOptions, rt: Runtime) {
	await readConfig(rt.home);
	const venues = selectedVenues(options.venues);
	const market = base(options.base);
	if (!market) throw new UsageError("Usage: mob history <BASE> [--days N]");
	const days = numberFlag(options.days ?? 7, "days", Number.MIN_VALUE);
	const snapshot = await fetchInput(venues, rt);
	const endTime = rt.now();
	const startTime = Math.floor(endTime - days * 86_400_000);
	if (startTime <= 0)
		throw new UsageError("History window starts before Unix time");
	const unmatched = snapshot.rates.filter(
		(row) => classifyMarket(row.venue, row.market) === null,
	);
	const matches = snapshot.rates.filter((row) => {
		const item = classifyMarket(row.venue, row.market);
		return (
			item?.base.toUpperCase() === market && item.quoteClass === "usd-stable"
		);
	});
	const unsupported = venues
		.filter((v) => v.venue.startsWith("lighter"))
		.map((v) => ({ venue: v.venue, reason: "no keyless history" }));
	const missing = venues
		.filter(
			(v) =>
				!v.venue.startsWith("lighter") &&
				!matches.some((r) => r.venue === v.venue),
		)
		.map((v) => ({
			venue: v.venue,
			reason: `no usd-stable listing for ${market} in snapshot`,
		}));
	const failed: { venue: string; market?: string; error: string }[] = [
		...snapshot.failed,
	];
	const history: FundingHistory[] = [];
	// Sequential per market keeps public history reads within venue rate limits.
	for (const row of matches) {
		if (row.venue.startsWith("lighter")) continue;
		try {
			history.push(
				await fetchFundingHistory(row.venue, row.market, {
					startTime,
					endTime,
					fetch: rt.fetch,
					now: rt.now,
				}),
			);
		} catch (error) {
			failed.push({
				venue: row.venue,
				market: row.market,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}
	let bestPair: {
		long: string;
		short: string;
		spreadRate1hPct: number;
		spreadAnnualizedPct: number;
	} | null = null;
	for (const long of history)
		for (const short of history) {
			if (
				long.venue === short.venue ||
				long.averageRatePerHour === null ||
				short.averageRatePerHour === null
			)
				continue;
			const spreadRate1hPct =
				(short.averageRatePerHour - long.averageRatePerHour) * 100;
			if (
				spreadRate1hPct > 0 &&
				(!bestPair || spreadRate1hPct > bestPair.spreadRate1hPct)
			)
				bestPair = {
					long: `${long.venue}:${long.market}`,
					short: `${short.venue}:${short.market}`,
					spreadRate1hPct,
					spreadAnnualizedPct: spreadRate1hPct * 8760,
				};
		}
	const data = {
		base: market,
		startTime,
		endTime,
		history,
		bestPair,
		unsupported,
		missing,
		failed,
		unmatched: unmatched.map(({ venue, market }) => ({ venue, market })),
		observedAt: snapshot.observedAt,
		source: snapshot.source,
		annualizationMethod: "simple",
	};
	return withRateCount(data, snapshot.rates.length);
}
