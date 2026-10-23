import type { PriceGap } from "@mstack/opportunities";
import { lineChart } from "./chart.ts";
import type { cost } from "./commands/cost.ts";
import type { AssetView, market, markets, venues } from "./commands/markets.ts";
import type { oil } from "./commands/oil.ts";
import type { spread } from "./commands/spread.ts";
import type { watchList } from "./commands/watch.ts";
import { number, paint, relative, type Terminal, usd } from "./format.ts";
import { pct, REALIZED_HEADERS, realizedCells, table } from "./render.ts";

type Result<F extends (...args: never[]) => unknown> = Awaited<ReturnType<F>>;

/** A sum some markets did not report is a lower bound: ≥$1.2B. */
function bound(value: number | undefined, missing: number): string {
	if (value === undefined) return "—";
	return `${missing ? "≥" : ""}${usd(value)}`;
}

function signed(value: number, digits = 2): string {
	return `${value > 0 && Number(Math.abs(value).toFixed(digits)) !== 0 ? "+" : ""}${pct(value, digits)}`;
}

function price(value: number): string {
	return number(value, value >= 100 ? 2 : 4);
}

function assetName(asset: Pick<AssetView, "ticker" | "variant">): string {
	return asset.variant > 1 ? `${asset.ticker} #${asset.variant}` : asset.ticker;
}

export function renderVenues(result: Result<typeof venues>): string {
	const { totals } = result;
	return [
		`${result.view.length} venues · ${bound(totals.volume24hUsd, totals.missingVolume)} 24h volume · ${bound(totals.openInterestUsd, totals.missingOpenInterest)} open interest`,
		table(
			["venue", "name", "type", "MoB", "markets", "vol 24h", "OI", "taker fee"],
			result.view.map((row) => [
				row.venue,
				row.name,
				row.kind.toUpperCase(),
				row.mob ? "yes" : "—",
				row.markets,
				bound(row.volume24hUsd, row.missingVolume),
				bound(row.openInterestUsd, row.missingOpenInterest),
				`${number(row.takerFeeBps, 1)} bps`,
			]),
		),
	].join("\n");
}

function assetTable(view: AssetView[]): string {
	return table(
		["asset", "name", "class", "venues", "vol 24h", "OI", "best funding APR"],
		view.map((asset) => [
			assetName(asset),
			asset.name ?? "",
			asset.class === "rwa" ? `RWA ${asset.category ?? ""}`.trim() : "crypto",
			asset.venues,
			bound(asset.volume24hUsd, asset.missingVolume),
			bound(asset.openInterestUsd, asset.missingOpenInterest),
			`${signed(asset.bestFunding.annualizedPct)} ${asset.bestFunding.venue}:${asset.bestFunding.market}`,
		]),
	);
}

export function renderMarkets(
	result: Result<typeof markets>,
	terminal: Terminal = {},
): string {
	const { counts, totals } = result;
	const split =
		result.scope === "all"
			? ` · crypto ${number(counts.crypto, 0)} · RWA ${number(counts.rwa, 0)}`
			: "";
	const lines = [
		`${number(counts.assets, 0)} ${result.scope === "rwa" ? "RWA assets" : result.scope === "crypto" ? "crypto assets" : "assets"} · ${usd(totals.volume24hUsd)} 24h volume · ${totals.missingOpenInterest ? "≥" : ""}${usd(totals.openInterestUsd)} open interest${split}`,
	];
	if (result.categories)
		lines.push(
			paint("By category", "sky", terminal),
			table(
				["category", "assets", "vol 24h", "OI"],
				result.categories.map((row) => [
					row.category,
					row.assets,
					usd(row.volume24hUsd),
					usd(row.openInterestUsd),
				]),
			),
		);
	if (result.farm)
		lines.push(
			paint("Funding farm", "sky", terminal),
			`${result.farm.base}: long ${result.farm.long}, short ${result.farm.short} · ${signed(result.farm.spreadAnnualizedPct)} spread/yr · net APY ${result.farm.netApyPct === null ? "—" : signed(result.farm.netApyPct)}${result.farm.executable ? " · executable on MoB" : ""}`,
		);
	lines.push(
		paint(
			counts.matching > result.view.length
				? `Top ${result.view.length} of ${number(counts.matching, 0)}`
				: `${number(counts.matching, 0)} assets`,
			"sky",
			terminal,
		),
		result.view.length ? assetTable(result.view) : "No assets match.",
	);
	return lines.join("\n");
}

export function renderMarket(
	result: Result<typeof market>,
	now: number,
	terminal: Terminal = {},
): string {
	if (!result.assets.length)
		return `No market lists ${result.ticker} on the venues mstack reads.`;
	return result.assets
		.map((asset) => {
			const title = [
				assetName(asset),
				asset.name,
				asset.class === "rwa" ? `RWA ${asset.category ?? ""}`.trim() : "crypto",
			]
				.filter(Boolean)
				.join(" · ");
			const facts = [
				`${asset.venues} venues`,
				`${bound(asset.volume24hUsd, asset.missingVolume)} 24h volume`,
				`${bound(asset.openInterestUsd, asset.missingOpenInterest)} open interest`,
				...(asset.priceRangePct === undefined
					? []
					: [`prices ${pct(asset.priceRangePct, 2)} apart`]),
			].join(" · ");
			return [
				paint(title, "sky", terminal),
				facts,
				...(asset.widest
					? [
							`Widest funding spread: long ${asset.widest.long}, short ${asset.widest.short} · ${signed(asset.widest.spreadAnnualizedPct)}/yr`,
						]
					: []),
				table(
					[
						"venue:market",
						"price",
						"vol 24h",
						"share",
						"OI",
						"funding",
						"APR",
						"next funding",
						"MoB",
					],
					asset.rows.map((row) => [
						`${row.venue}:${row.market}`,
						row.price === undefined
							? "—"
							: number(row.price, row.price >= 100 ? 2 : 4),
						usd(row.volume24hUsd),
						row.volumeSharePct === undefined ? "—" : pct(row.volumeSharePct, 1),
						usd(row.openInterestUsd),
						`${signed(row.ratePerInterval * 100, 4)} /${row.intervalHours}h`,
						signed(row.annualizedPct),
						row.nextFundingAt === undefined
							? "—"
							: relative(row.nextFundingAt, now),
						row.mob ? "yes" : "—",
					]),
				),
			].join("\n");
		})
		.join("\n\n");
}

type WithRealized = PriceGap & {
	realized?: { d1: number | null; d7: number | null; d30: number | null };
};

function gapTable(view: WithRealized[]): string {
	const realized = view.some((row) => row.realized);
	return table(
		[
			"base",
			"long (cheap)",
			"short (rich)",
			"gap",
			"after fees",
			"funding/yr",
			...(realized ? REALIZED_HEADERS : []),
			"vol24h (long/short)",
			"OI (long/short)",
			"flags",
		],
		view.map((row) => [
			row.base,
			`${row.long.venue}:${row.long.market}`,
			`${row.short.venue}:${row.short.market}`,
			pct(row.gapPct, 3),
			signed(row.gapAfterFeesPct, 3),
			signed(row.fundingSpreadAnnualizedPct),
			...(realized ? realizedCells(row) : []),
			`${usd(row.long.volume24hUsd)}/${usd(row.short.volume24hUsd)}`,
			`${usd(row.long.openInterestUsd)}/${usd(row.short.openInterestUsd)}`,
			row.flags.join(",") || "—",
		]),
	);
}

export function renderPriceScan(
	view: { executable: WithRealized[]; anywhere: WithRealized[] },
	executableOnly = false,
	terminal: Terminal = {},
): string {
	return [
		"Price gaps from mark prices: buy the cheap leg, sell the rich one. Fills depend on each order book.",
		paint("Executable on MoB", "sky", terminal),
		view.executable.length ? gapTable(view.executable) : "None.",
		...(executableOnly
			? []
			: [paint("\nBest anywhere", "sky", terminal), gapTable(view.anywhere)]),
	].join("\n");
}

export function renderWatch(result: Result<typeof watchList>): string {
	if (!result.view.length)
		return "No saved pairs. Save one with: mob watch add <BASE> --long venue:market --short venue:market";
	const limits = (row: (typeof result.view)[number]) =>
		row.alert
			? [
					row.alert.spreadAbove === undefined
						? ""
						: `spread > ${row.alert.spreadAbove}%`,
					row.alert.spreadBelow === undefined
						? ""
						: `spread < ${row.alert.spreadBelow}%`,
					row.alert.gapAbove === undefined
						? ""
						: `gap > ${row.alert.gapAbove}%`,
				]
					.filter(Boolean)
					.join(", ")
			: "—";
	return table(
		[
			"#",
			"base",
			"long",
			"short",
			"funding/yr",
			"price gap",
			"vol24h (long/short)",
			"OI (long/short)",
			"alert",
			"note",
		],
		result.view.map((row, index) => [
			index + 1,
			row.base,
			row.long,
			row.short,
			row.spreadAnnualizedPct === undefined
				? "—"
				: signed(row.spreadAnnualizedPct),
			row.priceGapPct === undefined ? "—" : signed(row.priceGapPct, 3),
			`${usd(row.longVolume24hUsd)}/${usd(row.shortVolume24hUsd)}`,
			`${usd(row.longOpenInterestUsd)}/${usd(row.shortOpenInterestUsd)}`,
			limits(row),
			!row.found
				? "not listed now"
				: row.priceMismatch
					? "different assets"
					: row.triggered
						? "ALERT"
						: "—",
		]),
	);
}

function size(value: number): string {
	return usd(value).replace(".0K", "K").replace(".0M", "M");
}

export function renderCost(
	result: Result<typeof cost>,
	terminal: Terminal = {},
): string {
	const lines = [
		paint(
			`${result.ticker} · ${result.side === "long" ? "buy (long)" : "sell (short)"} by market order · cost = distance from mid + taker fee`,
			"sky",
			terminal,
		),
	];
	if (!result.view.length) {
		lines.push(`No order book for ${result.ticker} could be read.`);
		return lines.join("\n");
	}
	lines.push(
		table(
			[
				"venue:market",
				...result.sizes.map((value) => `cost ${size(value)}`),
				"spread",
				"taker fee",
				"vol 24h",
				"OI",
				"MoB",
			],
			result.view.map((row) => [
				`${row.venue}:${row.market}`,
				...row.costs.map((fill) =>
					fill.costBps !== undefined && fill.costUsd !== undefined
						? `$${number(fill.costUsd, fill.costUsd >= 100 ? 0 : 2)} · ${number(fill.costBps, 2)} bps`
						: row.truncated
							? `> book (${size(fill.filledUsd)} shown)`
							: `book has ${size(fill.filledUsd)}`,
				),
				`${number(row.spreadBps, 2)} bps`,
				`${number(row.takerFeeBps, 1)} bps`,
				usd(row.volume24hUsd),
				usd(row.openInterestUsd),
				row.mob ? "yes" : "—",
			]),
		),
	);
	return lines.join("\n");
}

export function renderSpread(
	result: Result<typeof spread>,
	terminal: Terminal = {},
): string {
	const days = Math.round((result.endTime - result.startTime) / 86_400_000);
	const lines = [
		paint(
			`Spread: ${result.b} over ${result.a} · ${result.interval} candles · ${days} ${days === 1 ? "day" : "days"} · (B − A) / A`,
			"sky",
			terminal,
		),
	];
	const { stats, points } = result;
	if (!stats) {
		lines.push(
			`No candles line up: ${result.a} has ${result.candles.a}, ${result.b} has ${result.candles.b}.`,
		);
		return lines.join("\n");
	}
	lines.push(
		...lineChart(
			points.map((point) => point.spreadPct),
			{ format: (value) => signed(value, 2) },
		),
		`now ${signed(stats.last, 3)} · mean ${signed(stats.mean, 3)} · range ${signed(stats.min, 3)} to ${signed(stats.max, 3)} · now is at or above ${number(stats.lastPercentile, 0)}% of the window · ${stats.points} points`,
		`last prices per base unit: A ${price(points[points.length - 1].a)} · B ${price(points[points.length - 1].b)}`,
	);
	return lines.join("\n");
}

export function renderOil(
	result: Result<typeof oil>,
	terminal: Terminal = {},
): string {
	const lines = [
		paint(
			"WTI vs Brent crude · marks per barrel · funding per year",
			"sky",
			terminal,
		),
	];
	if (result.premium)
		lines.push(
			`Brent trades ${signed(result.premium.min, 2)} to ${signed(result.premium.max, 2)} over WTI across venues that list both.`,
		);
	if (result.best)
		lines.push(
			`Best carry: ${result.best.direction} · long ${result.best.long}, short ${result.best.short} · ${signed(result.best.carryPct)}/yr${result.best.mob ? " · executable on MoB" : ""}`,
		);
	lines.push(
		table(
			[
				"venue",
				"WTI",
				"price",
				"APR",
				"Brent",
				"price",
				"APR",
				"Brent premium",
				"carry long WTI",
				"MoB",
			],
			result.view.map((row) => [
				row.venue,
				row.wti?.market ?? "—",
				row.wti?.price === undefined ? "—" : price(row.wti.price),
				row.wti ? signed(row.wti.annualizedPct) : "—",
				row.brent?.market ?? "—",
				row.brent?.price === undefined ? "—" : price(row.brent.price),
				row.brent ? signed(row.brent.annualizedPct) : "—",
				row.brentPremiumPct === undefined
					? "—"
					: signed(row.brentPremiumPct, 2),
				row.carryLongWtiPct === undefined
					? "—"
					: `${signed(row.carryLongWtiPct)}/yr`,
				row.mob ? "yes" : "—",
			]),
		),
	);
	return lines.join("\n");
}

/** `mob watch --check`: only the alerts that fire now, one line each. */
export function renderAlerts(result: Result<typeof watchList>): string {
	if (!result.view.length) return renderWatch(result);
	const armed = result.view.filter((row) => row.alert).length;
	const fired = result.view.flatMap((row, index) =>
		(row.triggered ?? []).map(
			(hit) =>
				`ALERT ${index + 1} ${row.base} (long ${row.long}, short ${row.short}): ${hit}`,
		),
	);
	if (fired.length) return fired.join("\n");
	return armed
		? `No alerts: ${armed} of ${result.view.length} saved pairs have thresholds, none crossed.`
		: "No alerts set. Add one: mob watch add <BASE> --long venue:market --short venue:market --alert-spread-below 10";
}
