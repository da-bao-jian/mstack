export type QuoteClass = "usd-stable" | "coin";

export interface MarketClassification {
	base: string;
	quoteClass: QuoteClass;
	contractMultiplier: number;
}

/** Classification never changes the native market carried by an opportunity. */
export function classifyMarket(
	venue: string,
	market: string,
): MarketClassification | null {
	if (typeof market !== "string") return null;
	let base: string;
	let quoteClass: QuoteClass = "usd-stable";
	let contractMultiplier = 1;
	const ticker = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
	switch (venue) {
		case "hl": {
			const match = /^(?:[a-z][a-z0-9]*:)?([A-Za-z0-9][A-Za-z0-9._-]*)$/.exec(
				market,
			);
			if (!match) return null;
			base = match[1];
			if (/^k[A-Z][A-Z0-9]*$/.test(base)) {
				base = base.slice(1);
				contractMultiplier = 1000;
			}
			base = base.toUpperCase();
			break;
		}
		case "lighter":
		case "lighter-mainnet":
			if (!ticker.test(market)) return null;
			base = market;
			break;
		case "aster":
			base = market.startsWith("USD1:") ? market.slice(5) : market;
			if (!ticker.test(base)) return null;
			base = base.toUpperCase();
			break;
		case "binance":
		case "bybit": {
			const match = (
				venue === "binance"
					? /^([A-Z0-9]+)(?:USDT|USDC)$/
					: /^([A-Z0-9]+)(?:USDT|PERP)$/
			).exec(market);
			if (!match) return null;
			base = match[1];
			if (/^1000[A-Z][A-Z0-9]*$/.test(base)) {
				base = base.slice(4);
				contractMultiplier = 1000;
			}
			break;
		}
		case "okx": {
			const match = /^([A-Z0-9]+)-(USDT|USDC|USD)-SWAP$/.exec(market);
			if (!match) return null;
			base = match[1];
			quoteClass = match[2] === "USD" ? "coin" : "usd-stable";
			break;
		}
		default:
			return null;
	}
	return { base, quoteClass, contractMultiplier };
}
