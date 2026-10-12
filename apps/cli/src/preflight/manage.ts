import type { MarketMetadata, ObservedFundingRate } from "@mstack/funding";
import type { PublicTask } from "@mstack/mobius-client";
import type { Config } from "../config.ts";
import {
	CheckFailure,
	Checks,
	configChecks,
	type Reader,
	requireValue,
} from "./checks.ts";
import { quantizeLot } from "./open.ts";
import { planResize, type ResizeLegInput } from "./resizePlan.ts";

export type ManageCommand =
	| "close"
	| "cancel"
	| "neutralize"
	| "resize"
	| "protect"
	| "auto-close"
	| "size-mismatch-close";
export interface ManageReads extends Reader {
	market: (
		venue: string,
		market: string,
	) => Promise<{ row: ObservedFundingRate; metadata: MarketMetadata }>;
}
export async function managePreflight(
	command: ManageCommand,
	taskId: string,
	config: Config,
	targets: { long?: number; short?: number },
	reads: ManageReads,
	now = Date.now,
	apiSubmit = false,
) {
	const checks = new Checks(now);
	let task: PublicTask | undefined;
	const quantized: { longTargetBase?: number; shortTargetBase?: number } = {};
	try {
		await configChecks(config, checks, undefined, apiSubmit);
		const params = { owner: config.owner as string, taskId };
		try {
			task = await reads.read("/api/arbitrage/task", params);
			requireValue(task.task_id === taskId, "Task id does not match request");
		} catch (error) {
			checks.fail("/api/arbitrage/task", "task.exists", error);
		}
		requireValue(task, "Task is missing");
		checks.recordRead({
			route: "/api/arbitrage/task",
			name: "task.exists",
			params,
			assertions: [{ path: ["task_id"], equals: taskId }],
		});
		if (task.owner.toLowerCase() !== config.owner?.toLowerCase())
			checks.fail(
				"/api/arbitrage/task",
				"task.owner",
				new Error("Task owner does not match configured owner"),
			);
		checks.recordRead({
			route: "/api/arbitrage/task",
			name: "task.owner",
			params,
			assertions: [{ path: ["owner"], equals: task.owner }],
		});
		const nonterminal = [
			"pending",
			"ordering",
			"running",
			"neutralizing",
			"trimming",
			"resizing",
			"mismatch_checking",
			"leg_gone_checking",
			"closing",
		];
		if (
			!(command === "close"
				? apiSubmit
					? task.status === "running"
					: nonterminal.includes(task.status)
				: command === "cancel"
					? task.status === "pending"
					: task.status === "running")
		)
			checks.fail(
				"/api/arbitrage/task",
				"task.status",
				new Error(
					`${command} requires ${command === "close" ? (apiSubmit ? "a running task" : "a non-terminal task") : command === "cancel" ? "a pending task" : "a running task"}; status=${task.status}`,
				),
			);
		checks.recordRead({
			route: "/api/arbitrage/task",
			name: "task.status",
			params,
			assertions: [{ path: ["status"], equals: task.status }],
		});
		if (command === "resize") {
			if (apiSubmit) {
				await checks.fact("resize", () => {
					requireValue(
						targets.long !== undefined || targets.short !== undefined,
						"resize requires --long and/or --short base",
					);
					for (const side of ["long", "short"] as const) {
						const target = targets[side];
						if (target === undefined) continue;
						requireValue(
							Number.isFinite(target) && target > 0,
							`${side}: target must be positive; use close to exit`,
						);
						quantized[`${side}TargetBase`] = target;
					}
					return `Targets are valued server-side: ${Object.entries(quantized)
						.map(([key, value]) => `${key}=${value}`)
						.join(", ")}`;
				});
				return { ...checks.result(), task, quantized };
			}
			const fixedTask = task;
			await checks.fact("resize", async () => {
				requireValue(
					targets.long !== undefined || targets.short !== undefined,
					"resize requires --long and/or --short base",
				);
				const legs = {} as Record<"long" | "short", ResizeLegInput>;
				const resolved = { long: null, short: null } as {
					long: number | null;
					short: number | null;
				};
				for (const side of ["long", "short"] as const) {
					const { row, metadata } = await reads.market(
						fixedTask[`${side}_venue`],
						fixedTask[`${side}_market`],
					);
					const current = fixedTask[`${side}_size`];
					requireValue(
						typeof current === "number" &&
							Number.isFinite(current) &&
							current >= 0,
						`${side}: current base is unreadable`,
					);
					requireValue(
						typeof row.markPrice === "number" &&
							Number.isFinite(row.markPrice) &&
							row.markPrice > 0,
						`${side}: mark is unreadable`,
					);
					legs[side] = {
						side,
						currentBase: current,
						markPrice: row.markPrice,
						minBase: metadata.minBase,
						minNotionalUsd: metadata.minNotionalUsd,
						sizeDecimals: metadata.sizeDecimals,
					};
					const target = targets[side];
					if (target !== undefined) {
						requireValue(
							Number.isFinite(target) && target > 0,
							`${side}: target must be positive; use close to exit`,
						);
						resolved[side] = quantizeLot(target, metadata, target < current);
					}
				}
				const plan = planResize({
					long: legs.long,
					short: legs.short,
					targets: resolved,
					linked: false,
				});
				requireValue(
					plan.submittable,
					plan.problems[0]?.message ?? "Resize quantizes to no change",
				);
				if (targets.long !== undefined)
					quantized.longTargetBase = plan.legs.long?.targetBase;
				if (targets.short !== undefined)
					quantized.shortTargetBase = plan.legs.short?.targetBase;
				return `Quantized toward current: ${Object.entries(quantized)
					.map(([key, value]) => `${key}=${value}`)
					.join(
						", ",
					)}; net base=${plan.netDeltaBase}; size-mismatch auto-close remains unchanged`;
			});
			// A preview must refuse if the position sizes used by the resize have changed.
			checks.recordRead({
				route: "/api/arbitrage/task",
				name: "resize.current-sizes",
				params,
				assertions: [
					{ path: ["long_size"], equals: task.long_size },
					{ path: ["short_size"], equals: task.short_size },
				],
			});
		}
	} catch (error) {
		if (!(error instanceof CheckFailure)) throw error;
	}
	return { ...checks.result(), task, quantized };
}
