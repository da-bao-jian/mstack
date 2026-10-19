import {
	classifySignRequest,
	bindingMessage as makeBindingMessage,
	preparePayload as makePreparePayload,
	readHeaders as makeReadHeaders,
	readPayload as makeReadPayload,
} from "./binding.ts";
import {
	ApiKeyRejected,
	ApiKeyScope,
	ApiRateLimited,
	IdempotencyConflict,
	redactKey,
	StrategyApiError,
	StrategyApiUnavailable,
} from "./errors.ts";
import type {
	AcceptedStatus,
	AcceptedTask,
	BindingTarget,
	CreateTask,
	Fetch,
	MutationOptions,
	PrepareVenueBindings,
	RequestLog,
	ResizeTask,
	SubmitVenueBindings,
	Task,
	Venue,
	VenueBindingBatch,
} from "./types.ts";

type Clock = () => number;
type RequestOptions = { signal?: AbortSignal };
type WalletRead = RequestOptions & {
	owner: string;
	expiresAt: number;
	signature: string;
};

function apiBase(value: string): string {
	const url = new URL(value);
	if (
		!["https:", "http:"].includes(url.protocol) ||
		url.username ||
		url.password ||
		url.search ||
		url.hash
	)
		throw new Error(
			"base must be an HTTP(S) URL without credentials, query, or fragment",
		);
	return url.href.replace(/\/$/, "");
}

function record(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error("expected an object");
	return value as Record<string, unknown>;
}
function string(row: Record<string, unknown>, key: string): string {
	if (typeof row[key] !== "string") throw new Error(`invalid ${key}`);
	return row[key];
}
function nullableString(
	row: Record<string, unknown>,
	key: string,
): string | null {
	if (row[key] !== null && typeof row[key] !== "string")
		throw new Error(`invalid ${key}`);
	return row[key] as string | null;
}
function integer(row: Record<string, unknown>, key: string): number {
	if (!Number.isSafeInteger(row[key])) throw new Error(`invalid ${key}`);
	return row[key] as number;
}
function boolean(row: Record<string, unknown>, key: string): boolean {
	if (typeof row[key] !== "boolean") throw new Error(`invalid ${key}`);
	return row[key];
}
function exact(row: Record<string, unknown>, allowed: string[]): void {
	if (Object.keys(row).some((key) => !allowed.includes(key)))
		throw new Error("unsupported response field");
}
const venues: readonly string[] = ["aster", "hl", "lighter", "lighter-mainnet"];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function task(value: unknown): Task {
	const row = record(value);
	for (const key of [
		"taskId",
		"longMarket",
		"shortMarket",
		"sizeUsd",
		"status",
		"fundingUsd",
		"createdAt",
		"updatedAt",
	])
		string(row, key);
	if (!uuid.test(String(row.taskId))) throw new Error("invalid taskId");
	if (
		!venues.includes(string(row, "longVenue")) ||
		!venues.includes(string(row, "shortVenue"))
	)
		throw new Error("invalid venue");
	for (const key of [
		"longSize",
		"shortSize",
		"longEntry",
		"shortEntry",
		"longPrice",
		"shortPrice",
		"longLeverage",
		"shortLeverage",
		"liqProtectionPct",
		"sizeMismatchPct",
		"longMarginMode",
		"shortMarginMode",
		"closeReason",
		"error",
		"closeRequestedAt",
	])
		nullableString(row, key);
	return row as unknown as Task;
}

function signRequest(value: unknown, owner: string) {
	const row = record(value);
	exact(row, ["requestId", "venue", "action", "method", "payload"]);
	for (const key of ["requestId", "venue", "action", "method"])
		string(row, key);
	record(row.payload);
	if (!venues.includes(String(row.venue))) throw new Error("invalid venue");
	if (!["personal_sign", "eth_signTypedData_v4"].includes(String(row.method)))
		throw new Error("invalid method");
	classifySignRequest(row, { owner, venues: venues as Venue[] });
	return row;
}

function binding(value: unknown): VenueBindingBatch {
	const row = record(value);
	exact(row, [
		"bindingId",
		"owner",
		"expiresAt",
		"status",
		"results",
		"signRequests",
	]);
	for (const key of ["bindingId", "owner", "expiresAt", "status"])
		string(row, key);
	if (
		!uuid.test(String(row.bindingId)) ||
		!/^0x[0-9a-f]{40}$/i.test(String(row.owner))
	)
		throw new Error("invalid binding identity");
	if (
		![
			"awaiting_signatures",
			"processing",
			"bound",
			"partial_success",
			"failed",
		].includes(String(row.status))
	)
		throw new Error("invalid binding status");
	if (!Array.isArray(row.results) || !Array.isArray(row.signRequests))
		throw new Error("invalid binding arrays");
	for (const item of row.results) {
		const result = record(item);
		exact(result, ["venue", "sessionId", "status", "code", "retryable"]);
		for (const key of ["venue", "status"]) string(result, key);
		if (
			!venues.includes(String(result.venue)) ||
			![
				"awaiting_signatures",
				"queued",
				"confirming",
				"bound",
				"already_bound",
				"failed",
				"expired",
			].includes(String(result.status))
		)
			throw new Error("invalid binding result");
		if (result.sessionId !== null) string(result, "sessionId");
		if (result.code !== undefined) string(result, "code");
		if (result.retryable !== undefined) boolean(result, "retryable");
	}
	for (const item of row.signRequests) signRequest(item, String(row.owner));
	return row as unknown as VenueBindingBatch;
}

function accepted<S extends AcceptedStatus>(
	value: unknown,
	status: S,
): AcceptedTask<S> {
	const row = record(value);
	const taskId = string(row, "taskId");
	if (!uuid.test(taskId)) throw new Error("invalid taskId");
	if (row.status !== status) throw new Error("invalid status");
	return { taskId, status, disposition: "accepted, not executed" };
}

function idempotency(value: string): string {
	if (!/^[!-~]{1,128}$/.test(value))
		throw new Error(
			"Idempotency-Key must contain 1–128 printable ASCII characters.",
		);
	return value;
}

function retryAfter(value: string | null, now: Clock): number | undefined {
	if (!value) return undefined;
	if (/^\d+$/.test(value)) return Number(value);
	const date = Date.parse(value);
	return Number.isFinite(date)
		? Math.max(0, Math.ceil((date - now()) / 1000))
		: undefined;
}

export class StrategyApiClient {
	readonly base: string;
	readonly domain: string;
	private readonly now: Clock;

	constructor(
		private readonly options: {
			base: string;
			key?: string;
			version: string;
			fetch?: Fetch;
			now?: Clock;
			domain?: string;
		},
	) {
		this.base = apiBase(options.base);
		this.domain = options.domain ?? "mobius-api";
		this.now = options.now ?? Date.now;
	}

	bindingMessage(action: "prepare" | "read", payload: unknown): string {
		return makeBindingMessage(action, payload, this.domain);
	}
	preparePayload(value: {
		owner: string;
		venues: BindingTarget[];
		nonce: string;
		expiresAt: number;
	}) {
		return makePreparePayload(value, this.now);
	}
	readPayload(value: { owner: string; bindingId: string; expiresAt: number }) {
		return makeReadPayload(value, this.now);
	}
	readHeaders(value: { owner: string; expiresAt: number; signature: string }) {
		return makeReadHeaders(value, this.now);
	}

	private async request<T>(options: {
		route: string;
		path?: string;
		method: "GET" | "POST";
		auth: "none" | "bearer" | "wallet";
		body?: object;
		query?: Record<string, unknown>;
		idempotencyKey?: string;
		walletHeaders?: Record<string, string>;
		signal?: AbortSignal;
		validate: (value: unknown, status: number) => T;
	}): Promise<T> {
		const url = new URL(`${this.base}${options.path ?? options.route}`);
		for (const [key, value] of Object.entries(options.query ?? {}))
			if (value !== undefined) url.searchParams.set(key, String(value));
		if (options.method === "POST" && options.idempotencyKey === undefined)
			throw new Error("Idempotency-Key is required for every POST.");
		const idempotencyKey =
			options.method === "POST"
				? idempotency(options.idempotencyKey as string)
				: undefined;
		if (options.auth === "bearer" && !this.options.key)
			throw new ApiKeyRejected({
				route: options.route,
				status: 401,
				message: `${options.route}: API key required.`,
			});
		const timeout = AbortSignal.timeout(
			options.method === "GET" ? 30_000 : 60_000,
		);
		const signal = options.signal
			? AbortSignal.any([timeout, options.signal])
			: timeout;
		let response: Response;
		try {
			response = await (this.options.fetch ?? globalThis.fetch)(url.href, {
				method: options.method,
				redirect: "error",
				signal,
				headers: {
					"X-Mobius-Client": `mstack/${this.options.version}`,
					"User-Agent": `mstack/${this.options.version}`,
					accept: "application/json",
					...(options.auth === "bearer"
						? { Authorization: `Bearer ${this.options.key}` }
						: {}),
					...(options.method === "POST"
						? {
								"Content-Type": "application/json",
								"Idempotency-Key": idempotencyKey as string,
							}
						: {}),
					...options.walletHeaders,
				},
				...(options.method === "POST"
					? { body: JSON.stringify(options.body ?? {}) }
					: {}),
			});
		} catch (error) {
			throw new StrategyApiUnavailable({
				route: options.route,
				status: 0,
				message: `${options.route}: ${redactKey(error instanceof Error ? error.message : String(error))}`,
			});
		}
		const raw = await response.text();
		let value: unknown;
		try {
			value = JSON.parse(raw);
		} catch {
			throw new StrategyApiError({
				route: options.route,
				status: response.status,
				requestId: response.headers.get("X-Request-Id"),
				message: `${options.route}: malformed JSON response: ${redactKey(raw.slice(0, 240))}`,
			});
		}
		if (!response.ok) {
			const data =
				value && typeof value === "object"
					? (value as Record<string, unknown>)
					: {};
			const serverError =
				typeof data.error === "string" ? redactKey(data.error) : undefined;
			const code =
				typeof data.code === "string" ? redactKey(data.code) : undefined;
			const common = {
				route: options.route,
				status: response.status,
				requestId: response.headers.get("X-Request-Id"),
				serverError,
				code,
				taskId: typeof data.taskId === "string" ? data.taskId : undefined,
				message: `${options.route}: HTTP ${response.status}${serverError ? `: ${serverError}` : ""}`,
			};
			if (response.status === 401) throw new ApiKeyRejected(common);
			if (response.status === 403) throw new ApiKeyScope(common);
			if (response.status === 409) throw new IdempotencyConflict(common);
			if (response.status === 429)
				throw new ApiRateLimited(
					common,
					retryAfter(response.headers.get("Retry-After"), this.now),
				);
			if (response.status >= 500) throw new StrategyApiUnavailable(common);
			throw new StrategyApiError(common);
		}
		try {
			return options.validate(value, response.status);
		} catch (error) {
			throw new StrategyApiError({
				route: options.route,
				status: response.status,
				requestId: response.headers.get("X-Request-Id"),
				message: `${options.route}: malformed response (${redactKey(error instanceof Error ? error.message : String(error))})`,
			});
		}
	}

	health(signal?: AbortSignal) {
		return this.request({
			route: "/health",
			method: "GET",
			auth: "none",
			signal,
			validate: (value) => {
				const row = record(value);
				if (row.ok !== true) throw new Error("invalid ok");
				return { ok: true as const };
			},
		});
	}
	listTasks(
		params: {
			limit?: number;
			status?: string;
			updatedSince?: string;
			cursor?: string;
		} = {},
		signal?: AbortSignal,
	) {
		return this.request({
			route: "/v1/delta-neutral/tasks",
			method: "GET",
			auth: "bearer",
			query: params,
			signal,
			validate: (value) => {
				const row = record(value);
				if (
					!Array.isArray(row.tasks) ||
					(row.nextCursor !== null && typeof row.nextCursor !== "string")
				)
					throw new Error("invalid task list");
				return {
					tasks: row.tasks.map(task),
					nextCursor: row.nextCursor as string | null,
				};
			},
		});
	}
	createTask(body: CreateTask, options: MutationOptions) {
		return this.request({
			route: "/v1/delta-neutral/tasks",
			method: "POST",
			auth: "bearer",
			body,
			idempotencyKey: options.idempotencyKey,
			signal: options.signal,
			validate: (value) => accepted(value, "pending"),
		});
	}
	getTask(taskId: string, signal?: AbortSignal) {
		return this.request({
			route: "/v1/delta-neutral/tasks/{taskId}",
			path: `/v1/delta-neutral/tasks/${encodeURIComponent(taskId)}`,
			method: "GET",
			auth: "bearer",
			signal,
			validate: (value) => task(record(value).task),
		});
	}
	cancelTask(taskId: string, options: MutationOptions) {
		return this.command(taskId, "cancel", "cancelled", {}, options);
	}
	closeTask(taskId: string, options: MutationOptions) {
		return this.command(taskId, "close", "close_queued", {}, options);
	}
	resizeTask(taskId: string, body: ResizeTask, options: MutationOptions) {
		return this.command(taskId, "resize", "resizing", body, options);
	}
	private command<S extends AcceptedStatus>(
		taskId: string,
		action: "cancel" | "close" | "resize",
		status: S,
		body: object,
		options: MutationOptions,
	) {
		const route = `/v1/delta-neutral/tasks/{taskId}/${action}`;
		return this.request({
			route,
			path: `/v1/delta-neutral/tasks/${encodeURIComponent(taskId)}/${action}`,
			method: "POST",
			auth: "bearer",
			body,
			idempotencyKey: options.idempotencyKey,
			signal: options.signal,
			validate: (value) => accepted(value, status),
		});
	}
	listRequests(signal?: AbortSignal) {
		return this.request({
			route: "/v1/requests",
			method: "GET",
			auth: "bearer",
			signal,
			validate: (value) => {
				const row = record(value);
				if (!Array.isArray(row.requests) || row.requests.length > 100)
					throw new Error("invalid requests");
				const requests = row.requests.map((item) => {
					const request = record(item);
					for (const key of ["request_id", "action", "path", "created_at"])
						string(request, key);
					if (!uuid.test(String(request.request_id)))
						throw new Error("invalid request_id");
					integer(request, "http_status");
					boolean(request, "replayed");
					for (const key of ["task_id", "error_code", "order_id"])
						nullableString(request, key);
					return request as unknown as RequestLog;
				});
				return { requests };
			},
		});
	}
	prepareVenueBindings(body: PrepareVenueBindings, options: MutationOptions) {
		return this.request({
			route: "/v1/venue-bindings/prepare",
			method: "POST",
			auth: "none",
			body,
			idempotencyKey: options.idempotencyKey,
			signal: options.signal,
			validate: binding,
		});
	}
	submitVenueBindings(
		bindingId: string,
		body: SubmitVenueBindings,
		options: MutationOptions,
	) {
		return this.request({
			route: "/v1/venue-bindings/{bindingId}/submit",
			path: `/v1/venue-bindings/${encodeURIComponent(bindingId)}/submit`,
			method: "POST",
			auth: "none",
			body,
			idempotencyKey: options.idempotencyKey,
			signal: options.signal,
			validate: binding,
		});
	}
	getVenueBinding(bindingId: string, options: WalletRead) {
		return this.request({
			route: "/v1/venue-bindings/{bindingId}",
			path: `/v1/venue-bindings/${encodeURIComponent(bindingId)}`,
			method: "GET",
			auth: "wallet",
			signal: options.signal,
			walletHeaders: this.readHeaders(options),
			validate: binding,
		});
	}
}
