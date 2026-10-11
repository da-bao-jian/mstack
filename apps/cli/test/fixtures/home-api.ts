import assert from "node:assert/strict";
import type { Fetch } from "@mstack/mobius-client";
import task from "./public-task.json";

export const homeOwner = "0x0000000000000000000000000000000000000001";
export const homeNow = Date.parse("2026-10-11T12:00:00Z");
// Deliberately small HTTP fixture. Unrecognized routes and all writes fail.
export function homeApi() {
	const calls: { url: string; method: string; signal?: AbortSignal | null }[] =
		[];
	const state = {
		bound: ["hl", "lighter"],
		builderApproved: true,
		integratorApproved: true,
		accepted: true,
		funded: true,
		account: true,
		tasks: true,
		fail: "",
		malformed: "",
		hang: "",
	};
	const fetch: Fetch = async (url, init) => {
		const u = new URL(url),
			path = u.pathname;
		calls.push({ url, method: init?.method ?? "GET", signal: init?.signal });
		if (path === state.hang) return new Promise<Response>(() => {});
		if (path === state.fail)
			return Response.json({ error: "fixture unavailable" }, { status: 503 });
		if (path === state.malformed) return Response.json({ unexpected: true });
		assert.equal(init?.redirect, "error");
		assert.equal(
			new Headers(init?.headers).get("X-Mobius-Client"),
			"mstack/0.2.0",
		);
		if (path === "/info") {
			assert.equal(init?.method, "POST");
			assert.deepEqual(JSON.parse(init?.body as string), {
				type: "clearinghouseState",
				user: homeOwner,
			});
			return Response.json({
				marginSummary: { accountValue: state.funded ? "250" : "0" },
			});
		}
		assert.equal(init?.method, "GET");
		if (path === "/api/client-ip") return Response.json({ ip: "127.0.0.1" });
		if (path === "/legal/terms")
			return Response.json({
				termsVersion: "1",
				privacyVersion: "1",
				termsUrl: "https://mob.exchange/terms",
				privacyUrl: "https://mob.exchange/privacy",
			});
		if (path === "/legal/acceptance") {
			assert.equal(u.searchParams.get("wallet"), homeOwner);
			return Response.json({
				accepted: state.accepted,
				acceptedAt: state.accepted ? "2026-08-17T00:00:00Z" : null,
				termsVersion: "1",
				privacyVersion: "1",
			});
		}
		if (path === "/api/arbitrage/list") {
			assert.equal(u.searchParams.get("owner"), homeOwner);
			return Response.json(
				state.tasks
					? [
							task,
							{ ...task, task_id: "1843" },
							{ ...task, task_id: "1844", status: "closed" },
						]
					: [],
			);
		}
		if (path === "/api/v1/account") {
			assert.equal(u.searchParams.get("by"), "l1_address");
			assert.equal(u.searchParams.get("value"), homeOwner);
			return Response.json({
				code: 200,
				accounts: state.account ? [{ index: 11 }] : [],
			});
		}
		if (path.startsWith("/api/binding/") && path.endsWith("/credential")) {
			assert.equal(u.searchParams.get("ownerAddress"), homeOwner);
			const venue = u.searchParams.get("venue") ?? path.split("/")[3];
			if (!state.bound.includes(venue)) return Response.json({ bound: false });
			if (venue === "hl" || venue === "aster")
				return Response.json({
					bound: true,
					agentAddress: homeOwner,
					builderApproved: state.builderApproved,
				});
			return Response.json({
				bound: true,
				publicKey: "fixture-key",
				slot: 3,
				accountIndex: 11,
				chainId: venue === "lighter" ? 466324 : 304,
				integratorApproved: state.integratorApproved,
				integratorApprovalExpiresAt: homeNow + 172800_000,
			});
		}
		throw new Error(`Unexpected home route: ${url}`);
	};
	return { fetch, calls, state };
}
