import { request } from "node:http";
import { privateKeyToAccount } from "viem/accounts";
import type {
	BindingTarget,
	CreateTask,
	SignRequest,
	Task,
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

// The exact shapes of mobius@0e3ff530 api-server/demo/venue-binding-payloads.json.
const AGENT = "0x2222222222222222222222222222222222222222";
const ZERO = "0x0000000000000000000000000000000000000000" as const;
const hlDomain = {
	name: "HyperliquidSignTransaction",
	version: "1",
	chainId: 42161,
	verifyingContract: ZERO,
};

export function hlRequest(
	action: "approveAgent" | "approveBuilderFee",
): SignRequest {
	const nonce = 1_791_800_000_000;
	return {
		requestId: `hl:${action}`,
		venue: "hl",
		action,
		method: "eth_signTypedData_v4",
		payload:
			action === "approveAgent"
				? {
						domain: hlDomain,
						types: {
							"HyperliquidTransaction:ApproveAgent": [
								{ name: "hyperliquidChain", type: "string" },
								{ name: "agentAddress", type: "address" },
								{ name: "agentName", type: "string" },
								{ name: "nonce", type: "uint64" },
							],
						},
						primaryType: "HyperliquidTransaction:ApproveAgent",
						message: {
							signatureChainId: "0xa4b1",
							hyperliquidChain: "Mainnet",
							type: "approveAgent",
							agentAddress: AGENT,
							agentName: "mobius-bot valid_until 1807265600000",
							nonce,
						},
					}
				: {
						domain: hlDomain,
						types: {
							"HyperliquidTransaction:ApproveBuilderFee": [
								{ name: "hyperliquidChain", type: "string" },
								{ name: "maxFeeRate", type: "string" },
								{ name: "builder", type: "address" },
								{ name: "nonce", type: "uint64" },
							],
						},
						primaryType: "HyperliquidTransaction:ApproveBuilderFee",
						message: {
							signatureChainId: "0xa4b1",
							hyperliquidChain: "Mainnet",
							type: "approveBuilderFee",
							builder: "0x1eda138b7de2bd6628217fe143c499365367de84",
							maxFeeRate: "0.1%",
							nonce: nonce + 1,
						},
					},
	};
}

export function asterRequest(owner: string): SignRequest {
	const fields = [
		["AgentName", "string"],
		["AgentAddress", "string"],
		["IpWhitelist", "string"],
		["Expired", "uint256"],
		["CanSpotTrade", "bool"],
		["CanPerpTrade", "bool"],
		["CanWithdraw", "bool"],
		["Builder", "string"],
		["MaxFeeRate", "string"],
		["BuilderName", "string"],
		["AsterChain", "string"],
		["User", "string"],
		["Nonce", "uint256"],
	];
	return {
		requestId: "aster:approveAgent",
		venue: "aster",
		action: "approveAgent",
		method: "eth_signTypedData_v4",
		payload: {
			domain: {
				name: "AsterSignTransaction",
				version: "1",
				verifyingContract: ZERO,
				chainId: 56,
			},
			types: {
				ApproveAgent: fields.map(([name, type]) => ({ name, type })),
			},
			primaryType: "ApproveAgent",
			message: {
				AgentName: "mobius-bot",
				AgentAddress: AGENT,
				IpWhitelist: "",
				Expired: 4_102_444_800_000,
				CanSpotTrade: false,
				CanPerpTrade: true,
				CanWithdraw: false,
				Builder: "0xca267a715d2fc07e4a6b59c13b156f9c0cb14512",
				MaxFeeRate: "0.001",
				BuilderName: "Mobius",
				AsterChain: "Mainnet",
				User: owner.toLowerCase(),
				Nonce: 1_791_800_000_000_000,
			},
		},
	};
}

export function lighterRequest(
	owner: string,
	venue: "lighter" | "lighter-mainnet",
	action: "changePubKey" | "approveIntegrator",
): SignRequest {
	return {
		requestId: `${venue}:${action}`,
		venue,
		action,
		method: "personal_sign",
		payload: {
			message:
				action === "changePubKey"
					? `Register Lighter Account\n\npubkey: 0x${"e0a2".repeat(20)}\nnonce: 0x0000000000000000\naccount index: 0x000000000000007b\napi key index: 0x000000000000002a\nOnly sign this message for a trusted client!`
					: `Approve zero-fee Lighter integrator owner=${owner.toLowerCase()} venue=${venue} integratorIndex=994 nonce=00000000-0000-4000-8000-000000000001 timestamp=1791800000`,
		},
	};
}

export function makeSignRequests(
	owner: string,
	target: BindingTarget,
): SignRequest[] {
	if (target.venue === "hl")
		return [hlRequest("approveAgent"), hlRequest("approveBuilderFee")];
	if (target.venue === "aster") return [asterRequest(owner)];
	return [
		lighterRequest(owner, target.venue, "changePubKey"),
		lighterRequest(owner, target.venue, "approveIntegrator"),
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
