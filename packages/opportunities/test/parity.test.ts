import { expect, test } from "bun:test";
import hashes from "./upstream-hashes.json";

test.each(Object.entries(hashes))(
	"%s retains byte-exact upstream function source",
	async (name, digest) => {
		const source = await Bun.file(
			new URL("../src/upstream.ts", import.meta.url),
		).text();
		expect(
			source.startsWith(
				"// Ported from mobius@33ed2ece tg-monitor/src/monitoring/scanner.ts\n",
			),
		).toBe(true);
		const block = source.match(
			new RegExp(`export function ${name}\\([\\s\\S]*?\\n}\\n`),
		)?.[0];
		expect(block).toBeDefined();
		expect(
			new Bun.CryptoHasher("sha256").update(block as string).digest("hex"),
		).toBe(digest);
	},
);
