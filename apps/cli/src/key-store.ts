import { createKeyStore, type KeyStore } from "@mstack/keys";
import { getConfig, readConfig } from "./config.ts";
import type { Runtime } from "./run.ts";

export async function cliKeyStore(rt: Runtime): Promise<KeyStore> {
	const config = await readConfig(rt.home);
	return createKeyStore({
		home: rt.home,
		selection: getConfig(config, "key_store") as Parameters<
			typeof createKeyStore
		>[0]["selection"],
		env: rt.env ?? process.env,
		apiBase: String(getConfig(config, "api_base")),
		now: rt.now,
	});
}
