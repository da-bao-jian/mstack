import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ObservedFundingRate, Snapshot } from "@mstack/funding";
import { fetchSnapshot } from "@mstack/funding";
import { classifyMarket, rankOpportunities } from "@mstack/opportunities";
import { selectedVenues } from "./commands/runtime.ts";
import { getConfig, readConfig } from "./config.ts";
import type { Runtime } from "./run.ts";

export const HOME_MARKET_BUDGET_MS = 5_000;
const CACHE_FILE = "home-market.json";
const EXECUTABLE_VENUES = new Set([
	"hl",
	"lighter",
	"lighter-mainnet",
	"aster",
]);

interface HomeTopPair {
	base: string;
	longVenue: string;
	shortVenue: string;
	netApyPct: number;
	volume24hUsd?: number;
}
interface HomeTrending {
	base: string;
	volume24hUsd: number;
	annualizedPct: number;
	openInterestUsd?: number;
	priceChange24hPct?: number;
}
export interface HomeMarket {
	topPairs: HomeTopPair[];
	trending: HomeTrending[];
	freshness: {
		state: "live" | "cached" | "offline";
		observedAt?: number;
		ageMs?: number;
		durationMs?: number;
		succeeded: number;
		total: number;
		failed: string[];
	};
}

interface Cache {
	version: 1;
	observedAt: number;
	topPairs: HomeTopPair[];
	trending: HomeTrending[];
}

function baseOf(row: ObservedFundingRate): string | null {
	return classifyMarket(row.venue, row.market)?.base ?? null;
}

function trending(rates: ObservedFundingRate[]): HomeTrending[] {
	const groups = new Map<string, ObservedFundingRate[]>();
	for (const row of rates) {
		if (!EXECUTABLE_VENUES.has(row.venue)) continue;
		const base = baseOf(row);
		if (!base || row.volume24hUsd === undefined) continue;
		groups.set(base, [...(groups.get(base) ?? []), row]);
	}
	return [...groups.entries()]
		.map(([base, rows]) => {
			const volume24hUsd = rows.reduce(
				(sum, row) => sum + (row.volume24hUsd ?? 0),
				0,
			);
			const weighted = (
				pick: (row: ObservedFundingRate) => number | undefined,
			) => {
				const known = rows.filter((row) => pick(row) !== undefined);
				const weight = known.reduce(
					(sum, row) => sum + (row.volume24hUsd ?? 0),
					0,
				);
				return known.length && weight > 0
					? known.reduce(
							(sum, row) =>
								sum + (pick(row) as number) * (row.volume24hUsd ?? 0),
							0,
						) / weight
					: undefined;
			};
			return {
				base,
				volume24hUsd,
				annualizedPct: weighted((row) => row.annualizedPct) ?? 0,
				...(rows.some((row) => row.openInterestUsd !== undefined)
					? {
							openInterestUsd: rows.reduce(
								(sum, row) => sum + (row.openInterestUsd ?? 0),
								0,
							),
						}
					: {}),
				...(weighted((row) => row.priceChange24hPct) === undefined
					? {}
					: { priceChange24hPct: weighted((row) => row.priceChange24hPct) }),
			};
		})
		.sort((a, b) => b.volume24hUsd - a.volume24hUsd)
		.slice(0, 3);
}

async function derive(rt: Runtime, snapshot: Snapshot): Promise<Cache> {
	let config = {};
	try {
		config = await readConfig(rt.home);
	} catch {
		// A malformed account config must not hide public market data.
	}
	const sizeUsd = Number(getConfig(config, "default_size_usd"));
	const ranked = rankOpportunities(snapshot, {
		sizeUsd,
		holdDays: 7,
		takerFeeBps: (config as { taker_fee_bps?: Record<string, number> })
			.taker_fee_bps,
		builderFeeTenthsBps: Number(getConfig(config, "builder_fee_tenths_bps")),
	});
	const seenBases = new Set<string>();
	const top = ranked.opportunities.filter((row) => {
		if (!row.executable || row.netApyPct === null || seenBases.has(row.base))
			return false;
		seenBases.add(row.base);
		return true;
	});
	return {
		version: 1,
		observedAt: snapshot.observedAt,
		topPairs: top.slice(0, 3).map((row) => ({
			base: row.base,
			longVenue: row.long.venue,
			shortVenue: row.short.venue,
			netApyPct: row.netApyPct as number,
			...([row.long.volume24hUsd, row.short.volume24hUsd].every(
				(value) => value !== undefined,
			)
				? {
						volume24hUsd: Math.min(
							row.long.volume24hUsd as number,
							row.short.volume24hUsd as number,
						),
					}
				: {}),
		})),
		trending: trending(snapshot.rates),
	};
}

function validCache(value: unknown): value is Cache {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const cache = value as Partial<Cache>;
	return (
		cache.version === 1 &&
		Number.isFinite(cache.observedAt) &&
		Array.isArray(cache.topPairs) &&
		Array.isArray(cache.trending)
	);
}

async function readCache(home: string): Promise<Cache | null> {
	try {
		const value: unknown = JSON.parse(
			await readFile(join(home, CACHE_FILE), "utf8"),
		);
		return validCache(value) ? value : null;
	} catch {
		return null;
	}
}

async function writeCache(home: string, cache: Cache): Promise<void> {
	try {
		await mkdir(home, { recursive: true, mode: 0o700 });
		const temporary = join(
			home,
			`home-market.${process.pid}.${crypto.randomUUID()}.tmp`,
		);
		await writeFile(temporary, `${JSON.stringify(cache)}\n`, {
			mode: 0o600,
			flag: "wx",
		});
		await chmod(temporary, 0o600);
		await rename(temporary, join(home, CACHE_FILE));
	} catch {
		// The greeting remains useful when a read-only home cannot cache public data.
	}
}

function fromCache(cache: Cache, now: number): HomeMarket {
	return {
		topPairs: cache.topPairs,
		trending: cache.trending,
		freshness: {
			state: "cached",
			observedAt: cache.observedAt,
			ageMs: Math.max(0, now - cache.observedAt),
			succeeded: 0,
			total: selectedVenues().length,
			failed: [],
		},
	};
}

export async function collectHomeMarket(
	rt: Runtime,
	options: { offline?: boolean } = {},
): Promise<HomeMarket> {
	const now = rt.now();
	if (options.offline) {
		const cache = await readCache(rt.home);
		return cache
			? fromCache(cache, now)
			: {
					topPairs: [],
					trending: [],
					freshness: {
						state: "offline",
						succeeded: 0,
						total: selectedVenues().length,
						failed: [],
					},
				};
	}
	const venues = selectedVenues();
	const started = performance.now();
	const snapshot = rt.homeServices?.marketSnapshot
		? await rt.homeServices.marketSnapshot(HOME_MARKET_BUDGET_MS)
		: await fetchSnapshot(venues, {
				timeoutMs: HOME_MARKET_BUDGET_MS,
				fetch: rt.fetch,
				now: rt.now,
			});
	const durationMs = performance.now() - started;
	const returned = new Set(snapshot.rates.map((row) => row.venue));
	if (snapshot.rates.length) {
		const cache = await derive(rt, snapshot);
		await writeCache(rt.home, cache);
		const failed = [
			...new Set(
				snapshot.failed
					.filter((item) => !returned.has(item.venue))
					.map((item) => item.venue),
			),
		];
		return {
			topPairs: cache.topPairs,
			trending: cache.trending,
			freshness: {
				state: "live",
				observedAt: cache.observedAt,
				durationMs,
				succeeded: returned.size,
				total: venues.length,
				failed,
			},
		};
	}
	const cache = await readCache(rt.home);
	return cache
		? fromCache(cache, now)
		: {
				topPairs: [],
				trending: [],
				freshness: {
					state: "offline",
					durationMs,
					succeeded: 0,
					total: venues.length,
					failed: [...new Set(snapshot.failed.map((item) => item.venue))],
				},
			};
}
