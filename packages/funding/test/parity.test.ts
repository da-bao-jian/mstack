import { expect, test } from "bun:test";

// Digests taken directly from reference/upstream at mobius@33ed2ece.
// CI does not need that gitignored directory to enforce byte parity.
test.each([
	[
		"index.ts",
		"8da507c1765c75d25079954fc95cbf1e1970a0709c421e8619b12edadc559444",
	],
	[
		"index.test.ts",
		"dce4d8781676a7cf4b8c19b66bf5ae8465d7a59d87bce24c90c1da1cf95e04e1",
	],
])(
	"%s is byte-exact upstream after the required provenance header",
	async (file, digest) => {
		const contents = await Bun.file(
			new URL(`../src/${file}`, import.meta.url),
		).text();
		const header = `// Ported from mobius@33ed2ece packages/funding-rates/src/${file}\n`;
		expect(contents.startsWith(header)).toBe(true);
		expect(
			new Bun.CryptoHasher("sha256")
				.update(contents.slice(header.length))
				.digest("hex"),
		).toBe(digest);
	},
);
