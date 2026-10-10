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
	const ticker = /^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u;
	switch (venue) {
		case "hl": {
			const match =
				/^(?:[a-z][a-z0-9]*:)?([\p{L}\p{N}][\p{L}\p{N}._-]*)$/u.exec(market);
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
					? /^([\p{L}\p{N}]+)(?:USDT|USDC|USD1)$/u
					: /^([\p{L}\p{N}]+)(?:USDT|PERP)$/u
			).exec(market);
			if (!match) return null;
			base = match[1];
			break;
		}
		case "okx": {
			const match = /^([\p{L}\p{N}]+)-(USDT|USDC|USD)-SWAP$/u.exec(market);
			if (!match) return null;
			base = match[1];
			quoteClass = match[2] === "USD" ? "coin" : "usd-stable";
			break;
		}
		default:
			return null;
	}
	const multiplier = /^(10+)(\p{L}[\p{L}\p{N}._-]*)$/u.exec(base);
	if (multiplier) {
		contractMultiplier *= Number(multiplier[1]);
		if (!Number.isSafeInteger(contractMultiplier)) return null;
		base = multiplier[2];
	}
	return { base, quoteClass, contractMultiplier };
}
