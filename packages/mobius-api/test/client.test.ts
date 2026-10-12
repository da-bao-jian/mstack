import { expect, test } from "bun:test";
import {
	ApiKeyRejected,
	ApiKeyScope,
	ApiRateLimited,
	IdempotencyConflict,
	redactKey,
	StrategyApiClient,
	StrategyApiUnavailable,
} from "../src/index.ts";

const key =
	"mobius_00000000-0000-4000-8000-000000000001.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
test("redactKey hides complete API key secrets", () => {
	expect(redactKey(`before ${key} after`)).toBe(
		"before mobius_00000000-0000-4000-8000-000000000001… after",
	);
});

test("client sends required headers, preserves decimals, and labels accepted commands", async () => {
	const calls: { url: string; init: RequestInit }[] = [];
	const client = new StrategyApiClient({
		base: "https://api.example",
		key,
		version: "0.3.0",
		fetch: async (url, init = {}) => {
			calls.push({ url, init });
			return Response.json(
				{ taskId: "00000000-0000-4000-8000-000000000002", status: "pending" },
				{ status: 202, headers: { "X-Request-Id": "r-1" } },
			);
		},
	});
	const result = await client.createTask(
		{
			longVenue: "hl",
			shortVenue: "lighter",
			longMarket: "xyz:NVDA",
			shortMarket: "NVDA",
			sizeUsd: 10,
		},
		{ idempotencyKey: "proposal-1" },
	);
	expect(result).toEqual({
		taskId: "00000000-0000-4000-8000-000000000002",
		status: "pending",
		disposition: "accepted, not executed",
	});
	const headers = new Headers(calls[0]?.init.headers);
	expect(headers.get("Authorization")).toBe(`Bearer ${key}`);
	expect(headers.get("Idempotency-Key")).toBe("proposal-1");
	expect(headers.get("X-Mobius-Client")).toBe("mstack/0.3.0");
	expect(calls[0]?.init.redirect).toBe("error");
});

test("named errors retain safe server context and never leak the bearer", async () => {
	const cases = [
		[401, ApiKeyRejected],
		[403, ApiKeyScope],
		[409, IdempotencyConflict],
		[429, ApiRateLimited],
		[503, StrategyApiUnavailable],
	] as const;
	for (const [status, ErrorType] of cases) {
		const client = new StrategyApiClient({
			base: "https://api.example",
			key,
			version: "0.3.0",
			fetch: async () =>
				Response.json(
					{ error: `failed ${key}`, code: `code_${key}` },
					{
						status,
						headers: { "Retry-After": "3", "X-Request-Id": `req-${key}` },
					},
				),
		});
		try {
			await client.listTasks();
			throw new Error("expected error");
		} catch (error) {
			expect(error).toBeInstanceOf(ErrorType);
			expect(JSON.stringify(error)).not.toContain(key);
			expect(String(error)).not.toContain(key);
			if (error instanceof ApiRateLimited)
				expect(error.retryAfterSeconds).toBe(3);
		}
	}
});

test("idempotency keys are validated before fetch", async () => {
	let called = false;
	const client = new StrategyApiClient({
		base: "https://api.example",
		key,
		version: "0.3.0",
		fetch: async () => {
			called = true;
			return Response.json({});
		},
	});
	await expect(
		client.cancelTask("00000000-0000-4000-8000-000000000002", {
			idempotencyKey: "bad key",
		}),
	).rejects.toThrow("Idempotency-Key");
	expect(called).toBe(false);
});

test("every route redacts a key returned through an HTTP failure", async () => {
	const now = () => 1_800_000_000_000;
	const client = new StrategyApiClient({
		base: "https://api.example",
		key,
		version: "0.3.0",
		now,
		fetch: async () =>
			Response.json(
				{ error: `server echoed ${key}`, code: `bad_${key}` },
				{ status: 400, headers: { "X-Request-Id": `request-${key}` } },
			),
	});
	const expiresAt = 1_800_000_240;
	const signature = `0x${"1".repeat(130)}` as const;
	const calls = [
		() => client.health(),
		() => client.listTasks(),
		() =>
			client.createTask(
				{
					longVenue: "hl",
					shortVenue: "lighter",
					longMarket: "ETH",
					shortMarket: "ETH",
					sizeUsd: 10,
				},
				{ idempotencyKey: "i-1" },
			),
		() => client.getTask("00000000-0000-4000-8000-000000000001"),
		() =>
			client.cancelTask("00000000-0000-4000-8000-000000000001", {
				idempotencyKey: "i-2",
			}),
		() =>
			client.closeTask("00000000-0000-4000-8000-000000000001", {
				idempotencyKey: "i-3",
			}),
		() =>
			client.resizeTask(
				"00000000-0000-4000-8000-000000000001",
				{ longTargetBase: 1 },
				{ idempotencyKey: "i-4" },
			),
		() => client.listRequests(),
		() =>
			client.prepareVenueBindings(
				{
					owner: "0x1111111111111111111111111111111111111111",
					venues: [{ venue: "hl" }],
					authorization: { nonce: "abcdefghijklmnop", expiresAt, signature },
				},
				{ idempotencyKey: "i-5" },
			),
		() =>
			client.submitVenueBindings(
				"00000000-0000-4000-8000-000000000001",
				{ signatures: [{ requestId: "hl:approveAgent", signature }] },
				{ idempotencyKey: "i-6" },
			),
		() =>
			client.getVenueBinding("00000000-0000-4000-8000-000000000001", {
				owner: "0x1111111111111111111111111111111111111111",
				expiresAt,
				signature,
			}),
	];
	for (const call of calls) {
		try {
			await call();
			throw new Error("expected failure");
		} catch (error) {
			expect(String(error)).not.toContain(key);
			expect(JSON.stringify(error)).not.toContain(key);
		}
	}
});

test("transport and malformed JSON failures redact the configured key", async () => {
	for (const fetch of [
		async () => {
			throw new Error(`transport ${key}`);
		},
		async () => new Response(`not-json ${key}`, { status: 502 }),
	]) {
		const client = new StrategyApiClient({
			base: "https://api.example",
			key,
			version: "0.3.0",
			fetch,
		});
		try {
			await client.listTasks();
			throw new Error("expected failure");
		} catch (error) {
			expect(String(error)).not.toContain(key);
			expect(JSON.stringify(error)).not.toContain(key);
		}
	}
});
