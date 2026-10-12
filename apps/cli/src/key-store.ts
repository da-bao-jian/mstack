import { createKeyStore, type KeyStore } from "@mstack/keys";
import { getConfig, readConfig } from "./config.ts";

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
