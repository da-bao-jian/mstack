import type { Fetch } from "@mobstack/funding";
import { apiBase } from "./config.ts";
import { clean, table } from "./render.ts";

// Field names follow mobius@33ed2ece funding-server/src/server/routes/arbitrage.ts publicTask.
// This is a read schema, not a copy of the server projection or its private task model.
const textFields = [
	"task_id",
	"owner",
	"long_venue",
	"short_venue",
	"long_market",
	"short_market",
	"status",
] as const;
const numericFields = [
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
const nullableTextFields = [
	"long_margin_mode",
	"short_margin_mode",
	"liq_trim_notice",
	"resize_notice",
	"long_order_id",
	"short_order_id",
	"close_reason",
	"error",
] as const;
const timeFields = ["funding_updated_at", "created_at", "updated_at"] as const;
const booleanFields = [
	"auto_close",
	"size_mismatch_suppressed",
	"liq_protection_suspended",
] as const;

type PublicTask = Record<string, unknown>;

function record(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error("expected object");
	return value as Record<string, unknown>;
}

function validateTask(value: unknown): PublicTask {
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
	return row;
}

async function request<T>(
	fetcher: Fetch,
	base: string,
	path: string,
	params: Record<string, string>,
	version: string,
	validate: (body: unknown) => T,
): Promise<T> {
	const url = new URL(`${apiBase(base)}/api/arbitrage/${path}`);
	for (const [key, value] of Object.entries(params))
		url.searchParams.set(key, value);
	const response = await fetcher(url.href, {
		redirect: "error",
		signal: AbortSignal.timeout(30_000),
		headers: {
			"X-Mobius-Client": `mobstack/${version}`,
			"User-Agent": `mobstack/${version}`,
			accept: "application/json",
		},
	});
	const body = await response.text();
	const fail = (reason: string) =>
		new Error(
			`${path}: HTTP ${response.status}: ${reason}; body: ${clean(body.slice(0, 240))}`,
		);
	if (!response.ok) throw fail("request failed");
	try {
		return validate(JSON.parse(body));
	} catch (error) {
		throw fail(
			`malformed body (${error instanceof Error ? error.message : String(error)})`,
		);
	}
}

interface LogPage {
	attempts: Record<string, unknown>[];
	nextCursor: string | null;
	total?: number;
}

function logPage(value: unknown, path: "liq-trims" | "resizes"): LogPage {
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

export interface StatusResult {
	tasks: PublicTask[];
	trims?: Record<string, unknown>[];
	resizes?: Record<string, unknown>[];
	observedAt: number;
	source: "hosted";
	annualizationMethod: "simple";
}

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
	const params = {
		owner: options.owner,
		...(options.task ? { taskId: options.task } : {}),
	};
	const tasks = await request(
		options.fetch,
		options.apiBase,
		options.task ? "task" : "list",
		params,
		options.version,
		(body) => {
			if (options.task) return [validateTask(body)];
			if (!Array.isArray(body)) throw new Error("expected task array");
			return body.map(validateTask);
		},
	);
	const result: StatusResult = {
		tasks,
		observedAt: options.now(),
		source: "hosted",
		annualizationMethod: "simple",
	};
	for (const [enabled, path, key] of [
		[options.trims, "liq-trims", "trims"],
		[options.resizes, "resizes", "resizes"],
	] as const) {
		if (!enabled) continue;
		const attempts: Record<string, unknown>[] = [];
		const cursors = new Set<string>();
		let cursor: string | null = null;
		do {
			const page: LogPage = await request(
				options.fetch,
				options.apiBase,
				path,
				{ ...params, limit: "50", ...(cursor ? { cursor } : {}) },
				options.version,
				(body) => logPage(body, path),
			);
			attempts.push(...page.attempts);
			cursor = page.nextCursor;
			if (cursor !== null) {
				if (cursors.has(cursor))
					throw new Error(`${path}: repeated cursor ${cursor}`);
				cursors.add(cursor);
			}
		} while (cursor !== null);
		result[key] = attempts;
	}
	return result;
}

export function renderStatus(result: StatusResult): string {
	const fields = [
		...textFields,
		...numericFields,
		...nullableTextFields,
		...timeFields,
		...booleanFields,
		"error_context",
	];
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
