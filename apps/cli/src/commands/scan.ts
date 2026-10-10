import { rankOpportunities } from "@mobstack/opportunities";
import { getConfig, numberFlag, readConfig } from "../config.ts";
import { scanView } from "../scan-view.ts";
import {
	base,
	type Runtime,
	selectedVenues,
	snapshot,
	withRateCount,
} from "./runtime.ts";

export interface ScanOptions {
	sizeUsd?: number;
	market?: string;
	venues?: readonly string[];
	topExec?: number;
	top?: number;
	allPairs?: boolean;
	executable?: boolean;
	minApy?: number;
	minVolume24hUsd?: number;
	includeThin?: boolean;
	holdDays?: number;
}

export async function scan(options: ScanOptions, rt: Runtime) {
	const config = await readConfig(rt.home);
	const venues = selectedVenues(options.venues);
	const market = base(options.market);
	const sizeUsd = numberFlag(
		options.sizeUsd ?? Number(getConfig(config, "default_size_usd")),
		"size",
		Number.MIN_VALUE,
	);
	const top = numberFlag(options.top ?? 10, "top", 1, true);
	const topExec = numberFlag(options.topExec ?? 5, "top-exec", 1, true);
	const holdDays = numberFlag(
		options.holdDays ?? 7,
		"hold-days",
		Number.MIN_VALUE,
	);
	const minVolume24hUsd = numberFlag(
		options.minVolume24hUsd ?? 1_000_000,
		"min-volume",
		0,
	);
	const minApy =
		options.minApy === undefined
			? undefined
			: numberFlag(options.minApy, "min-apy", -Number.MAX_VALUE);
	const input = await snapshot(venues, rt);
	const result = rankOpportunities(input, {
		sizeUsd,
		holdDays,
		minVolume24hUsd,
		takerFeeBps: config.taker_fee_bps,
		builderFeeTenthsBps: Number(getConfig(config, "builder_fee_tenths_bps")),
	});
	const { view, thinHidden } = scanView(result, {
		market,
		top,
		topExec,
		allPairs: options.allPairs === true,
		executable: options.executable === true,
		minApy,
		includeThin: options.includeThin === true,
	});
	return withRateCount({ ...result, view, thinHidden }, input.rates.length);
}
