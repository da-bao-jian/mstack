import { expect, test } from "bun:test";
import task from "../../../apps/cli/test/fixtures/public-task.json";
import { seeded } from "../../test-seed.ts";
import { ApiError, MobiusClient } from "../src/index.ts";

test("seed 0x1705: corrupt task lists and HTTP failures are named and never retried", async () => {
	const random = seeded(0x1705);
	const invalid = [null, false, [], {}, "", "NaN", "1e999"];
	for (let i = 0; i < 100; i++) {
		const bad = { ...task, owner: invalid[random(invalid.length)] };
		const payload = i % 2 ? [task, bad] : invalid[random(invalid.length)];
		// An empty list is a valid response; use an invalid row for this case.
		const body =
			Array.isArray(payload) && payload.length === 0 ? [bad] : payload;
		let calls = 0;
		const client = new MobiusClient({
			version: "test",
			limit: async () => {},
			fetch: async () => {
				calls++;
				return Response.json(body);
			},
		});
		await expect(
			client.read("/api/arbitrage/list", { owner: "0x1" }),
		).rejects.toThrow("/api/arbitrage/list: HTTP 200: malformed body");
		expect(calls).toBe(1);
	}
	for (const status of [
		400, 401, 403, 404, 409, 422, 429, 500, 502, 503, 504,
	]) {
		for (const raw of [
			"<html>bad upstream</html>",
			"",
			"null",
			"{",
			JSON.stringify({ error: `case-${random(1e6)}` }),
			...(status >= 500 || status === 429
				? [
						JSON.stringify({
							error: "Venue readiness check failed.",
							readiness: {
								ready: false,
								venues: [{ venue: "hl", ready: false, issue: "not_bound" }],
							},
						}),
					]
				: []),
		]) {
			let calls = 0;
			const client = new MobiusClient({
				version: "test",
				limit: async () => {},
				fetch: async () => {
					calls++;
					return new Response(raw, { status });
				},
			});
			try {
				await client.read("/api/arbitrage/list", { owner: "0x1" });
				throw new Error("expected failure");
			} catch (error) {
				expect(error).toBeInstanceOf(ApiError);
				expect((error as Error).message).toContain(
					`/api/arbitrage/list: HTTP ${status}`,
				);
			}
			expect(calls).toBe(1);
		}
	}
});
