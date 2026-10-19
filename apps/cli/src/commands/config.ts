import { readSecretFromTty, type SecretReader } from "@mstack/signers";
import {
	getConfig,
	parsedValue,
	readConfig,
	setConfig,
	UsageError,
} from "../config.ts";
import type { Runtime } from "./runtime.ts";

type ConfigOptions =
	| { action: "get"; key: string }
	| { action: "set"; key: string; value: string };

// Settings that let the agent submit, or move requests and keys elsewhere.
// Only the human's own terminal may change them; an agent shell has no TTY.
const HUMAN_ONLY = [
	"policy",
	"api_base",
	"strategy_api_base",
	"auth_base",
	"app_base",
	"key_store",
	"walletconnect_project_id",
];

export async function config(
	options: ConfigOptions,
	rt: Runtime & {
		stdinIsTTY?: boolean;
		stdoutIsTTY?: boolean;
		readSecret?: SecretReader;
	},
): Promise<string | number> {
	if (options.action === "get")
		return getConfig(await readConfig(rt.home), options.key);
	if (options.action === "set") {
		if (HUMAN_ONLY.includes(options.key)) {
			const value = parsedValue(options.key, options.value);
			if (!rt.stdinIsTTY || !rt.stdoutIsTTY)
				throw new UsageError(
					`mob config set ${options.key} needs your own terminal; run it there`,
				);
			// The confirmation comes from the controlling terminal, not stdin.
			const answer = await (rt.readSecret ?? readSecretFromTty)(
				`Type yes and press Enter to set ${options.key} to ${value} (input is hidden): `,
			);
			if (answer.trim().toLowerCase() !== "yes")
				throw new UsageError(`${options.key} unchanged`);
		}
		return setConfig(options.key, options.value, rt.home);
	}
	throw new UsageError("Usage: mob config get <key> | set <key> <value>");
}
