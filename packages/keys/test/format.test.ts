import { expect, test } from "bun:test";
import { isApiKey, prefixOf, redactKey } from "../src/index.ts";

const key = `mobius_01234567-89ab-cdef-0123-456789abcdef.${"ab".repeat(32)}`;

test("validates, prefixes, and redacts a Mobius API key", () => {
	expect(isApiKey(key)).toBe(true);
	expect(isApiKey(key.toUpperCase())).toBe(false);
	expect(prefixOf(key)).toBe("mobius_01234567-89ab-cdef-0123-456789abcdef…");
	expect(redactKey(`Bearer ${key}; again ${key}`)).toBe(
		"Bearer mobius_01234567-89ab-cdef-0123-456789abcdef…; again mobius_01234567-89ab-cdef-0123-456789abcdef…",
	);
});

test("redacts key-shaped text without requiring prior validation", () => {
	expect(redactKey(`error: ${key}`)).not.toContain("ab".repeat(32));
	expect(() => prefixOf("bad")).toThrow("Invalid Mobius API key");
});

test("redactKey matches the W18 @mstack/mobius-api contract", () => {
	expect(redactKey(`before ${key} after`)).toBe(
		"before mobius_01234567-89ab-cdef-0123-456789abcdef… after",
	);
});
