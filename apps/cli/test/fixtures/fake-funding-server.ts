import assert from "node:assert/strict";
import { request } from "node:http";
import {
	type ApiKeyRecord,
	apiKeyMessage,
	type Fetch,
	type OpenBody,
	type PublicTask,
} from "@mstack/mobius-client";
import { type Address, type Hex, hashMessage, recoverAddress } from "viem";
import pkg from "../../package.json";
import task from "./public-task.json";

interface FakeApiKeyState {
	records: ApiKeyRecord[];
}

async function handleApiKeys(
	req: Request,
	url: URL,
	owner: Address,
	state: FakeApiKeyState,
): Promise<Response | undefined> {
	const action = url.pathname.match(
		/^\/api\/keys\/(list|create|revoke)$/,
	)?.[1] as "list" | "create" | "revoke" | undefined;
	if (!action) return undefined;
	assert.equal(req.method, "POST");
	const body = (await req.json()) as Record<string, unknown> & {
		signature: Hex;
		timestamp: number;
	};
	assert.equal(String(body.owner).toLowerCase(), owner.toLowerCase());
	const recovered = await recoverAddress({
		hash: hashMessage(
			apiKeyMessage(action, {
				owner: String(body.owner),
				timestamp: body.timestamp,
				...(action === "create"
					? {
							name: String(body.name),
							venues: body.venues as (
								| "aster"
								| "hl"
								| "lighter"
								| "lighter-mainnet"
							)[],
							nonce: String(body.nonce),
							...(body.maxSizeUsd === undefined
								? {}
								: { maxSizeUsd: Number(body.maxSizeUsd) }),
						}
					: {}),
				...(action === "revoke" ? { id: String(body.id) } : {}),
			}),
		),
		signature: body.signature,
	});
	assert.equal(recovered.toLowerCase(), owner.toLowerCase());
	if (action === "list") return Response.json(state.records);
	if (action === "revoke") {
		const record = state.records.find((item) => item.id === body.id);
		assert.ok(record);
		record.revoked_at = new Date().toISOString();
		return Response.json({ ok: true });
	}
	const id = "00000000-0000-4000-8000-000000000018";
	const record: ApiKeyRecord = {
		id,
		name: String(body.name),
		venues: body.venues as ApiKeyRecord["venues"],
		max_size_usd: String(body.maxSizeUsd ?? 10_000),
		key_prefix: `mobius_${id}…`,
		created_at: new Date().toISOString(),
		revoked_at: null,
	};
	state.records.unshift(record);
	return Response.json(
		{
			key: `mobius_${id}.${"a".repeat(64)}`,
			record,
		},
		{ status: 201 },
	);
}

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
	const apiKeys: FakeApiKeyState = { records: [] };
	const errors: Error[] = [];
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		async fetch(req) {
			try {
				const url = new URL(req.url);
				assert.equal(
					req.headers.get("X-Mobius-Client"),
					`mstack/${pkg.version}`,
				);
				assert.equal(req.headers.get("User-Agent"), `mstack/${pkg.version}`);
				const apiKeyResponse = await handleApiKeys(req, url, owner, apiKeys);
				if (apiKeyResponse) return apiKeyResponse;
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

export function readyCredentials(owner: string, now = Date.now()) {
	return {
		hl: {
			bound: true,
			agentAddress: owner,
			builderApproved: true,
			builderAddress: owner,
			isTestnet: false,
		},
		aster: {
			bound: true,
			agentAddress: owner,
			builderApproved: true,
			builderAddress: owner,
			feeRate: "0.001",
			signingChainId: 56,
		},
		lighter: {
			bound: true,
			publicKey: "fixture",
			slot: 1,
			accountIndex: 1,
			chainId: 466324,
			integratorApproved: true,
			integratorIndex: 994,
			integratorAddress: owner,
			integratorApprovalExpiresAt: now + 30 * 86_400_000,
		},
		"lighter-mainnet": {
			bound: true,
			publicKey: "fixture",
			slot: 1,
			accountIndex: 1,
			chainId: 304,
			integratorApproved: true,
			integratorIndex: 735705,
			integratorAddress: owner,
			integratorApprovalExpiresAt: now + 30 * 86_400_000,
		},
	};
}

// Ported from mobius@33ed2ece funding-server/src/server/routes/arbitrage.ts
// Server-side wire strings kept independent of every client builder.
function serverManageMessage(
	route: string,
	b: Record<string, unknown>,
): string {
	if (route.endsWith("/close"))
		return `Close arbitrage task: ${b.taskId} timestamp=${b.timestamp}`;
	if (route.endsWith("/neutralize"))
		return `Neutralize arbitrage task: ${b.taskId} timestamp=${b.timestamp}`;
	if (route.endsWith("/liq-protection"))
		return `Set arbitrage liquidation protection: ${b.taskId} liqProtectionPct=${b.liqProtectionPct ?? "off"} timestamp=${b.timestamp}`;
	if (route.endsWith("/auto-close"))
		return `Set arbitrage auto-close: ${b.taskId} autoClose=${b.autoClose ? "on" : "off"} minFundingApy=${b.minFundingApy} timestamp=${b.timestamp}`;
	if (route.endsWith("/size-mismatch-auto-close"))
		return `Set size mismatch auto-close: ${b.taskId} enabled=${b.enabled ? "on" : "off"} thresholdPct=${b.enabled ? b.thresholdPct : 0} timestamp=${b.timestamp}`;
	assert.ok(route.endsWith("/resize"));
	const parts = [
		"Resize arbitrage task:",
		b.taskId,
		`timestamp=${b.timestamp}`,
	];
	if (b.longTargetBase !== undefined)
		parts.push(`longTarget=${b.longTargetBase}`);
	if (b.shortTargetBase !== undefined)
		parts.push(`shortTarget=${b.shortTargetBase}`);
	if (b.disableSizeMismatchAutoClose === true)
		parts.push("disableSizeMismatchAutoClose=on");
	return parts.join(" ");
}

/** W10 fixture: each POST needs an explicit expected body and real EIP-191 recovery. */
export function fakePositionServer(owner: Address, now = Date.now) {
	const expected: { route: string; body: Record<string, unknown> }[] = [];
	const errors: Error[] = [];
	const writes: { route: string; recovered: string }[] = [];
	const credentials: Record<string, unknown> = readyCredentials(owner, now());
	const rebindBlocked = new Set<string>();
	const readinessUnbound = new Set<string>();
	const apiKeys: FakeApiKeyState = { records: [] };
	let current: PublicTask | undefined;
	let readinessFailure: string | undefined;
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		async fetch(req) {
			try {
				const url = new URL(req.url);
				const apiKeyResponse = await handleApiKeys(req, url, owner, apiKeys);
				if (apiKeyResponse) return apiKeyResponse;
				assert.equal(
					req.headers.get("X-Mobius-Client"),
					`mstack/${pkg.version}`,
				);
				assert.equal(req.headers.get("User-Agent"), `mstack/${pkg.version}`);
				if (req.method === "GET") {
					if (url.pathname === "/api/binding/readiness") {
						assert.equal(url.searchParams.get("ownerAddress"), owner);
						return Response.json({
							ready: [...readinessUnbound].length === 0,
							venues: Object.keys(credentials).map((venue) => ({
								venue,
								ready: !readinessUnbound.has(venue),
								...(readinessUnbound.has(venue) ? { issue: "not_bound" } : {}),
							})),
						});
					}
					if (url.pathname === "/api/arbitrage/task") {
						assert.equal(url.searchParams.get("owner"), owner);
						return current && url.searchParams.get("taskId") === current.task_id
							? Response.json(current)
							: Response.json({ error: "Task not found." }, { status: 404 });
					}
					assert.equal(url.searchParams.get("ownerAddress"), owner);
					if (url.pathname === "/api/binding/rebind-check")
						return rebindBlocked.has(url.searchParams.get("venue") as string)
							? Response.json(
									{
										error:
											"A running strategy uses this venue. Close it before rebinding.",
									},
									{ status: 409 },
								)
							: Response.json({ allowed: true });
					const routeVenue = url.pathname.match(
						/^\/api\/binding\/(hl|aster|lighter)\/credential$/,
					)?.[1];
					assert.ok(routeVenue);
					const venue =
						routeVenue === "lighter"
							? url.searchParams.get("venue")
							: routeVenue;
					assert.ok(venue && Object.hasOwn(credentials, venue));
					return Response.json(credentials[venue]);
				}
				assert.equal(req.method, "POST");
				const next = expected.shift();
				assert.ok(next, "Unexpected POST");
				assert.equal(url.pathname, next.route);
				const body = (await req.json()) as Record<string, unknown> & {
					signature: Hex;
					timestamp: number;
				};
				assert.deepEqual(
					Object.keys(body).sort(),
					[...Object.keys(next.body), "signature"].sort(),
				);
				for (const key of Object.keys(next.body))
					assert.deepEqual(body[key], next.body[key], `request body ${key}`);
				assert.ok(Math.abs(now() / 1000 - body.timestamp) <= 300);
				const message =
					url.pathname === "/api/arbitrage/create"
						? openTaskMessage(body as unknown as OpenBody)
						: serverManageMessage(url.pathname, body);
				const recovered = await recoverAddress({
					hash: hashMessage(message),
					signature: body.signature,
				});
				assert.equal(recovered.toLowerCase(), owner.toLowerCase());
				writes.push({ route: url.pathname, recovered });
				if (readinessFailure)
					return new Response(readinessFailure, {
						status: 409,
						headers: { "content-type": "application/json" },
					});
				if (url.pathname === "/api/arbitrage/create") {
					current = {
						...task,
						owner,
						task_id: "fake-w10-1",
						status: "running",
						long_venue: String(body.longVenue),
						short_venue: String(body.shortVenue),
						long_market: String(body.longMarket),
						short_market: String(body.shortMarket),
						size_usd: Number(body.sizeUsd),
						long_price: Number(body.longPrice),
						short_price: Number(body.shortPrice),
						long_size: Number(body.sizeUsd) / Number(body.longPrice),
						short_size: Number(body.sizeUsd) / Number(body.shortPrice),
					};
					return Response.json({ taskId: current.task_id }, { status: 201 });
				}
				assert.ok(current);
				assert.equal(body.taskId, current.task_id);
				if (url.pathname.endsWith("/close")) {
					assert.ok(!["closed", "failed"].includes(current.status));
					current.status = "closed";
				} else {
					assert.equal(current.status, "running");
					if (url.pathname.endsWith("/liq-protection"))
						current.liq_protection_pct = body.liqProtectionPct as number | null;
					if (url.pathname.endsWith("/resize")) {
						if (body.longTargetBase !== undefined)
							current.long_size = Number(body.longTargetBase);
						if (body.shortTargetBase !== undefined)
							current.short_size = Number(body.shortTargetBase);
					}
				}
				return Response.json({ ok: true });
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
		credentials,
		rebindBlocked,
		readinessUnbound,
		errors,
		writes,
		expect: (route: string, body: Record<string, unknown>) =>
			expected.push({ route, body: structuredClone(body) }),
		setTask: (value: PublicTask) => {
			current = structuredClone(value);
		},
		setReadinessFailure: (raw: string) => {
			readinessFailure = raw;
		},
		stop: () => server.stop(true),
	};
}
