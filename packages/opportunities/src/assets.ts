import type { ObservedFundingRate, VenueCategory } from "@mstack/funding";
import { classifyMarket, type MarketClassification } from "./classify.ts";

// Asset identity across venues. A ticker alone is not an asset: BB is
// BlackBerry on trade.xyz and BounceBit on Binance. Rows are one asset only
// when their normalized prices agree. Venues label their own markets (OKX
// instCategory, Bitget isRwa, Hyperliquid's RWA-only deployments), and one
// labeled listing classifies every venue's rows of that asset. The catalog
// below names real-world tickers and fills in only where no venue labels
// them; it leaves out tickers that also name a crypto token (BB, CVX, QNT,
// PRL, SPX), which get their class from venue labels alone.

export type AssetClass = "crypto" | "rwa";
export type RwaCategory =
	| "stock"
	| "index"
	| "commodity"
	| "fx"
	| "pre-ipo"
	| "other";
export const RWA_CATEGORIES: readonly RwaCategory[] = [
	"stock",
	"index",
	"commodity",
	"fx",
	"pre-ipo",
	"other",
];

/** Normalized prices further apart than this ratio are different assets. */
export const SAME_ASSET_PRICE_RATIO = 1.25;

/** Hyperliquid builder deployments that list only real-world assets. */
const RWA_DEXES = new Set(["xyz", "io"]);

/** Venue spellings of one asset, mapped to the most common ticker. */
const ALIASES: Readonly<Record<string, string>> = {
	GOLD: "XAU",
	SILVER: "XAG",
	PLATINUM: "XPT",
	PALLADIUM: "XPD",
	COPPER: "XCU",
	SMSN: "SAMSUNG",
	SKHX: "SKHYNIX",
	OAI: "OPENAI",
	ANTH: "ANTHROPIC",
	XYZ100: "US100",
	EUR: "EURUSD",
	GBP: "GBPUSD",
	JPY: "USDJPY",
	WTI: "CL",
	WTIOIL: "CL",
	USOIL: "CL",
	NCCO1OILWTI2USD: "CL",
	BZ: "BRENTOIL",
	UKOIL: "BRENTOIL",
	NCCO1OILBRENT2USD: "BRENTOIL",
};

const entries = (
	category: RwaCategory,
	names: Record<string, string>,
): [string, { category: RwaCategory; name: string }][] =>
	Object.entries(names).map(([ticker, name]) => [ticker, { category, name }]);

const CATALOG = new Map<string, { category: RwaCategory; name: string }>([
	...entries("stock", {
		AAOI: "Applied Optoelectronics",
		AAPL: "Apple",
		AMAT: "Applied Materials",
		AMD: "Advanced Micro Devices",
		AMZN: "Amazon",
		ARM: "Arm Holdings",
		ASML: "ASML Holding",
		AVGO: "Broadcom",
		BABA: "Alibaba",
		BE: "Bloom Energy",
		BMNR: "BitMine Immersion",
		BX: "Blackstone",
		CAMBRICON: "Cambricon Technologies",
		COIN: "Coinbase",
		COST: "Costco",
		CRCL: "Circle Internet Group",
		CRWD: "CrowdStrike",
		CRWV: "CoreWeave",
		DELL: "Dell Technologies",
		DKNG: "DraftKings",
		EBAY: "eBay",
		GEV: "GE Vernova",
		GIGADEV: "GigaDevice",
		GLW: "Corning",
		GME: "GameStop",
		GOOGL: "Alphabet",
		GPRO: "GoPro",
		HIMS: "Hims & Hers Health",
		HOOD: "Robinhood Markets",
		HYUNDAI: "Hyundai Motor",
		IBM: "IBM",
		INTC: "Intel",
		IONQ: "IonQ",
		IREN: "IREN",
		KIOXIA: "Kioxia Holdings",
		LITE: "Lumentum",
		LLY: "Eli Lilly",
		LRCX: "Lam Research",
		META: "Meta Platforms",
		MRNA: "Moderna",
		MRVL: "Marvell Technology",
		MSFT: "Microsoft",
		MSTR: "Strategy",
		MU: "Micron Technology",
		NBIS: "Nebius Group",
		NET: "Cloudflare",
		NFLX: "Netflix",
		NOK: "Nokia",
		NOW: "ServiceNow",
		NVDA: "NVIDIA",
		ORCL: "Oracle",
		PLTR: "Palantir",
		QCOM: "Qualcomm",
		RDDT: "Reddit",
		RIVN: "Rivian",
		RKLB: "Rocket Lab",
		SAMSUNG: "Samsung Electronics",
		SKHY: "SK Hynix ADR",
		SKHYNIX: "SK Hynix",
		SNDK: "SanDisk",
		SOFTBANK: "SoftBank Group",
		SPCX: "SpaceX",
		STRC: "Strategy Stretch preferred",
		TCNT: "Tencent",
		TSLA: "Tesla",
		TSM: "Taiwan Semiconductor",
		TWST: "Twist Bioscience",
		UMC: "United Microelectronics",
		USAR: "USA Rare Earth",
		WDC: "Western Digital",
		XIAOMI: "Xiaomi",
		ZM: "Zoom Communications",
		DRAM: "Roundhill Memory ETF",
		EWJ: "iShares MSCI Japan ETF",
		EWT: "iShares MSCI Taiwan ETF",
		EWY: "iShares MSCI South Korea ETF",
		EWZ: "iShares MSCI Brazil ETF",
		KORU: "Direxion South Korea Bull 3X",
		MAGS: "Roundhill Magnificent Seven ETF",
		QQQ: "Invesco QQQ Trust",
		SMH: "VanEck Semiconductor ETF",
		SNXX: "Tradr 2X Long SNDK",
		SOXL: "Direxion Semiconductor Bull 3X",
		SPY: "SPDR S&P 500 ETF",
		TLT: "iShares 20+ Year Treasury ETF",
		URNM: "Sprott Uranium Miners ETF",
		XBI: "SPDR S&P Biotech ETF",
		XLE: "Energy Select Sector SPDR",
	}),
	...entries("index", {
		US100: "Nasdaq-100 index",
		SP500: "S&P 500 index",
		US500: "S&P 500 index",
		US30: "Dow Jones Industrial Average",
		JP225: "Nikkei 225 index",
		KR200: "KOSPI 200 index",
	}),
	...entries("commodity", {
		XAU: "Gold",
		XAG: "Silver",
		XPT: "Platinum",
		XPD: "Palladium",
		XCU: "Copper",
		CL: "WTI crude oil",
		BRENTOIL: "Brent crude oil",
		NATGAS: "Natural gas",
		HO: "Heating oil",
	}),
	...entries("fx", {
		EURUSD: "Euro / US dollar",
		GBPUSD: "British pound / US dollar",
		USDJPY: "US dollar / Japanese yen",
	}),
	...entries("pre-ipo", {
		OPENAI: "OpenAI",
		ANTHROPIC: "Anthropic",
		CXMT: "ChangXin Memory",
		UNITREE: "Unitree Robotics",
		JIO: "Jio Platforms",
		SHEIN: "Shein",
		OURA: "Oura",
	}),
	...entries("commodity", { H100: "H100 GPU rental price" }),
	...entries("other", {
		CBRS: "",
		MINIMAX: "",
		ZHIPU: "",
		SPACEX: "",
	}),
]);

/** The ticker every venue spelling of an asset shares, such as XAU for GOLD. */
export function canonicalTicker(base: string): string {
	const upper = base.toUpperCase();
	return ALIASES[upper] ?? upper;
}

/** Catalog facts for a canonical ticker, when it names a real-world asset. */
export function rwaInfo(
	ticker: string,
): { category: RwaCategory; name?: string } | undefined {
	const info = CATALOG.get(canonicalTicker(ticker));
	return (
		info && {
			category: info.category,
			...(info.name ? { name: info.name } : {}),
		}
	);
}

/** The deployment prefix of a Hyperliquid builder market, such as xyz. */
export function hlDex(venue: string, market: string): string | undefined {
	if (venue !== "hl") return undefined;
	const colon = market.indexOf(":");
	return colon > 0 ? market.slice(0, colon) : undefined;
}

type Labeled = Pick<ObservedFundingRate, "venue" | "market" | "venueCategory">;

/** What the venue itself says a row is; undefined when it says nothing. */
function rowLabel(row: Labeled): VenueCategory | undefined {
	// Hyperliquid's core order books list only crypto; its builder
	// deployments say what they list by name.
	if (row.venue === "hl") {
		const dex = hlDex(row.venue, row.market);
		return dex !== undefined && RWA_DEXES.has(dex) ? "rwa" : "crypto";
	}
	return row.venueCategory;
}

/**
 * Class and category of rows that are one asset. A venue label wins: any
 * real-world label makes the asset RWA, and a crypto label rules the catalog
 * out (CAT is a memecoin on Bitget and Caterpillar on Binance). The catalog
 * decides only when no venue labels the rows.
 */
export function classifyRows(
	rows: readonly Labeled[],
	ticker: string,
): { class: AssetClass; category?: RwaCategory } {
	const labels = rows.flatMap((row) => rowLabel(row) ?? []);
	const real = labels.filter((label) => label !== "crypto");
	const info = rwaInfo(ticker);
	if (!real.length && (labels.includes("crypto") || !info))
		return { class: "crypto" };
	const counts = new Map<RwaCategory, number>();
	for (const label of real)
		if (label !== "rwa") counts.set(label, (counts.get(label) ?? 0) + 1);
	const labeled = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
	// The catalog's category is more specific than a venue's (OKX files
	// indices under stocks), except its catch-all "other".
	const curated = info?.category === "other" ? undefined : info?.category;
	return { class: "rwa", category: curated ?? labeled ?? "other" };
}

/** Price per base unit, comparable across contract multipliers. */
export function unitPrice(
	row: Pick<ObservedFundingRate, "markPrice">,
	classification: Pick<MarketClassification, "contractMultiplier">,
): number | undefined {
	return row.markPrice === undefined
		? undefined
		: row.markPrice / classification.contractMultiplier;
}

/** True when two unit prices can be one asset; unknown prices never disagree. */
export function pricesAgree(
	a: number | undefined,
	b: number | undefined,
): boolean {
	if (a === undefined || b === undefined) return true;
	return Math.max(a, b) / Math.min(a, b) <= SAME_ASSET_PRICE_RATIO;
}

export interface AssetRow extends ObservedFundingRate, MarketClassification {
	price?: number;
}

export interface Asset {
	/** Canonical ticker, such as XAU for a GOLD listing. */
	ticker: string;
	/** 1 for the main listing set, 2 and up for a different asset on the same ticker. */
	variant: number;
	class: AssetClass;
	category?: RwaCategory;
	name?: string;
	rows: AssetRow[];
	/** Sum over rows that report it; undefined when no row reports it. */
	volume24hUsd?: number;
	openInterestUsd?: number;
	/** Rows that report no volume or open interest, so the sums are partial. */
	missingVolume: number;
	missingOpenInterest: number;
	/** Volume-weighted unit price over rows that report both. */
	price?: number;
	/** The row with the largest absolute annualized funding. */
	best: AssetRow;
}

function sum(
	rows: AssetRow[],
	field: "volume24hUsd" | "openInterestUsd",
): [number | undefined, number] {
	const known = rows.filter((row) => row[field] !== undefined);
	return [
		known.length
			? known.reduce((total, row) => total + (row[field] ?? 0), 0)
			: undefined,
		rows.length - known.length,
	];
}

/**
 * Group funding rows into assets. Rows join an asset by canonical ticker,
 * then split by price: the highest-volume priced row anchors the first asset,
 * rows within SAME_ASSET_PRICE_RATIO of it join, and the rest start the next
 * variant. Rows without a price join the first variant.
 */
export function groupAssets(rates: readonly ObservedFundingRate[]): {
	assets: Asset[];
	unmatched: { venue: string; market: string }[];
} {
	const byTicker = new Map<string, AssetRow[]>();
	const unmatched: { venue: string; market: string }[] = [];
	for (const rate of rates) {
		const classification = classifyMarket(rate.venue, rate.market);
		if (!classification) {
			unmatched.push({ venue: rate.venue, market: rate.market });
			continue;
		}
		const ticker = canonicalTicker(classification.base);
		const row: AssetRow = {
			...rate,
			...classification,
			price: unitPrice(rate, classification),
		};
		const list = byTicker.get(ticker) ?? [];
		list.push(row);
		byTicker.set(ticker, list);
	}
	const assets: Asset[] = [];
	for (const [ticker, rows] of byTicker) {
		let rest = [...rows].sort(
			(a, b) => (b.volume24hUsd ?? 0) - (a.volume24hUsd ?? 0),
		);
		const clusters: AssetRow[][] = [];
		while (rest.length) {
			const anchor = rest.find((row) => row.price !== undefined);
			const members = rest.filter(
				(row) =>
					anchor === undefined ||
					(row.price === undefined
						? clusters.length === 0
						: pricesAgree(row.price, anchor.price)),
			);
			clusters.push(members.length ? members : rest);
			rest = rest.filter((row) => !clusters[clusters.length - 1].includes(row));
		}
		clusters.forEach((members, index) => {
			const kind = classifyRows(members, ticker);
			const rwa = kind.class === "rwa";
			const info = rwa ? rwaInfo(ticker) : undefined;
			const [volume24hUsd, missingVolume] = sum(members, "volume24hUsd");
			const [openInterestUsd, missingOpenInterest] = sum(
				members,
				"openInterestUsd",
			);
			const weighted = members.filter(
				(row) => row.price !== undefined && row.volume24hUsd,
			);
			const weight = weighted.reduce(
				(total, row) => total + (row.volume24hUsd ?? 0),
				0,
			);
			const best = members.reduce((top, row) =>
				Math.abs(row.annualizedPct) > Math.abs(top.annualizedPct) ? row : top,
			);
			assets.push({
				ticker,
				variant: index + 1,
				class: rwa ? "rwa" : "crypto",
				...(kind.category ? { category: kind.category } : {}),
				...(info?.name ? { name: info.name } : {}),
				rows: members,
				...(volume24hUsd === undefined ? {} : { volume24hUsd }),
				...(openInterestUsd === undefined ? {} : { openInterestUsd }),
				missingVolume,
				missingOpenInterest,
				...(weight
					? {
							price:
								weighted.reduce(
									(total, row) =>
										total + (row.price ?? 0) * (row.volume24hUsd ?? 0),
									0,
								) / weight,
						}
					: {}),
				best,
			});
		});
	}
	assets.sort((a, b) => (b.volume24hUsd ?? 0) - (a.volume24hUsd ?? 0));
	return { assets, unmatched };
}
