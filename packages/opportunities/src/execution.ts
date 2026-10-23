import type { Level } from "@mstack/funding";

// What a market order of a given USD size pays against a published book:
// the fill walks the levels from the best price, and the cost is the
// distance of the average fill from the mid price plus the taker fee.

export type Side = "long" | "short";

export interface ExecutionCost {
	sizeUsd: number;
	side: Side;
	/** Mid of the best bid and best ask. */
	mid: number;
	/** USD notional the published levels can fill, at most sizeUsd. */
	filledUsd: number;
	complete: boolean;
	averagePrice?: number;
	/** Average fill against mid, in basis points; positive is a cost. */
	slippageBps?: number;
	takerFeeBps: number;
	/** slippageBps + takerFeeBps; absent when the book cannot fill sizeUsd. */
	costBps?: number;
	costUsd?: number;
}

export function executionCost(
	book: { bids: readonly Level[]; asks: readonly Level[] },
	sizeUsd: number,
	side: Side,
	takerFeeBps: number,
): ExecutionCost {
	if (!Number.isFinite(sizeUsd) || sizeUsd <= 0)
		throw new Error("sizeUsd must be positive");
	if (!Number.isFinite(takerFeeBps) || takerFeeBps < 0)
		throw new Error("takerFeeBps must be nonnegative");
	const [bestBid] = book.bids[0] ?? [];
	const [bestAsk] = book.asks[0] ?? [];
	if (bestBid === undefined || bestAsk === undefined)
		throw new Error("order book needs both sides");
	const mid = (bestBid + bestAsk) / 2;
	let quote = 0;
	let base = 0;
	for (const [price, size] of side === "long" ? book.asks : book.bids) {
		const take = Math.min(size, (sizeUsd - quote) / price);
		quote += take * price;
		base += take;
		if (sizeUsd - quote <= sizeUsd * 1e-12) break;
	}
	const complete = sizeUsd - quote <= sizeUsd * 1e-9;
	const result: ExecutionCost = {
		sizeUsd,
		side,
		mid,
		filledUsd: quote,
		complete,
		takerFeeBps,
	};
	if (base === 0) return result;
	const averagePrice = quote / base;
	const slippageBps =
		((side === "long" ? averagePrice - mid : mid - averagePrice) / mid) *
		10_000;
	return {
		...result,
		averagePrice,
		slippageBps,
		...(complete
			? {
					costBps: slippageBps + takerFeeBps,
					costUsd: ((slippageBps + takerFeeBps) / 10_000) * sizeUsd,
				}
			: {}),
	};
}
