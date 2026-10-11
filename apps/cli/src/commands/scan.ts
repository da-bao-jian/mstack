import { rankOpportunities } from "@mstack/opportunities";
import { getConfig, numberFlag, readConfig, UsageError } from "../config.ts";
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
	includeCrossDeployment?: boolean;
	holdDays?: number;
	includeFull?: boolean;
}

function viewLimit(value: number, name: string): number {
	if (value > 200) throw new UsageError(`${name} is capped at 200`);
	return numberFlag(value, name, 1, true);
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
	const top = viewLimit(options.top ?? 10, "top");
	const topExec = viewLimit(options.topExec ?? 5, "top-exec");
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
	const { view, thinHidden, crossDeploymentHidden } = scanView(result, {
		market,
		top,
		topExec,
		allPairs: options.allPairs === true,
		executable: options.executable === true,
		minApy,
		includeThin: options.includeThin === true,
		includeCrossDeployment: options.includeCrossDeployment === true,
	});
	return withRateCount(
		{
			holdDays: result.holdDays,
			observedAt: result.observedAt,
			source: result.source,
			annualizationMethod: result.annualizationMethod,
			counts: {
				rates: input.rates.length,
				opportunities: result.opportunities.length,
				qualifying: result.opportunities.filter((row) => row.qualifies).length,
				executable: result.opportunities.filter((row) => row.executable).length,
				thinHidden,
				crossDeploymentHidden,
				unmatched: result.unmatched.length,
			},
			failed: result.failed,
			unmatched: result.unmatched,
			view,
			...(options.includeFull ? { opportunities: result.opportunities } : {}),
		},
		input.rates.length,
	);
}
