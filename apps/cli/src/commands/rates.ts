import { classifyMarket } from "@mstack/opportunities";
import { readConfig } from "../config.ts";
import {
	base,
	type Runtime,
	selectedVenues,
	snapshot,
	withRateCount,
} from "./runtime.ts";

export interface RatesOptions {
	venue?: string;
	market?: string;
}

export async function rates(options: RatesOptions, rt: Runtime) {
	await readConfig(rt.home);
	const venues = selectedVenues(options.venue?.split(","));
	const market = base(options.market);
	const input = await snapshot(venues, rt);
	const unmatched = input.rates
		.filter((r) => classifyMarket(r.venue, r.market) === null)
		.map(({ venue, market }) => ({ venue, market }));
	const view = input.rates
		.filter(
			(r) =>
				!market ||
				classifyMarket(r.venue, r.market)?.base.toUpperCase() === market,
		)
		.map((r) => ({ ...r, ratePerHour: r.ratePerInterval / r.intervalHours }));
	return withRateCount({ ...input, unmatched, view }, input.rates.length);
}
