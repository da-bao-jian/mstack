import assert from "node:assert/strict";
import { request } from "node:http";
import type { Fetch, OpenBody } from "@mstack/mobius-client";
import { type Address, type Hex, hashMessage, recoverAddress } from "viem";
import task from "./public-task.json";

// Ported from mobius@33ed2ece funding-server/src/server/routes/arbitrage.ts
// Independent server-side builder, not an import of the client message builder.
function openTaskMessage(params: OpenBody): string {
	const parts = [
		"Open arbitrage task:",
		`long=${params.longVenue}:${params.longMarket}`,
		`short=${params.shortVenue}:${params.shortMarket}`,
		`sizeUsd=${params.sizeUsd}`,
		`longPrice=${params.longPrice}`,
		`shortPrice=${params.shortPrice}`,
		`minFundingApy=${params.minFundingApy}`,
		`nonce=${params.nonce}`,
		`timestamp=${params.timestamp}`,
	];
	if (params.autoClose !== undefined)
		parts.push(`autoClose=${params.autoClose ? "on" : "off"}`);
	if (params.longLeverage !== undefined)
		parts.push(`longLeverage=${params.longLeverage}`);
	if (params.shortLeverage !== undefined)
		parts.push(`shortLeverage=${params.shortLeverage}`);
	if (params.longMarginMode !== undefined)
		parts.push(`longMarginMode=${params.longMarginMode}`);
	if (params.shortMarginMode !== undefined)
		parts.push(`shortMarginMode=${params.shortMarginMode}`);
	if (params.maxSpreadBps !== undefined)
		parts.push(`maxSpreadBps=${params.maxSpreadBps}`);
	if (params.liqProtectionPct !== undefined)
		parts.push(`liqProtectionPct=${params.liqProtectionPct}`);
	if (params.sizeMismatchPct !== undefined)
		parts.push(`sizeMismatchPct=${params.sizeMismatchPct}`);
	return parts.join(" ");
}
/** Uses node:http only for this loopback fixture. The global live-network guard stays intact. */
export const loopbackFetch: Fetch = async (url, init = {}) => {
	const target = new URL(url);
	if (target.hostname !== "127.0.0.1" || target.protocol !== "http:")
		throw new Error("Fixture transport permits loopback only");
	return new Promise<Response>((resolve, reject) => {
		const req = request(
			target,
			{
				method: init.method ?? "GET",
				headers: Object.fromEntries(new Headers(init.headers)),
				signal: init.signal ?? undefined,
			},
			(res) => {
				const chunks: Buffer[] = [];
				res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
				res.on("error", reject);
				res.on("end", () =>
					resolve(
						new Response(Buffer.concat(chunks), {
							status: res.statusCode ?? 500,
							headers: { "content-type": "application/json" },
						}),
					),
				);
			},
		);
		req.on("error", reject);
		req.end(init.body ? String(init.body) : undefined);
	});
};
export function fakeFundingServer(
	owner: Address,
	expected: OpenBody,
	options: { readinessFailure?: boolean } = {},
) {
	let writes = 0;
	const errors: Error[] = [];
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		async fetch(req) {
			try {
				const url = new URL(req.url);
				assert.equal(req.headers.get("X-Mobius-Client"), "mstack/0.1.0");
				assert.equal(req.headers.get("User-Agent"), "mstack/0.1.0");
				if (req.method === "GET" && url.pathname === "/api/arbitrage/task") {
					assert.equal(url.searchParams.get("owner"), owner);
					return Response.json({ ...task, owner });
				}
				if (
					req.method === "GET" &&
					url.pathname === "/api/binding/rebind-check"
				) {
					assert.equal(url.searchParams.get("ownerAddress"), owner);
					return Response.json({ allowed: true });
				}
				assert.equal(req.method, "POST");
				assert.equal(url.pathname, "/api/arbitrage/create");
				writes++;
				const body = (await req.json()) as OpenBody & { signature: Hex };
				assert.deepEqual(
					Object.keys(body).sort(),
					[...Object.keys(expected), "signature"].sort(),
				);
				for (const key of Object.keys(expected) as (keyof OpenBody)[])
					assert.deepEqual(body[key], expected[key], `request body ${key}`);
				assert.equal(typeof body.signature, "string");
				assert.ok(Math.abs(Date.now() / 1000 - body.timestamp) <= 300);
				const recovered = await recoverAddress({
					hash: hashMessage(openTaskMessage(body)),
					signature: body.signature,
				});
				assert.equal(recovered.toLowerCase(), owner.toLowerCase());
				if (options.readinessFailure)
					return Response.json(
						{
							error: "Venue readiness check failed.",
							readiness: {
								ready: false,
								venues: [{ venue: "hl", ready: false, issue: "not_bound" }],
							},
						},
						{ status: 409 },
					);
				return Response.json({ taskId: "fake-w7-1" }, { status: 201 });
			} catch (error) {
				errors.push(error as Error);
				return Response.json(
					{ error: (error as Error).message },
					{ status: 400 },
				);
			}
		},
	});
	return {
		base: `http://127.0.0.1:${server.port}`,
		writes: () => writes,
		errors,
		stop: () => server.stop(true),
	};
}
