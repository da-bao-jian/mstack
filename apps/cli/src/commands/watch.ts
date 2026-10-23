import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	classifyMarket,
	normalizeFundingRatePerHour,
	pricesAgree,
	unitPrice,
} from "@mstack/opportunities";
import { readConfig, UsageError } from "../config.ts";
import {
	base,
	type Runtime,
	selectedVenues,
	snapshot,
	withRateCount,
} from "./runtime.ts";

// Saved pairs, kept in the mob home next to config.json. The file holds
// public market names only: no keys, owners or sizes.

/** Thresholds checked by `mob watch --check`; any can be absent. */
export interface Alert {
	/** Funding spread, simple annualized percent. */
	spreadAbove?: number;
	spreadBelow?: number;
	/** Price gap (short over long), percent. */
	gapAbove?: number;
}

export interface WatchedPair {
	base: string;
	long: string;
	short: string;
	addedAt: number;
	alert?: Alert;
}

const FILE = "watchlist.json";
const LIMIT = 50;

async function load(home: string): Promise<WatchedPair[]> {
	let text: string;
	try {
		text = await readFile(join(home, FILE), "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
	const body = JSON.parse(text) as { pairs?: unknown };
	if (!Array.isArray(body.pairs)) throw new Error(`${FILE}: expected pairs`);
	return body.pairs.map((value) => {
		const pair = value as Partial<WatchedPair>;
		if (
			typeof pair.base !== "string" ||
			typeof pair.long !== "string" ||
			typeof pair.short !== "string" ||
			typeof pair.addedAt !== "number" ||
			(pair.alert !== undefined &&
				(typeof pair.alert !== "object" ||
					Object.values(pair.alert).some(
						(value) => typeof value !== "number" || !Number.isFinite(value),
					)))
		)
			throw new Error(`${FILE}: invalid pair`);
		return pair as WatchedPair;
	});
}

async function save(home: string, pairs: WatchedPair[]): Promise<void> {
	await mkdir(home, { recursive: true, mode: 0o700 });
	const temporary = join(
		home,
		`${FILE}.${process.pid}.${crypto.randomUUID()}.tmp`,
	);
	await writeFile(
		temporary,
		`${JSON.stringify({ version: 1, pairs }, null, 2)}\n`,
		{
			mode: 0o600,
			flag: "wx",
		},
	);
	await chmod(temporary, 0o600);
	await rename(temporary, join(home, FILE));
}

/** venue:market with a supported venue; the market keeps its native spelling. */
function leg(value: string | undefined, name: string): string {
	const colon = value?.indexOf(":") ?? -1;
	if (!value || colon <= 0 || colon === value.length - 1)
		throw new UsageError(`--${name} must be venue:market`);
	selectedVenues([value.slice(0, colon)]);
	if (!classifyMarket(value.slice(0, colon), value.slice(colon + 1)))
		throw new UsageError(`--${name} ${value} is not a market mstack reads`);
	return value;
}

/** Thresholds from flags; an empty object clears the alert. */
function alert(options: {
	spreadAbove?: number;
	spreadBelow?: number;
	gapAbove?: number;
}): Alert | undefined {
	const result: Alert = {};
	for (const key of ["spreadAbove", "spreadBelow", "gapAbove"] as const) {
		const value = options[key];
		if (value === undefined) continue;
		if (!Number.isFinite(value)) throw new UsageError(`${key} must be finite`);
		result[key] = value;
	}
	return Object.keys(result).length ? result : undefined;
}

export async function watchAdd(
	options: {
		base?: string;
		long?: string;
		short?: string;
		spreadAbove?: number;
		spreadBelow?: number;
		gapAbove?: number;
	},
	rt: Runtime,
) {
	await readConfig(rt.home);
	const ticker = base(options.base);
	if (!ticker)
		throw new UsageError(
			"Usage: mob watch add <BASE> --long venue:market --short venue:market",
		);
	const long = leg(options.long, "long");
	const short = leg(options.short, "short");
	if (long === short) throw new UsageError("--long and --short must differ");
	const thresholds = alert(options);
	const pairs = await load(rt.home);
	const index = pairs.findIndex(
		(pair) => pair.long === long && pair.short === short,
	);
	// Saving a saved pair again updates its alert.
	if (index >= 0) {
		if (!thresholds) return { added: false, updated: false, pairs };
		const next = pairs.map((pair, i) =>
			i === index ? { ...pair, alert: thresholds } : pair,
		);
		await save(rt.home, next);
		return { added: false, updated: true, pairs: next };
	}
	if (pairs.length >= LIMIT)
		throw new UsageError(`The watchlist holds at most ${LIMIT} pairs`);
	const next = [
		...pairs,
		{
			base: ticker,
			long,
			short,
			addedAt: rt.now(),
			...(thresholds ? { alert: thresholds } : {}),
		},
	];
	await save(rt.home, next);
	return { added: true, updated: false, pairs: next };
}

export async function watchRemove(index: string | undefined, rt: Runtime) {
	await readConfig(rt.home);
	const pairs = await load(rt.home);
	const n = Number(index);
	if (!index || !Number.isSafeInteger(n) || n < 1 || n > pairs.length)
		throw new UsageError(
			pairs.length
				? `Usage: mob watch remove <1-${pairs.length}>`
				: "The watchlist is empty",
		);
	const removed = pairs[n - 1];
	await save(
		rt.home,
		pairs.filter((_, i) => i !== n - 1),
	);
	return { removed };
}

interface WatchRow extends WatchedPair {
	/** False when either market is missing from this snapshot. */
	found: boolean;
	spreadAnnualizedPct?: number;
	/** (short - long) / long from mark prices; positive means the short leg is rich. */
	priceGapPct?: number;
	/** Prices too far apart to be one asset. */
	priceMismatch?: boolean;
	longVolume24hUsd?: number;
	shortVolume24hUsd?: number;
	longOpenInterestUsd?: number;
	shortOpenInterestUsd?: number;
	/** Alert thresholds this pair crossed now, in words. */
	triggered?: string[];
}

function triggered(row: WatchRow): string[] {
	const out: string[] = [];
	const { alert: limits } = row;
	if (!limits || !row.found) return out;
	const spread = row.spreadAnnualizedPct;
	if (
		spread !== undefined &&
		limits.spreadAbove !== undefined &&
		spread > limits.spreadAbove
	)
		out.push(
			`funding spread ${spread.toFixed(2)}%/yr is above ${limits.spreadAbove}%`,
		);
	if (
		spread !== undefined &&
		limits.spreadBelow !== undefined &&
		spread < limits.spreadBelow
	)
		out.push(
			`funding spread ${spread.toFixed(2)}%/yr is below ${limits.spreadBelow}%`,
		);
	if (
		row.priceGapPct !== undefined &&
		limits.gapAbove !== undefined &&
		row.priceGapPct > limits.gapAbove
	)
		out.push(
			`price gap ${row.priceGapPct.toFixed(3)}% is above ${limits.gapAbove}%`,
		);
	return out;
}

export async function watchList(rt: Runtime) {
	await readConfig(rt.home);
	const pairs = await load(rt.home);
	const venues = [
		...new Set(
			pairs.flatMap((pair) =>
				[pair.long, pair.short].map((v) => v.slice(0, v.indexOf(":"))),
			),
		),
	];
	const input = venues.length
		? await snapshot(selectedVenues(venues), rt)
		: {
				observedAt: rt.now(),
				rates: [],
				listed: [],
				failed: [],
				source: "direct" as const,
				annualizationMethod: "simple" as const,
			};
	const rows = new Map(
		input.rates.map((row) => [`${row.venue}:${row.market}`, row]),
	);
	const view: WatchRow[] = pairs.map((pair) => {
		const long = rows.get(pair.long);
		const short = rows.get(pair.short);
		if (!long || !short) return { ...pair, found: false };
		const longClass = classifyMarket(long.venue, long.market);
		const shortClass = classifyMarket(short.venue, short.market);
		const longPrice = longClass ? unitPrice(long, longClass) : undefined;
		const shortPrice = shortClass ? unitPrice(short, shortClass) : undefined;
		return {
			...pair,
			found: true,
			spreadAnnualizedPct:
				(normalizeFundingRatePerHour(
					short.ratePerInterval,
					short.intervalHours,
				) -
					normalizeFundingRatePerHour(
						long.ratePerInterval,
						long.intervalHours,
					)) *
				100 *
				24 *
				365,
			...(longPrice && shortPrice
				? {
						priceGapPct: ((shortPrice - longPrice) / longPrice) * 100,
						...(pricesAgree(longPrice, shortPrice)
							? {}
							: { priceMismatch: true }),
					}
				: {}),
			...(long.volume24hUsd === undefined
				? {}
				: { longVolume24hUsd: long.volume24hUsd }),
			...(short.volume24hUsd === undefined
				? {}
				: { shortVolume24hUsd: short.volume24hUsd }),
			...(long.openInterestUsd === undefined
				? {}
				: { longOpenInterestUsd: long.openInterestUsd }),
			...(short.openInterestUsd === undefined
				? {}
				: { shortOpenInterestUsd: short.openInterestUsd }),
		};
	});
	const checked = view.map((row) => {
		const hits = triggered(row);
		return hits.length ? { ...row, triggered: hits } : row;
	});
	return withRateCount(
		{
			observedAt: input.observedAt,
			source: input.source,
			annualizationMethod: input.annualizationMethod,
			failed: input.failed,
			view: checked,
			alerts: checked.filter((row) => row.triggered).length,
		},
		// An empty watchlist is a healthy answer, not a failed read.
		pairs.length ? input.rates.length : 1,
	);
}
