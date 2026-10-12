export const API_KEY_PATTERN =
	/^mobius_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[0-9a-f]{64}$/;
const KEY_PATTERN = /mobius_([0-9a-fA-F-]{36})\.[0-9a-fA-F]{64}/g;

export function isApiKey(value: string): boolean {
	return API_KEY_PATTERN.test(value);
}

export function prefixOf(value: string): string {
	if (!isApiKey(value)) throw new Error("Invalid Mobius API key");
	return `${value.slice(0, value.indexOf("."))}…`;
}

/** Keep this byte-for-byte equivalent to @mstack/mobius-api redactKey (W18). */
export function redactKey(text: string): string {
	return text.replace(KEY_PATTERN, "mobius_$1…");
}
