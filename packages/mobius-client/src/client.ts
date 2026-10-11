import { isVenueReadinessError } from "./binding.ts";
import { limitHost } from "./rate-limit.ts";
import { readRoutes, writeRoutes } from "./routes.ts";
import { logPage, record, validateTask } from "./tasks.ts";
import type { Fetch, ReadRoutes, WriteRoutes } from "./types.ts";

export function apiBase(value: string): string {
	const url = new URL(value);
	if (
		!["https:", "http:"].includes(url.protocol) ||
		url.username ||
		url.password ||
		url.search ||
		url.hash
	)
		throw new Error(
			"api_base must be an HTTP(S) URL without credentials, query, or fragment",
		);
	return url.href.replace(/\/$/, "");
}
export class ApiError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly data: unknown,
	) {
		super(message);
		this.name = "ApiError";
	}
}
const clean = (text: string) => text.replace(/[\p{Cc}\p{Cf}]/gu, " ");
function required(
	body: Record<string, unknown>,
	field: string,
	type: "string" | "number" | "boolean",
) {
	if (
		typeof body[field] !== type ||
		(type === "number" && !Number.isFinite(body[field]))
	)
		throw new Error(`invalid ${field}`);
}
function validateRead(route: keyof ReadRoutes, value: unknown): unknown {
	if (route === "/api/arbitrage/list") {
		if (!Array.isArray(value)) throw new Error("expected task array");
		return value.map(validateTask);
	}
	if (route === "/api/arbitrage/task") return validateTask(value);
	if (
		route === "/api/arbitrage/liq-trims" ||
		route === "/api/arbitrage/resizes"
	)
		return logPage(
			value,
			route.endsWith("liq-trims") ? "liq-trims" : "resizes",
		);
	if (route === "/api/arbitrage/alert-dismissals") {
		if (!Array.isArray(value)) throw new Error("expected dismissals array");
		for (const item of value) {
			const row = record(item);
			required(row, "taskId", "string");
			required(row, "kind", "string");
		}
		return value;
	}
	const body = record(value);
	if (route === "/legal/terms" || route === "/legal/acceptance") {
		for (const key of ["termsVersion", "privacyVersion"]) {
			required(body, key, "string");
			if (
				!(body[key] as string).trim() ||
				/[\p{Cc}\p{Cf}]/u.test(body[key] as string)
			)
				throw new Error(`invalid ${key}`);
		}
		if (route === "/legal/terms") {
			for (const key of ["termsUrl", "privacyUrl"])
				required(body, key, "string");
		} else {
			required(body, "accepted", "boolean");
			if (body.acceptedAt !== null) required(body, "acceptedAt", "string");
		}
	}
	if (route === "/api/arbitrage/rates") {
		required(body, "observedAt", "number");
		if (
			!Array.isArray(body.listed) ||
			body.listed.some((x) => typeof x !== "string") ||
			!Array.isArray(body.failed) ||
			body.failed.some((x) => typeof x !== "string")
		)
			throw new Error("invalid snapshot metadata");
		if (!Array.isArray(body.rates)) throw new Error("invalid rates");
		for (const item of body.rates) {
			const row = record(item);
			for (const key of ["venue", "market"]) required(row, key, "string");
			for (const key of ["ratePerInterval", "intervalHours", "annualizedPct"])
				required(row, key, "number");
		}
	} else if (route.endsWith("/credential")) {
		required(body, "bound", "boolean");
		if (body.bound) {
			if (route.includes("/lighter/")) {
				for (const key of ["publicKey"]) required(body, key, "string");
				for (const key of ["slot", "accountIndex", "chainId"])
					required(body, key, "number");
				required(body, "integratorApproved", "boolean");
			} else {
				required(body, "agentAddress", "string");
				required(body, "builderApproved", "boolean");
			}
		}
	} else if (route.endsWith("/status")) {
		if (!["pending", "bound", "failed"].includes(String(body.status)))
			throw new Error("invalid binding status");
	} else if (route === "/api/binding/rebind-check" && body.allowed !== true)
		throw new Error("rebind is not allowed");
	return body;
}
function validateWrite(route: keyof WriteRoutes, value: unknown): unknown {
	const body = record(value);
	if (route === "/api/arbitrage/create") required(body, "taskId", "string");
	else if (route.endsWith("/prepare")) {
		required(body, "sessionId", "string");
		if (route.includes("/lighter/")) {
			required(body, "messageToSign", "string");
			record(body.txInfo);
		} else {
			required(body, "agentAddress", "string");
			if (route.includes("/aster/")) {
				record(body.approvalParams);
				required(body, "baseUrl", "string");
				required(body, "signingChainId", "number");
			}
		}
	} else {
		if (body.ok !== true) throw new Error("write was not accepted");
		if (route.endsWith("integrator-approve")) {
			required(body, "integratorIndex", "number");
			required(body, "expiresAt", "number");
		}
	}
	return body;
}
export class MobiusClient {
	readonly base: string;
	constructor(
		readonly options: {
			base?: string;
			version: string;
			fetch?: Fetch;
			limit?: typeof limitHost;
		},
	) {
		this.base = apiBase(options.base ?? "https://funding.mob.exchange");
	}
	private async request(
		route: string,
		method: "GET" | "POST",
		data: object,
		validate: (value: unknown) => unknown,
		signal?: AbortSignal,
	): Promise<unknown> {
		if (!Object.hasOwn(method === "GET" ? readRoutes : writeRoutes, route))
			throw new Error("Invalid Mobius route");
		const url = new URL(`${this.base}${route}`);
		if (method === "GET")
			for (const [key, value] of Object.entries(data))
				if (value !== undefined) url.searchParams.set(key, String(value));
		const requestSignal =
			method === "GET"
				? AbortSignal.any([
						AbortSignal.timeout(30_000),
						...(signal ? [signal] : []),
					])
				: signal;
		await (this.options.limit ?? limitHost)(url.host, requestSignal);
		requestSignal?.throwIfAborted();
		const response = await (this.options.fetch ?? globalThis.fetch)(url.href, {
			method,
			redirect: "error",
			signal: requestSignal,
			headers: {
				"X-Mobius-Client": `mstack/${this.options.version}`,
				"User-Agent": `mstack/${this.options.version}`,
				accept: "application/json",
				...(method === "POST" ? { "Content-Type": "application/json" } : {}),
			},
			...(method === "POST" ? { body: JSON.stringify(data) } : {}),
		});
		const raw = await response.text();
		const label = route.split("/").at(-1);
		const fail = (reason: string, value: unknown) =>
			new ApiError(
				`${label}: HTTP ${response.status}: ${reason}; body: ${clean(raw.slice(0, 240))}`,
				response.status,
				value,
			);
		let body: unknown;
		try {
			body = JSON.parse(raw);
		} catch {
			throw fail("malformed body (invalid JSON)", raw);
		}
		if (!response.ok) {
			if (isVenueReadinessError(body))
				throw new ApiError(raw, response.status, body);
			throw fail("request failed", body);
		}
		try {
			return validate(body);
		} catch (error) {
			throw fail(
				`malformed body (${error instanceof Error ? error.message : String(error)})`,
				body,
			);
		}
	}
	async read<R extends keyof ReadRoutes>(
		route: R,
		params: ReadRoutes[R]["params"],
		signal?: AbortSignal,
	): Promise<ReadRoutes[R]["result"]> {
		return (await this.request(
			route,
			"GET",
			params,
			(value) => validateRead(route, value),
			signal,
		)) as ReadRoutes[R]["result"];
	}
	async write<R extends keyof WriteRoutes>(
		route: R,
		body: WriteRoutes[R]["body"],
		signal?: AbortSignal,
	): Promise<WriteRoutes[R]["result"]> {
		return (await this.request(
			route,
			"POST",
			body,
			(value) => validateWrite(route, value),
			signal,
		)) as WriteRoutes[R]["result"];
	}
}
