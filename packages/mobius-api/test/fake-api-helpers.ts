import { request } from "node:http";
import { privateKeyToAccount } from "viem/accounts";
import type {
	BindingTarget,
	CreateTask,
	SignRequest,
	Task,
	Venue,
} from "../src/types.ts";

export const loopbackFetch = async (
	url: string,
	init: RequestInit = {},
): Promise<Response> => {
	const target = new URL(url);
	if (target.hostname !== "127.0.0.1" || target.protocol !== "http:")
		throw new Error("Fixture transport permits loopback only.");
	return new Promise((resolve, reject) => {
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
							headers: res.headers as HeadersInit,
						}),
					),
				);
			},
		);
		req.on("error", reject);
		req.end(init.body ? String(init.body) : undefined);
	});
};

export const fakeOwnerKey =
	"0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a841a6a9b6c457f5b60" as const;
export const fakeOwner = privateKeyToAccount(fakeOwnerKey);
export const fakeApiKey =
	"mobius_00000000-0000-4000-8000-000000000001.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function typed(owner: string, venue: Venue, action: string): SignRequest {
	return {
		requestId: `${venue}:${action}`,
		venue,
		action,
		method: "eth_signTypedData_v4",
		payload: {
			domain: {
				name: "Mobius Fake Binding",
				version: "1",
				chainId: 1,
				verifyingContract: "0x0000000000000000000000000000000000000001",
			},
			types: {
				Approval: [
					{ name: "owner", type: "address" },
					{ name: "action", type: "string" },
				],
			},
			primaryType: "Approval",
			message: { owner, action },
		},
	};
}

function personal(owner: string, venue: Venue, action: string): SignRequest {
	return {
		requestId: `${venue}:${action}`,
		venue,
		action,
		method: "personal_sign",
		payload: { message: `Mobius fake ${action} owner=${owner} venue=${venue}` },
	};
}

export function makeSignRequests(
	owner: string,
	target: BindingTarget,
): SignRequest[] {
	if (target.venue === "hl")
		return [
			typed(owner, "hl", "approveAgent"),
			typed(owner, "hl", "approveBuilderFee"),
		];
	if (target.venue === "aster") return [typed(owner, "aster", "approveAgent")];
	return [
		personal(owner, target.venue, "changePubKey"),
		personal(owner, target.venue, "approveIntegrator"),
	];
}

export function makeTask(
	id: string,
	input: CreateTask,
	status = "pending",
): Task {
	const now = new Date().toISOString();
	return {
		taskId: id,
		longVenue: input.longVenue,
		shortVenue: input.shortVenue,
		longMarket: input.longMarket,
		shortMarket: input.shortMarket,
		sizeUsd: String(input.sizeUsd),
		status,
		longSize: null,
		shortSize: null,
		longEntry: null,
		shortEntry: null,
		longPrice: null,
		shortPrice: null,
		longLeverage: null,
		shortLeverage: null,
		liqProtectionPct: input.liqProtectionPct
			? String(input.liqProtectionPct)
			: null,
		sizeMismatchPct: input.sizeMismatchPct
			? String(input.sizeMismatchPct)
			: null,
		fundingUsd: "0",
		longMarginMode: null,
		shortMarginMode: null,
		closeReason: null,
		error: null,
		createdAt: now,
		updatedAt: now,
		closeRequestedAt: null,
	};
}
