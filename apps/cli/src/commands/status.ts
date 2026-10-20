import { StrategyApiClient, type Task } from "@mstack/mobius-api";
import type { PublicTask, StatusResult } from "@mstack/mobius-client";
import { fetchStatus, MobiusClient } from "@mstack/mobius-client";
import pkg from "../../package.json";
import {
	apiBase,
	getConfig,
	OWNER_NEEDED,
	ownerAddress,
	readConfig,
	UsageError,
} from "../config.ts";
import { cliKeyStore, keyFor } from "../key-store.ts";
import { bindingReadiness } from "../preflight/readiness.ts";
import type { Runtime } from "./runtime.ts";

export async function readinessStatus(
	options: Pick<StatusOptions, "owner" | "apiBase">,
	rt: Runtime,
) {
	const config = await readConfig(rt.home);
	const owner = options.owner ?? config.owner;
	if (!owner) throw new UsageError(OWNER_NEEDED);
	return bindingReadiness(
		ownerAddress(owner),
		new MobiusClient({
			base: apiBase(options.apiBase ?? String(getConfig(config, "api_base"))),
			version: pkg.version,
			fetch: rt.fetch,
		}),
		rt.now,
	);
}

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
	if (!configuredOwner) throw new UsageError(OWNER_NEEDED);
	const owner = ownerAddress(configuredOwner);
	const endpoint = apiBase(
		options.apiBase ?? String(getConfig(config, "api_base")),
	);
	if (options.taskId !== undefined && options.taskId.trim() === "")
		throw new UsageError("task must be nonempty");
	if ((options.trims || options.resizes) && !options.taskId)
		throw new UsageError("--trims and --resizes require --task");
	const stored =
		config.owner?.toLowerCase() === owner.toLowerCase()
			? await (await cliKeyStore(rt)).get(owner)
			: null;
	if (stored && !options.trims && !options.resizes) {
		const strategyBase = apiBase(
			String(getConfig(config, "strategy_api_base")),
		);
		const client = new StrategyApiClient({
			base: strategyBase,
			key: keyFor(stored, strategyBase),
			version: pkg.version,
			fetch: rt.fetch,
			now: rt.now,
		});
		let tasks: Task[];
		if (options.taskId) tasks = [await client.getTask(options.taskId)];
		else {
			tasks = [];
			const cursors = new Set<string>();
			let cursor: string | undefined;
			do {
				const page = await client.listTasks({
					limit: 20,
					...(cursor ? { cursor } : {}),
				});
				tasks.push(...page.tasks);
				cursor = page.nextCursor ?? undefined;
				if (cursor) {
					if (cursors.has(cursor))
						throw new Error(`status: repeated cursor ${cursor}`);
					cursors.add(cursor);
				}
			} while (cursor);
		}
		const data: StatusResult = {
			tasks: tasks.map((task) => apiTask(task, owner)),
			observedAt: rt.now(),
			source: "api",
			annualizationMethod: "simple",
		};
		return Object.defineProperty(data, api, {
			value: strategyBase,
		}) as typeof data & { readonly [api]: string };
	}
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

function apiTask(task: Task, owner: string): PublicTask {
	return {
		task_id: task.taskId,
		owner,
		long_venue: task.longVenue,
		short_venue: task.shortVenue,
		long_market: task.longMarket,
		short_market: task.shortMarket,
		status: task.status,
		size_usd: task.sizeUsd,
		long_price: task.longPrice,
		short_price: task.shortPrice,
		min_funding_apy: null,
		long_leverage: task.longLeverage,
		short_leverage: task.shortLeverage,
		max_spread_bps: null,
		liq_protection_pct: task.liqProtectionPct,
		size_mismatch_pct: task.sizeMismatchPct,
		liq_trim_count: null,
		resize_target_long: null,
		resize_target_short: null,
		resize_count: null,
		long_entry: task.longEntry,
		short_entry: task.shortEntry,
		long_size: task.longSize,
		short_size: task.shortSize,
		funding_usd: task.fundingUsd,
		long_margin_mode: task.longMarginMode,
		short_margin_mode: task.shortMarginMode,
		liq_trim_notice: null,
		resize_notice: null,
		long_order_id: null,
		short_order_id: null,
		close_reason: task.closeReason,
		error: task.error,
		funding_updated_at: task.updatedAt,
		created_at: task.createdAt,
		updated_at: task.updatedAt,
		auto_close: false,
		size_mismatch_suppressed: false,
		liq_protection_suspended: false,
		error_context: null,
	};
}
