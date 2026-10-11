// Field names follow mobius@33ed2ece funding-server/src/server/routes/arbitrage.ts publicTask.
// This is a read schema, not a copy of the server projection or its private task model.
export const textFields = [
	"task_id",
	"owner",
	"long_venue",
	"short_venue",
	"long_market",
	"short_market",
	"status",
] as const;
export const numericFields = [
	"size_usd",
	"long_price",
	"short_price",
	"min_funding_apy",
	"long_leverage",
	"short_leverage",
	"max_spread_bps",
	"liq_protection_pct",
	"size_mismatch_pct",
	"liq_trim_count",
	"resize_target_long",
	"resize_target_short",
	"resize_count",
	"long_entry",
	"short_entry",
	"long_size",
	"short_size",
	"funding_usd",
] as const;
export const nullableTextFields = [
	"long_margin_mode",
	"short_margin_mode",
	"liq_trim_notice",
	"resize_notice",
	"long_order_id",
	"short_order_id",
	"close_reason",
	"error",
] as const;
export const timeFields = [
	"funding_updated_at",
	"created_at",
	"updated_at",
] as const;
export const booleanFields = [
	"auto_close",
	"size_mismatch_suppressed",
	"liq_protection_suspended",
] as const;

export type PublicTask = Record<
	Exclude<(typeof textFields)[number], "task_id">,
	string
> & {
	task_id: string | number;
	error_context: Record<string, unknown> | null;
} & Record<(typeof numericFields)[number], number | string | null> &
	Record<(typeof nullableTextFields)[number], string | null> &
	Record<(typeof timeFields)[number], number | string | null> &
	Record<(typeof booleanFields)[number], boolean>;

export function record(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error("expected object");
	return value as Record<string, unknown>;
}

export function validateTask(value: unknown): PublicTask {
	const row = record(value);
	for (const key of textFields) {
		if (
			key === "task_id" &&
			typeof row[key] === "number" &&
			Number.isSafeInteger(row[key])
		)
			continue;
		if (typeof row[key] !== "string" || row[key] === "")
			throw new Error(`invalid ${key}`);
	}
	if (typeof row.owner !== "string" || !/^0x[\da-f]{40}$/i.test(row.owner))
		throw new Error("invalid owner");
	for (const key of numericFields) {
		const item = row[key];
		if (item === null) continue;
		if (
			(typeof item !== "number" &&
				(typeof item !== "string" ||
					!/^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i.test(item))) ||
			!Number.isFinite(Number(item))
		)
			throw new Error(`invalid ${key}`);
	}
	for (const key of nullableTextFields) {
		if (row[key] !== null && typeof row[key] !== "string")
			throw new Error(`invalid ${key}`);
	}
	for (const key of timeFields) {
		const item = row[key];
		if (key === "funding_updated_at" && item === null) continue;
		if (
			typeof item === "number"
				? !Number.isFinite(item) || item < 0
				: typeof item !== "string" || !Number.isFinite(Date.parse(item))
		)
			throw new Error(`invalid ${key}`);
	}
	for (const key of booleanFields)
		if (typeof row[key] !== "boolean") throw new Error(`invalid ${key}`);
	if (row.error_context !== null) {
		const context = record(row.error_context);
		if (context.version !== 1) throw new Error("invalid error_context version");
		for (const field of ["phase", "action", "leg", "closeReason"])
			if (
				context[field] !== undefined &&
				context[field] !== null &&
				typeof context[field] !== "string"
			)
				throw new Error(`invalid error_context.${field}`);
		if (
			context.normalClose !== undefined &&
			typeof context.normalClose !== "boolean"
		)
			throw new Error("invalid error_context.normalClose");
	}
	return row as PublicTask;
}

export interface LogPage {
	attempts: Record<string, unknown>[];
	nextCursor: string | null;
	total?: number;
}

export function logPage(
	value: unknown,
	path: "liq-trims" | "resizes",
): LogPage {
	const body = record(value);
	if (
		!Array.isArray(body.attempts) ||
		(body.nextCursor !== null &&
			(typeof body.nextCursor !== "string" || !/^\d+$/.test(body.nextCursor)))
	)
		throw new Error("invalid log page");
	for (const value of body.attempts) {
		const row = record(value);
		const fields =
			path === "liq-trims"
				? [
						"id",
						"attempted_at",
						"threshold_pct",
						"breached_leg",
						"breached_dist_pct",
						"action",
						"outcome",
						"steps",
						"error",
					]
				: [
						"id",
						"attempted_at",
						"mode",
						"target_long",
						"target_short",
						"outcome",
						"steps",
						"error",
					];
		for (const field of fields)
			if (!Object.hasOwn(row, field)) throw new Error(`missing log ${field}`);
		if (
			!Array.isArray(row.steps) ||
			typeof row.outcome !== "string" ||
			(row.error !== null && typeof row.error !== "string")
		)
			throw new Error("invalid log attempt");
	}
	if (
		path === "resizes" &&
		(!Number.isSafeInteger(body.total) || Number(body.total) < 0)
	)
		throw new Error("invalid resize total");
	return body as unknown as LogPage;
}
