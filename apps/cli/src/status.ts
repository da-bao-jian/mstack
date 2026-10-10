import {
	booleanFields,
	nullableTextFields,
	numericFields,
	type StatusResult,
	textFields,
	timeFields,
} from "@mstack/mobius-client";
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
	].join(" | ");
}

export function renderStatus(result: StatusResult): string {
	const fields = [
		...textFields,
		...numericFields,
		...nullableTextFields,
		...timeFields,
		...booleanFields,
		"error_context",
	] as const;
	const tasks = result.tasks.map((task) =>
		table(
			["field", "value"],
			fields.map((key) => [
				key === "funding_usd" ? "funding_usd (estimate)" : key,
				task[key],
			]),
		),
	);
	if (!tasks.length) tasks.push("No tasks.");
	for (const key of ["trims", "resizes"] as const)
		if (result[key])
			tasks.push(
				`${key}:\n${result[key].length ? result[key].map((row) => table(["field", "value"], Object.entries(row))).join("\n\n") : "No attempts."}`,
			);
	return tasks.join("\n\n");
}
