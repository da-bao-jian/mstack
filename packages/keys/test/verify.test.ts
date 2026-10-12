import { expect, test } from "bun:test";
import { verifyApiKey } from "../src/index.ts";

const key = `mobius_01234567-89ab-cdef-0123-456789abcdef.${"ab".repeat(32)}`;

test("verification calls the one allowed endpoint with bearer auth", async () => {
	let request: { url: string; authorization: string | null } | undefined;
	const result = await verifyApiKey(
		"https://api.mob.exchange/",
		key,
		async (input, init) => {
			request = {
				url: String(input),
				authorization: new Headers(init?.headers).get("authorization"),
			};
			return Response.json([], { status: 200 });
		},
		() => 10,
	);
	expect(request).toEqual({
		url: "https://api.mob.exchange/v1/delta-neutral/tasks?limit=1",
		authorization: `Bearer ${key}`,
	});
	expect(result).toEqual({ status: "ok", latencyMs: 0 });
});

test("verification distinguishes rejection and network failure without leaking the key", async () => {
	expect(
		await verifyApiKey(
			"https://api.mob.exchange",
			key,
			async () => new Response("no", { status: 401 }),
		),
	).toMatchObject({ status: "rejected", httpStatus: 401 });
	const failed = await verifyApiKey(
		"https://api.mob.exchange",
		key,
		async () => {
			throw new Error(`failed ${key}`);
		},
	);
	expect(failed.status).toBe("unreachable");
	expect(JSON.stringify(failed)).not.toContain(key);
});
