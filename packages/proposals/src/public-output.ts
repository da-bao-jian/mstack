import { redactKey } from "@mstack/keys";

/** Remote errors may echo submitted signatures, including split HL r/s values. */
export function publicText(text: string): string {
	return redactKey(text)
		.replace(/0x[\da-f]{64,}/gi, "[signature redacted]")
		.replace(
			/("(?:signature|L1Sig|r|s)"\s*:\s*)("(?:\\.|[^"\\])*"|\{[^}]*\})/gi,
			'$1"[redacted]"',
		);
}

export function publicValue<T>(value: T): T {
	if (value === undefined) return value;
	return JSON.parse(
		JSON.stringify(value, (key, item) => {
			if (/^(?:signature|L1Sig|r|s)$/i.test(key)) return "[redacted]";
			return typeof item === "string" ? publicText(item) : item;
		}),
	) as T;
}
