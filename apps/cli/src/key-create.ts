import { isApiKey, type KeyMeta, prefixOf, redactKey } from "@mstack/keys";
import type { Json, JsonObject } from "@mstack/proposals";
import { getConfig, readConfig } from "./config.ts";
import { cliKeyStore } from "./key-store.ts";
import { object } from "./onboarding-http.ts";
import type { Runtime } from "./run.ts";

/** Stores the key from a creation answer and returns a redacted view of it. */
export async function storeCreatedKey(
	rt: Runtime,
	owner: `0x${string}`,
	body: JsonObject,
	answer: Json,
): Promise<{ key: string; backend: string } & Record<string, Json>> {
	const secret = object(answer).key;
	if (typeof secret !== "string" || !isApiKey(secret))
		throw new Error("Key creation response did not contain a valid API key");
	const keyStore = await cliKeyStore(rt);
	const meta: KeyMeta = {
		name: String(body.name),
		venues: (body.venues as string[]).map(String),
		maxSizeUsd: Number(body.maxSizeUsd),
		importedAt: rt.now(),
		verifiedAt: rt.now(),
		apiBase: String(getConfig(await readConfig(rt.home), "strategy_api_base")),
	};
	await keyStore.put(owner, secret, meta);
	return JSON.parse(
		redactKey(
			JSON.stringify({
				...object(answer),
				key: prefixOf(secret),
				backend: keyStore.backend,
			}),
		),
	);
}
