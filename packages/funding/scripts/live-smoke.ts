import {
	aster,
	binance,
	bybit,
	fetchSnapshot,
	hyperliquid,
	lighter,
	lighterMainnet,
	okx,
} from "../src/main.ts";

if (process.env.MOB_LIVE !== "1") {
	console.error("Live venue requests require MOB_LIVE=1");
	process.exit(1);
}

const snapshot = await fetchSnapshot(
	[hyperliquid, lighter, lighterMainnet, aster, binance, bybit, okx],
	{ timeoutMs: 60_000 },
);
console.log(
	`observedAt=${snapshot.observedAt} source=direct annualizationMethod=simple`,
);
const counts = new Map<string, number>();
for (const row of snapshot.rates) {
	const key = `${row.venue} source=${row.source}`;
	counts.set(key, (counts.get(key) ?? 0) + 1);
}
for (const [key, count] of counts) console.log(`${key} rows=${count}`);
console.log(`listed=${snapshot.listed.length} rates=${snapshot.rates.length}`);
console.log(`failed=${JSON.stringify(snapshot.failed)}`);
if (snapshot.failed.length > 0) process.exitCode = 1;
