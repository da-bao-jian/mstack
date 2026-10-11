import {
	booleanFields,
	nullableTextFields,
	numericFields,
	type StatusResult,
	textFields,
	timeFields,
} from "@mstack/mobius-client";
import { number, paint, relative, type Terminal, usd } from "./format.ts";
import { clean, table } from "./render.ts";

export function statusFooter(
	result: StatusResult,
	api: string,
	now: number,
): string {
	return [
		`api: ${clean(api)}`,
		`fetched: ${Math.max(0, (now - result.observedAt) / 1000).toFixed(1)}s`,
		`tasks: ${result.tasks.length}`,
		...(result.trims ? [`trims: ${result.trims.length}`] : []),
		...(result.resizes ? [`resizes: ${result.resizes.length}`] : []),
		"annualized = simple, not compounded",
	].join(" | ");
}

export function renderStatus(
	result: StatusResult,
	now = Date.now(),
	terminal: Terminal = {},
): string {
	const fields = [
		...textFields,
		...numericFields,
		...nullableTextFields,
		...booleanFields,
		"error_context",
	] as const;
	const tones = {
		running: "success",
		pending: "warning",
		ordering: "warning",
		closing: "info",
		trimming: "info",
		failed: "danger",
		closed: "muted",
	} as const;
	function value(key: string, item: unknown): string {
		if ((timeFields as readonly string[]).includes(key)) {
			const time =
				typeof item === "number"
					? item < 1e12
						? item * 1000
						: item
					: Date.parse(String(item));
			return Number.isFinite(time) ? relative(time, now) : clean(item);
		}
		if ((numericFields as readonly string[]).includes(key)) {
			const n = Number(item);
			if (key.endsWith("_usd")) return usd(n);
			if (key.endsWith("_pct") || key.endsWith("_apy"))
				return `${number(n, 2)}%`;
			if (key.endsWith("_bps")) return `${number(n, 4)} bps`;
			if (/size|target/.test(key) && n !== 0 && Math.abs(n) < 0.0001)
				return String(n);
			return number(n, /count/.test(key) ? 0 : /leverage/.test(key) ? 2 : 4);
		}
		return clean(item);
	}
	const tasks = result.tasks.map((task) => {
		const risk = fields.filter((key) =>
			/apy|leverage|margin_mode|spread|protection|mismatch|auto_close/.test(
				key,
			),
		);
		const activity = fields.filter((key) =>
			/notice|count|order_id|error|close_reason|resize_target|funding_usd/.test(
				key,
			),
		);
		const position = fields.filter(
			(key) =>
				!risk.includes(key) &&
				!activity.includes(key) &&
				!["status", "task_id"].includes(key),
		);
		const groups: [string, readonly string[]][] = [
			["Position", position],
			["Risk", risk],
			["Activity", activity],
			["Timestamps", timeFields],
		];
		return [
			paint(`Position ${clean(task.task_id)}`, "bold", terminal) +
				" " +
				paint(
					`[${clean(task.status)}]`,
					tones[task.status as keyof typeof tones] ?? "muted",
					terminal,
				),
			...groups
				.map(([title, keys]) => {
					const rows = keys
						.filter(
							(key) =>
								task[key as keyof typeof task] !== null &&
								task[key as keyof typeof task] !== undefined,
						)
						.map((key) => [
							key === "funding_usd" ? "funding_usd (estimate)" : key,
							value(key, task[key as keyof typeof task]),
						]);
					return rows.length
						? `${paint(title, "sky", terminal)}\n${table(["field", "value"], rows)}`
						: "";
				})
				.filter(Boolean),
		].join("\n");
	});
	if (!tasks.length) tasks.push("No positions. Try `mob scan`.");
	for (const key of ["trims", "resizes"] as const)
		if (result[key])
			tasks.push(
				`${paint(`Activity · ${key}`, "sky", terminal)}:\n${
					result[key].length
						? result[key]
								.map((row) =>
									table(
										["field", "value"],
										Object.entries(row)
											.filter(([, item]) => item !== null)
											.map(([key, item]) => [key, value(key, item)]),
									),
								)
								.join("\n\n")
						: "No attempts."
				}`,
			);
	return tasks.join("\n\n");
}
