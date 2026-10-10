import { expect, test } from "bun:test";
import { classifyMarket } from "../src/index.ts";

test.each([
	["hl", "BTC", "BTC", "usd-stable", 1],
	["hl", "xyz:NVDA", "NVDA", "usd-stable", 1],
	["hl", "io:ANTH", "ANTH", "usd-stable", 1],
	["hl", "kPEPE", "PEPE", "usd-stable", 1000],
	["hl", "KAS", "KAS", "usd-stable", 1],
	["lighter", "BTC", "BTC", "usd-stable", 1],
	["lighter-mainnet", "1000PEPE", "1000PEPE", "usd-stable", 1],
	["aster", "BTC", "BTC", "usd-stable", 1],
	["aster", "USD1:BTC", "BTC", "usd-stable", 1],
	["binance", "BTCUSDT", "BTC", "usd-stable", 1],
	["binance", "BTCUSDC", "BTC", "usd-stable", 1],
	["binance", "1000PEPEUSDT", "PEPE", "usd-stable", 1000],
	["bybit", "BTCUSDT", "BTC", "usd-stable", 1],
	["bybit", "BTCPERP", "BTC", "usd-stable", 1],
	["bybit", "1000PEPEUSDT", "PEPE", "usd-stable", 1000],
	["okx", "BTC-USDT-SWAP", "BTC", "usd-stable", 1],
	["okx", "BTC-USDC-SWAP", "BTC", "usd-stable", 1],
	["okx", "BTC-USD-SWAP", "BTC", "coin", 1],
])(
	"classifies %s:%s",
	(venue, market, base, quoteClass, contractMultiplier) => {
		expect(classifyMarket(venue, market)).toEqual({
			base,
			quoteClass: quoteClass as "usd-stable" | "coin",
			contractMultiplier,
		});
	},
);

test.each([
	["unknown", "BTC"],
	["hl", ""],
	["hl", "BTC;exit"],
	["hl", "--help"],
	["hl", "xyz:io:NVDA"],
	["aster", "USD1:"],
	["aster", "USD:BTC"],
	["lighter", "BTC USDT"],
	["binance", "BTCUSD"],
	["binance", "BTC"],
	["bybit", "BTCUSDT-16OCT26"],
	["okx", "BTC-USD-261225"],
	["okx", "BTC-EUR-SWAP"],
])("reports unrecognized %s:%s", (venue, market) => {
	expect(classifyMarket(venue, market)).toBeNull();
});
