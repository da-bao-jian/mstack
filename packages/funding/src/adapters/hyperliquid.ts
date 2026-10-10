// Ported from mobius@33ed2ece funding-server/src/arbitrage/fundingRates.ts
// Core/builder isolation follows upstream; validation, caps, and native case are added.
import { json } from "../http.ts";
import type {
	FetchContext,
	ObservedFundingRate,
	VenueAdapter,
} from "../types.ts";
import {
	array,
	errorMessage,
	nonnegative,
	numeric,
	object,
	positive,
	rate,
	string,
	unique,
} from "../validation.ts";

async function fetchDex(
	ctx: FetchContext,
	dex?: string,
): Promise<ObservedFundingRate[]> {
	const query = dex === undefined ? {} : { dex };
	const [rawMeta, rawCaps] = await Promise.all([
		json(ctx, "https://api.hyperliquid.xyz/info", {
			type: "metaAndAssetCtxs",
			...query,
		}),
		json(ctx, "https://api.hyperliquid.xyz/info", {
			type: "perpsAtOpenInterestCap",
			...query,
		}),
	]);
	const tuple = array(rawMeta, "metaAndAssetCtxs");
	if (tuple.length !== 2)
		throw new Error("metaAndAssetCtxs: expected [meta, contexts]");
	const universe = array(object(tuple[0], "meta").universe, "universe");
	const contexts = array(tuple[1], "contexts");
	if (universe.length !== contexts.length)
		throw new Error("HL universe/context length mismatch");
	const caps = new Set(
		array(rawCaps, "perpsAtOpenInterestCap").map((v) =>
			string(v, "capped market"),
		),
	);
	const markets = universe.map((value) => object(value, "HL market"));
	unique(
		markets.map((value) => string(value.name, "HL market name")),
		"HL universe",
	);
	return markets.flatMap((asset, index) => {
		const market = string(asset.name, "HL market name");
		if (
			asset.isDelisted !== undefined &&
			typeof asset.isDelisted !== "boolean"
		) {
			throw new Error(`${market}: invalid isDelisted`);
		}
		if (asset.isDelisted === true) return [];
		if (dex && !market.startsWith(`${dex}:`))
			throw new Error(`${market}: wrong dex qualifier`);
		const data = object(contexts[index], `${market} context`);
		const markPrice = positive(data.markPx, `${market} markPx`);
		const openInterestUsd = nonnegative(
			nonnegative(data.openInterest, `${market} openInterest`) * markPrice,
			`${market} openInterestUsd`,
		);
		return [
			rate(ctx, "hl", market, numeric(data.funding, `${market} funding`), 1, {
				markPrice,
				openInterestUsd,
				oiCapped: caps.has(market),
			}),
		];
	});
}

async function fetchBuilder(
	ctx: FetchContext,
	dex: string,
): Promise<ObservedFundingRate[]> {
	if (ctx.deadline === undefined) return fetchDex(ctx, dex);
	const remaining = ctx.deadline - performance.now();
	// Reserve at most 50ms of the adapter budget to report failures and retain
	// core rows. A stalled optional dex must not trigger the whole-adapter timeout.
	const timeoutMs = Math.max(
		1,
		Math.floor(remaining - Math.min(50, remaining / 4)),
	);
	const controller = new AbortController();
	const signal = AbortSignal.any([ctx.signal, controller.signal]);
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(() => {
			const error = new Error(`Timed out fetching ${dex} after ${timeoutMs}ms`);
			controller.abort(error);
			reject(error);
		}, timeoutMs);
	});
	try {
		return await Promise.race([fetchDex({ ...ctx, signal }, dex), timeout]);
	} finally {
		clearTimeout(timer);
		controller.abort();
	}
}

export const hyperliquid: VenueAdapter = {
	venue: "hl",
	tier: "A",
	async fetchRates(ctx) {
		const core = await fetchDex(ctx);
		const dexes = ["xyz", "io"];
		const builders = await Promise.allSettled(
			dexes.map((dex) => fetchBuilder(ctx, dex)),
		);
		const rates = [...core];
		for (const [index, result] of builders.entries()) {
			if (result.status === "rejected") {
				ctx.reportFailure({
					venue: "hl",
					error: `dex ${dexes[index]}: ${errorMessage(result.reason)}`,
				});
			} else {
				rates.push(...result.value);
			}
		}
		unique(
			rates.map((row) => row.market),
			"HL dexes",
		);
		return rates;
	},
};
