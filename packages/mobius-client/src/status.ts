import { MobiusClient } from "./client.ts";
import type { LogPage, PublicTask } from "./tasks.ts";
import type { Fetch } from "./types.ts";
export interface StatusResult {
	tasks: PublicTask[];
	trims?: Record<string, unknown>[];
	resizes?: Record<string, unknown>[];
	observedAt: number;
	source: "hosted";
	annualizationMethod: "simple";
}
export async function fetchStatus(options: {
	owner: string;
	task?: string;
	trims: boolean;
	resizes: boolean;
	apiBase: string;
	version: string;
	fetch: Fetch;
	now: () => number;
}): Promise<StatusResult> {
	const client = new MobiusClient({
		base: options.apiBase,
		version: options.version,
		fetch: options.fetch,
	});
	const tasks = options.task
		? [
				await client.read("/api/arbitrage/task", {
					owner: options.owner,
					taskId: options.task,
				}),
			]
		: await client.read("/api/arbitrage/list", { owner: options.owner });
	const result: StatusResult = {
		tasks,
		observedAt: options.now(),
		source: "hosted",
		annualizationMethod: "simple",
	};
	for (const [enabled, route, key] of [
		[options.trims, "/api/arbitrage/liq-trims", "trims"],
		[options.resizes, "/api/arbitrage/resizes", "resizes"],
	] as const) {
		if (!enabled) continue;
		if (!options.task) throw new Error("logs require taskId");
		const attempts: Record<string, unknown>[] = [];
		const cursors = new Set<string>();
		let cursor: string | null = null;
		do {
			const page: LogPage = await client.read(route, {
				owner: options.owner,
				taskId: options.task,
				limit: 50,
				...(cursor ? { cursor } : {}),
			});
			attempts.push(...page.attempts);
			cursor = page.nextCursor;
			if (cursor !== null) {
				if (cursors.has(cursor))
					throw new Error(`${key}: repeated cursor ${cursor}`);
				cursors.add(cursor);
			}
		} while (cursor !== null);
		result[key] = attempts;
	}
	return result;
}
