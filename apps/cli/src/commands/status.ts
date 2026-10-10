import { fetchStatus } from "@mstack/mobius-client";
import pkg from "../../package.json";
import {
	apiBase,
	getConfig,
	ownerAddress,
	readConfig,
	UsageError,
} from "../config.ts";
import type { Runtime } from "./runtime.ts";

export interface StatusOptions {
	owner?: string;
	taskId?: string;
	trims?: boolean;
	resizes?: boolean;
	apiBase?: string;
}

const api = Symbol("statusApi");
export function statusApi(result: Awaited<ReturnType<typeof status>>): string {
	return result[api];
}

export async function status(options: StatusOptions, rt: Runtime) {
	const config = await readConfig(rt.home);
	const configuredOwner = options.owner ?? config.owner;
	if (!configuredOwner)
		throw new UsageError(
			"status requires --owner or config key owner (mob config set owner 0x…)",
		);
	const owner = ownerAddress(configuredOwner);
	const endpoint = apiBase(
		options.apiBase ?? String(getConfig(config, "api_base")),
	);
	if (options.taskId !== undefined && options.taskId.trim() === "")
		throw new UsageError("task must be nonempty");
	if ((options.trims || options.resizes) && !options.taskId)
		throw new UsageError("--trims and --resizes require --task");
	const data = await fetchStatus({
		owner,
		task: options.taskId,
		trims: options.trims === true,
		resizes: options.resizes === true,
		apiBase: endpoint,
		version: pkg.version,
		fetch: rt.fetch,
		now: rt.now,
	});
	return Object.defineProperty(data, api, {
		value: endpoint,
	}) as typeof data & { readonly [api]: string };
}
