import { expect, test } from "bun:test";
import { classifyMarket } from "../src/index.ts";

test.each([
	["hl", "BTC", "BTC", "usd-stable", 1],
	["hl", "xyz:NVDA", "NVDA", "usd-stable", 1],
	["hl", "io:ANTH", "ANTH", "usd-stable", 1],
	["hl", "kPEPE", "PEPE", "usd-stable", 1000],
	["hl", "KAS", "KAS", "usd-stable", 1],
	["lighter", "BTC", "BTC", "usd-stable", 1],
	["lighter-mainnet", "1000PEPE", "PEPE", "usd-stable", 1000],
	["hl", "10000SATS", "SATS", "usd-stable", 10000],
	["lighter", "1000BONK", "BONK", "usd-stable", 1000],
	["aster", "1000NEX", "NEX", "usd-stable", 1000],
	["aster", "USD1:1000CAT", "CAT", "usd-stable", 1000],
	["binance", "1000000MOGUSDT", "MOG", "usd-stable", 1000000],
	["bybit", "10000SATSUSDT", "SATS", "usd-stable", 10000],
	["bybit", "1000000BABYDOGEUSDT", "BABYDOGE", "usd-stable", 1000000],
	["okx", "1000PEPE-USDT-SWAP", "PEPE", "usd-stable", 1000],
	["binance", "BTCUSD1", "BTC", "usd-stable", 1],
	["binance", "SPCXUSD1", "SPCX", "usd-stable", 1],
	["hl", "xyz:雪球", "雪球", "usd-stable", 1],
	["lighter", "雪球", "雪球", "usd-stable", 1],
	["lighter-mainnet", "龙虾", "龙虾", "usd-stable", 1],
	["aster", "币安人生", "币安人生", "usd-stable", 1],
	["binance", "币安人生USDT", "币安人生", "usd-stable", 1],
	["bybit", "龙虾USDT", "龙虾", "usd-stable", 1],
	["okx", "雪球-USDT-SWAP", "雪球", "usd-stable", 1],
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
	["binance", "ETHBTC"],
	["binance", "ETHU"],
	["bybit", "BTCUSDT-16OCT26"],
	["okx", "BTC-USD-261225"],
	["okx", "BTC-EUR-SWAP"],
])("reports unrecognized %s:%s", (venue, market) => {
	expect(classifyMarket(venue, market)).toBeNull();
});
