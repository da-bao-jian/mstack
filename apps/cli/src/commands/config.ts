import { getConfig, readConfig, setConfig, UsageError } from "../config.ts";
import type { Runtime } from "./runtime.ts";

type ConfigOptions =
	| { action: "get"; key: string }
	| { action: "set"; key: string; value: string };

export async function config(
	options: ConfigOptions,
	rt: Runtime,
): Promise<string | number> {
	if (options.action === "get")
		return getConfig(await readConfig(rt.home), options.key);
	if (options.action === "set")
		return setConfig(options.key, options.value, rt.home);
	throw new UsageError("Usage: mob config get <key> | set <key> <value>");
}
