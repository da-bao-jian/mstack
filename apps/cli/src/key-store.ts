import { createKeyStore, type KeyStore, type StoredKey } from "@mstack/keys";
import { getConfig, readConfig, UsageError } from "./config.ts";

type KeyRuntime = {
	home: string;
	now: () => number;
	env?: Record<string, string | undefined>;
};

export async function cliKeyStore(rt: KeyRuntime): Promise<KeyStore> {
	const config = await readConfig(rt.home);
	return createKeyStore({
		home: rt.home,
		selection: getConfig(config, "key_store") as Parameters<
			typeof createKeyStore
		>[0]["selection"],
		env: rt.env ?? process.env,
		apiBase: String(getConfig(config, "strategy_api_base")),
		now: rt.now,
	});
}

const normal = (base: string) => new URL(base).href.replace(/\/$/, "");

/** The stored key, only for the API base it was verified against. A key is
 * never sent to another base, even after `strategy_api_base` changes. */
export function keyFor(stored: StoredKey, base: string): string {
	if (normal(stored.meta.apiBase) === normal(base)) return stored.key;
	throw new UsageError(
		`The stored API key belongs to ${stored.meta.apiBase}, not ${base}; it was not sent. Run \`mob config set strategy_api_base ${stored.meta.apiBase}\` to go back, or \`mob keys delete\` and import a key for ${base}.`,
	);
}

/** Before the server creates a key: refuse a store that cannot keep it. */
export async function requireWritableKeyStore(
	rt: KeyRuntime,
	owner: string,
): Promise<void> {
	const store = await cliKeyStore(rt);
	if (store.backend === "env")
		throw new UsageError(
			"MOBIUS_API_KEY is set, so mob cannot store a new key; unset it before creating a key. No key was created.",
		);
	try {
		await store.checkWritable(owner);
	} catch (error) {
		throw new UsageError(
			`The ${store.backend} key store cannot save a key (${error instanceof Error ? error.message : String(error)}); unlock or fix it first. No key was created.`,
		);
	}
}
