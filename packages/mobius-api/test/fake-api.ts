import { randomUUID } from "node:crypto";
import {
	recoverMessageAddress,
	recoverTypedDataAddress,
	type TypedDataDefinition,
} from "viem";
import { bindingMessage, canonical } from "../src/binding.ts";
import type {
	BindingTarget,
	CreateTask,
	Task,
	Venue,
	VenueBindingBatch,
} from "../src/types.ts";
import {
	fakeApiKey,
	fakeOwner,
	makeSignRequests,
	makeTask,
} from "./fake-api-helpers.ts";

export {
	fakeApiKey,
	fakeOwner,
	fakeOwnerKey,
	loopbackFetch,
} from "./fake-api-helpers.ts";

type Grant = { owner: string; venues: Venue[]; maxSizeUsd: number };
type Stored = { hash: string; status: number; body: unknown };
type Batch = VenueBindingBatch & {
	targets: BindingTarget[];
	accepted: Set<string>;
	readCount: number;
};

function publicBatch(batch: Batch): VenueBindingBatch {
	return {
		bindingId: batch.bindingId,
		owner: batch.owner,
		expiresAt: batch.expiresAt,
		status: batch.status,
		results: batch.results,
		signRequests: batch.signRequests,
	};
}

function json(body: unknown, status = 200, headers: HeadersInit = {}) {
	return Response.json(body, {
		status,
		headers: { "X-Request-Id": randomUUID(), ...headers },
	});
}

async function body(req: Request): Promise<Record<string, unknown>> {
	const value: unknown = await req.json();
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error("Expected object body.");
	return value as Record<string, unknown>;
}

export function fakeStrategyApi(
	options: { now?: () => number; grants?: Record<string, Grant> } = {},
) {
	const now = options.now ?? Date.now;
	const grants =
		options.grants ??
		({
			[fakeApiKey]: {
				owner: fakeOwner.address.toLowerCase(),
				venues: ["hl", "lighter", "lighter-mainnet", "aster"],
				maxSizeUsd: 10_000,
			},
		} satisfies Record<string, Grant>);
	const tasks = new Map<string, Task>();
	const reads = new Map<string, number>();
	const batches = new Map<string, Batch>();
	const idempotency = new Map<string, Stored>();
	const bound = new Set<Venue>();
	const unusable = new Set<Venue>();
	let rateLimitOnce = false;

	function auth(req: Request): Grant | Response {
		const header = req.headers.get("Authorization");
		const grant = header?.startsWith("Bearer ")
			? grants[header.slice("Bearer ".length)]
			: undefined;
		return (
			grant ?? json({ error: "API key rejected.", code: "invalid_key" }, 401)
		);
	}

	async function mutation(
		req: Request,
		owner: string,
		handler: (value: Record<string, unknown>) => Promise<Response> | Response,
	) {
		const key = req.headers.get("Idempotency-Key");
		if (!key || !/^[!-~]{1,128}$/.test(key))
			return json(
				{ error: "Invalid Idempotency-Key.", code: "idempotency_key" },
				400,
			);
		const value = await body(req);
		const slot = `${owner}:${req.method}:${new URL(req.url).pathname}:${key}`;
		const hash = canonical(value);
		const previous = idempotency.get(slot);
		if (previous) {
			if (previous.hash !== hash)
				return json(
					{
						error: "Idempotency key reused with another body.",
						code: "idempotency_conflict",
					},
					409,
				);
			return json(previous.body, previous.status);
		}
		const response = await handler(value);
		const responseBody: unknown = await response.clone().json();
		idempotency.set(slot, {
			hash,
			status: response.status,
			body: responseBody,
		});
		return response;
	}

	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		async fetch(req) {
			try {
				const url = new URL(req.url);
				if (url.pathname === "/health" && req.method === "GET")
					return json({ ok: true });
				if (rateLimitOnce) {
					rateLimitOnce = false;
					return json({ error: "Slow down.", code: "rate_limited" }, 429, {
						"Retry-After": "3",
					});
				}
				if (
					url.pathname === "/v1/venue-bindings/prepare" &&
					req.method === "POST"
				) {
					const prepareBody = (await req.clone().json()) as Record<
						string,
						unknown
					>;
					return mutation(
						req,
						String(prepareBody.owner).toLowerCase(),
						async (value) => {
							const owner = String(value.owner).toLowerCase();
							const venues = value.venues as BindingTarget[];
							const authorization = value.authorization as Record<
								string,
								unknown
							>;
							const payload = {
								owner,
								venues,
								nonce: authorization.nonce,
								expiresAt: authorization.expiresAt,
							};
							const recovered = await recoverMessageAddress({
								message: bindingMessage("prepare", payload),
								signature: String(authorization.signature) as `0x${string}`,
							});
							if (recovered.toLowerCase() !== owner)
								return json(
									{ error: "Wrong wallet.", code: "owner_mismatch" },
									403,
								);
							for (const target of venues)
								if (unusable.has(target.venue) && !target.rebind)
									return json(
										{
											error: "Explicit rebind required.",
											code: "rebind_required",
										},
										409,
									);
							const bindingId = randomUUID();
							const results = venues.map((target) => ({
								venue: target.venue,
								sessionId: bound.has(target.venue) ? null : randomUUID(),
								status: bound.has(target.venue)
									? ("already_bound" as const)
									: ("awaiting_signatures" as const),
							}));
							const signRequests = venues.flatMap((target) =>
								bound.has(target.venue) ? [] : makeSignRequests(owner, target),
							);
							const batch: Batch = {
								bindingId,
								owner,
								expiresAt: new Date(
									Number(authorization.expiresAt) * 1000,
								).toISOString(),
								status: signRequests.length ? "awaiting_signatures" : "bound",
								results,
								signRequests,
								targets: venues,
								accepted: new Set(),
								readCount: 0,
							};
							batches.set(bindingId, batch);
							return json(publicBatch(batch));
						},
					);
				}

				const submit = url.pathname.match(
					/^\/v1\/venue-bindings\/([^/]+)\/submit$/,
				);
				if (submit && req.method === "POST") {
					const batch = batches.get(submit[1] as string);
					if (!batch)
						return json(
							{ error: "Binding not found.", code: "binding_not_found" },
							404,
						);
					return mutation(req, batch.owner, async (value) => {
						if (Date.parse(batch.expiresAt) <= now())
							return json(
								{ error: "Binding expired.", code: "binding_expired" },
								410,
							);
						for (const item of value.signatures as {
							requestId: string;
							signature: `0x${string}`;
						}[]) {
							const request = batch.signRequests.find(
								(candidate) => candidate.requestId === item.requestId,
							);
							if (!request)
								return json(
									{ error: "Unknown signature.", code: "unknown_request" },
									409,
								);
							const recovered =
								request.method === "personal_sign"
									? await recoverMessageAddress({
											message: (request.payload as { message: string }).message,
											signature: item.signature,
										})
									: await recoverTypedDataAddress({
											...(request.payload as TypedDataDefinition),
											signature: item.signature,
										});
							if (recovered.toLowerCase() !== batch.owner)
								return json(
									{ error: "Wrong wallet.", code: "owner_mismatch" },
									403,
								);
							batch.accepted.add(item.requestId);
						}
						for (const result of batch.results) {
							const required = batch.signRequests.filter(
								(request) => request.venue === result.venue,
							);
							if (
								required.length &&
								required.every((request) =>
									batch.accepted.has(request.requestId),
								)
							)
								result.status = "queued";
						}
						batch.signRequests = batch.signRequests.filter(
							(request) => !batch.accepted.has(request.requestId),
						);
						batch.status = "processing";
						return json(publicBatch(batch), 202);
					});
				}

				const bindingRead = url.pathname.match(
					/^\/v1\/venue-bindings\/([^/]+)$/,
				);
				if (bindingRead && req.method === "GET") {
					const batch = batches.get(bindingRead[1] as string);
					if (!batch)
						return json(
							{ error: "Binding not found.", code: "binding_not_found" },
							404,
						);
					const owner = String(
						req.headers.get("X-Wallet-Address"),
					).toLowerCase();
					const expiresAt = Number(req.headers.get("X-Wallet-Expires-At"));
					const nowSeconds = Math.floor(now() / 1000);
					if (
						!Number.isSafeInteger(expiresAt) ||
						expiresAt < nowSeconds ||
						expiresAt > nowSeconds + 300
					)
						return json(
							{
								error: "Wallet authorization expired.",
								code: "authorization_expired",
							},
							401,
						);
					const recovered = await recoverMessageAddress({
						message: bindingMessage("read", {
							owner,
							bindingId: batch.bindingId,
							expiresAt,
						}),
						signature: String(
							req.headers.get("X-Wallet-Signature"),
						) as `0x${string}`,
					});
					if (recovered.toLowerCase() !== batch.owner)
						return json(
							{ error: "Binding not found.", code: "binding_not_found" },
							404,
						);
					if (Date.parse(batch.expiresAt) <= now()) {
						for (const result of batch.results)
							if (result.status === "awaiting_signatures")
								result.status = "expired";
						if (
							batch.results.every((result) =>
								["bound", "already_bound", "failed", "expired"].includes(
									result.status,
								),
							)
						)
							batch.status = batch.results.some((result) =>
								["bound", "already_bound"].includes(result.status),
							)
								? "partial_success"
								: "failed";
						return json(publicBatch(batch));
					}
					batch.readCount++;
					for (const result of batch.results) {
						if (result.status === "queued") result.status = "confirming";
						else if (result.status === "confirming") {
							result.status = "bound";
							bound.add(result.venue);
						}
					}
					batch.status = batch.results.every((result) =>
						["bound", "already_bound"].includes(result.status),
					)
						? "bound"
						: "processing";
					return json(publicBatch(batch));
				}

				const granted = auth(req);
				if (granted instanceof Response) return granted;
				if (url.pathname === "/v1/delta-neutral/tasks" && req.method === "GET")
					return json({ tasks: [...tasks.values()], nextCursor: null });
				if (
					url.pathname === "/v1/delta-neutral/tasks" &&
					req.method === "POST"
				) {
					return mutation(req, granted.owner, async (value) => {
						const input = value as unknown as CreateTask;
						if (
							!granted.venues.includes(input.longVenue) ||
							!granted.venues.includes(input.shortVenue) ||
							input.sizeUsd > granted.maxSizeUsd
						)
							return json(
								{ error: "Outside API key scope.", code: "key_scope" },
								403,
							);
						const id = randomUUID();
						tasks.set(id, makeTask(id, input));
						return json({ taskId: id, status: "pending" }, 202);
					});
				}
				const command = url.pathname.match(
					/^\/v1\/delta-neutral\/tasks\/([^/]+)(?:\/(cancel|close|resize))?$/,
				);
				if (command && req.method === "GET") {
					const found = tasks.get(command[1] as string);
					if (!found)
						return json({ error: "Task not found.", code: "not_found" }, 404);
					const count = (reads.get(found.taskId) ?? 0) + 1;
					reads.set(found.taskId, count);
					if (found.status === "pending") found.status = "running";
					return json({ task: found });
				}
				if (command && req.method === "POST" && command[2]) {
					return mutation(req, granted.owner, async () => {
						const found = tasks.get(command[1] as string);
						if (!found)
							return json({ error: "Task not found.", code: "not_found" }, 404);
						const status =
							command[2] === "cancel"
								? "cancelled"
								: command[2] === "close"
									? "close_queued"
									: "resizing";
						found.status = status;
						return json({ taskId: found.taskId, status }, 202);
					});
				}
				if (url.pathname === "/v1/requests" && req.method === "GET")
					return json({ requests: [] });
				return json({ error: "Not found.", code: "not_found" }, 404);
			} catch (error) {
				return json(
					{
						error: error instanceof Error ? error.message : String(error),
						code: "fake_error",
					},
					400,
				);
			}
		},
	});

	return {
		base: `http://127.0.0.1:${server.port}`,
		key: fakeApiKey,
		owner: fakeOwner,
		tasks,
		batches,
		bound,
		unusable,
		rateLimitNext: () => {
			rateLimitOnce = true;
		},
		stop: () => server.stop(true),
	};
}
