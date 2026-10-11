/** Mulberry32: deterministic test data, never used for keys, tokens or nonces. */
export function seeded(seed: number) {
	return (limit: number) => {
		seed += 0x6d2b79f5;
		let n = seed;
		n = Math.imul(n ^ (n >>> 15), n | 1);
		n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
		return Math.floor((((n ^ (n >>> 14)) >>> 0) / 4294967296) * limit);
	};
}
