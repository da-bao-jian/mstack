import { json } from "../http.ts";
import type { ObservedFundingRate, VenueAdapter } from "../types.ts";
import {
	array,
	numeric,
	object,
	positive,
	rate,
	string,
	timestamp,
	unique,
} from "../validation.ts";

function data(value: unknown): unknown[] {
	const body = object(value, "OKX response");
	if (body.code !== "0") throw new Error(`OKX error code ${body.code}`);
	return array(body.data, "OKX data");
}

/** Each worker has at most one HTTP request in flight. No retries. */
export function createOkxAdapter({
	concurrency = 4,
}: {
	concurrency?: number;
} = {}): VenueAdapter {
	if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16) {
		throw new Error("OKX concurrency must be an integer between 1 and 16");
	}
	return {
		venue: "okx",
		tier: "C",
		async fetchRates(ctx) {
			const instruments = data(
				await json(
					ctx,
					"https://www.okx.com/api/v5/public/instruments?instType=SWAP",
				),
			).flatMap((value) => {
				const entry = object(value, "OKX instrument");
				const market = string(entry.instId, "instId");
				if (entry.instType !== "SWAP")
					throw new Error(`${market}: expected SWAP`);
				const state = string(entry.state, `${market} state`);
				return state === "live" ? [market] : [];
			});
			unique(instruments, "OKX instruments");
			const rows: ObservedFundingRate[] = new Array(instruments.length);
			let next = 0;
			let failed = false;
			await Promise.all(
				Array.from(
					{ length: Math.min(concurrency, instruments.length) },
					async () => {
						while (!failed && next < instruments.length) {
							ctx.signal.throwIfAborted();
							const index = next++;
							const market = instruments[index];
							try {
								const entries = data(
									await json(
										ctx,
										`https://www.okx.com/api/v5/public/funding-rate?instId=${encodeURIComponent(market)}`,
									),
								);
								if (entries.length !== 1)
									throw new Error(`${market}: expected one funding row`);
								const entry = object(entries[0], "OKX funding rate");
								if (entry.instId !== market)
									throw new Error(`${market}: mismatched funding instrument`);
								const fundingTime = timestamp(
									entry.fundingTime,
									`${market} fundingTime`,
								);
								const nextFundingTime = timestamp(
									entry.nextFundingTime,
									`${market} nextFundingTime`,
								);
								const intervalHours = positive(
									(nextFundingTime - fundingTime) / 3_600_000,
									`${market} intervalHours`,
								);
								rows[index] = rate(
									ctx,
									"okx",
									market,
									numeric(entry.fundingRate, `${market} fundingRate`),
									intervalHours,
									{ nextFundingAt: fundingTime },
								);
							} catch (error) {
								failed = true;
								throw error;
							}
						}
					},
				),
			);
			return rows;
		},
	};
}

export const okx = createOkxAdapter();
