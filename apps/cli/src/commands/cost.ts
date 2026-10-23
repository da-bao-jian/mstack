import { BOOKLESS_VENUES, fetchOrderBook } from "@mstack/funding";
import {
	canonicalTicker,
	type ExecutionCost,
	executionCost,
	groupAssets,
	MOB_VENUES,
} from "@mstack/opportunities";
import { getConfig, numberFlag, readConfig, UsageError } from "../config.ts";
import {
	type Runtime,
	selectedVenues,
	snapshot,
	withRateCount,
} from "./runtime.ts";

const DEFAULT_SIZES = [10_000, 100_000, 1_000_000];

export interface CostOptions {
	base?: string;
	/** Comma-separated USD sizes, at most four. */
	sizes?: string;
	side?: string;
	venues?: readonly string[];
}

function sizes(value: string | undefined): number[] {
	if (value === undefined) return DEFAULT_SIZES;
	const list = value
		.split(",")
		.map((item) => numberFlag(item.trim(), "size", 1));
	if (!list.length || list.length > 4)
		throw new UsageError("--size takes one to four USD sizes, comma-separated");
	if (list.some((size) => size > 50_000_000))
		throw new UsageError("--size is capped at 50000000");
	return [...new Set(list)].sort((a, b) => a - b);
}

export async function cost(options: CostOptions, rt: Runtime) {
	const config = await readConfig(rt.home);
	const raw = options.base?.trim();
	if (!raw || !/^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u.test(raw))
		throw new UsageError(
			"Usage: mob cost <BASE> [--size N[,N…]] [--side long|short]",
		);
	const side = options.side ?? "long";
	if (side !== "long" && side !== "short")
		throw new UsageError("--side must be long or short");
	const amounts = sizes(options.sizes);
	const ticker = canonicalTicker(raw);
	const venues = selectedVenues(options.venues);
	const input = await snapshot(venues, rt);
	const asset = groupAssets(input.rates).assets.find(
		(item) => item.ticker === ticker && item.variant === 1,
	);
	const rows = (asset?.rows ?? []).filter(
		(row) => row.quoteClass === "usd-stable",
	);
	const listed = new Set(rows.map((row) => row.venue));
	const failed: { venue: string; market?: string; error: string }[] = [
		...input.failed,
	];
	const bookless = rows
		.filter((row) => BOOKLESS_VENUES.includes(row.venue))
		.map((row) => `${row.venue}:${row.market}`);
	const results = await Promise.all(
		rows
			.filter((row) => !BOOKLESS_VENUES.includes(row.venue))
			.map(async (row) => {
				try {
					const book = await fetchOrderBook(row.venue, row.market, {
						fetch: rt.fetch,
						now: rt.now,
					});
					const takerFeeBps = Number(
						getConfig(config, `taker_fee_bps.${row.venue}`),
					);
					return {
						venue: row.venue,
						market: row.market,
						mob: MOB_VENUES.includes(row.venue),
						takerFeeBps,
						mid: (book.bids[0][0] + book.asks[0][0]) / 2,
						spreadBps:
							((book.asks[0][0] - book.bids[0][0]) /
								((book.bids[0][0] + book.asks[0][0]) / 2)) *
							10_000,
						truncated: book.truncated,
						...(row.volume24hUsd === undefined
							? {}
							: { volume24hUsd: row.volume24hUsd }),
						...(row.openInterestUsd === undefined
							? {}
							: { openInterestUsd: row.openInterestUsd }),
						costs: amounts.map((size) =>
							executionCost(book, size, side, takerFeeBps),
						),
					};
				} catch (error) {
					failed.push({
						venue: row.venue,
						market: row.market,
						error: error instanceof Error ? error.message : String(error),
					});
					return undefined;
				}
			}),
	);
	// Rank by the middle size: filled orders by cost, then partial fills by depth.
	const pivot = Math.floor(amounts.length / 2);
	const score = (row: { costs: ExecutionCost[] }) => row.costs[pivot];
	const view = results
		.flatMap((row) => (row ? [row] : []))
		.sort((a, b) => {
			const x = score(a);
			const y = score(b);
			if (x.costBps !== undefined && y.costBps !== undefined)
				return x.costBps - y.costBps;
			if (x.costBps !== undefined) return -1;
			if (y.costBps !== undefined) return 1;
			return y.filledUsd - x.filledUsd;
		});
	return withRateCount(
		{
			observedAt: input.observedAt,
			source: input.source,
			annualizationMethod: input.annualizationMethod,
			ticker,
			side: side as "long" | "short",
			sizes: amounts,
			view,
			bookless,
			notListed: venues
				.map((venue) => venue.venue)
				.filter((venue) => !listed.has(venue)),
			failed,
		},
		input.rates.length,
	);
}
