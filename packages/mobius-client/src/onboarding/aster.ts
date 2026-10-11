// Ported from mobius@33ed2ece packages/aster-client/src/signing.ts
import type { Address, Hex } from "viem";
import type {
	ApproveAgentParams,
	ApproveBuilderParams,
	AsterSigner,
} from "./types.ts";

export const EIP712_DOMAIN = {
	name: "AsterSignTransaction",
	version: "1",
	verifyingContract: "0x0000000000000000000000000000000000000000" as Address,
} as const;

/** Aster EIP-712 signing chain IDs (NOT the network chain ID) */
export const ASTER_SIGNING_CHAIN_ID = {
	mainnet: 1666,
	testnet: 714,
} as const;

const EIP712_TYPES = {
	Message: [{ name: "msg", type: "string" }],
} as const;

// --- Withdrawal EIP-712 signing (different domain from API auth) ---

const WITHDRAW_EIP712_TYPES = {
	Action: [
		{ name: "type", type: "string" },
		{ name: "destination", type: "address" },
		{ name: "destination Chain", type: "string" },
		{ name: "token", type: "string" },
		{ name: "amount", type: "string" },
		{ name: "fee", type: "string" },
		{ name: "nonce", type: "uint256" },
		{ name: "aster chain", type: "string" },
	],
} as const;

const CHAIN_NAME: Record<number, string> = {
	1: "ETH",
	56: "BSC",
	97: "BSC testnet",
	42161: "Arbitrum",
};

/**
 * Sign an EIP-712 withdrawal request for the Aster API.
 * Uses a separate domain from the API auth signature.
 */
export async function signWithdrawRequest(params: {
	destination: Address;
	chainId: number;
	token: string;
	amount: string;
	fee: string;
	account: AsterSigner;
	asterChain?: "Mainnet" | "Testnet";
}): Promise<{ signature: Hex; nonce: bigint }> {
	const chainName = CHAIN_NAME[params.chainId];
	if (!chainName) {
		throw new Error(
			`Unsupported withdrawal chain ID: ${params.chainId}. Supported: ${Object.keys(CHAIN_NAME).join(", ")}`,
		);
	}

	const nonce = BigInt(Date.now()) * 1000n;

	const signature = await params.account.signTypedData({
		domain: {
			name: "Aster",
			version: "1",
			chainId: params.chainId,
			verifyingContract:
				"0x0000000000000000000000000000000000000000" as Address,
		},
		types: WITHDRAW_EIP712_TYPES,
		primaryType: "Action",
		message: {
			type: "Withdraw",
			destination: params.destination,
			"destination Chain": chainName,
			token: params.token,
			amount: params.amount,
			fee: params.fee,
			nonce,
			"aster chain": params.asterChain ?? "Mainnet",
		},
	});

	return { signature: signature as Hex, nonce };
}

/**
 * Infer EIP-712 type from a JS value, matching the Python demo's logic.
 */
export function inferEip712Type(value: unknown): string {
	if (typeof value === "boolean") return "bool";
	if (typeof value === "number" || typeof value === "bigint") return "uint256";
	return "string";
}

export function buildTypedRequest(
	params: Record<string, unknown>,
	primaryType: string,
	domainChainId: number,
) {
	const typeFields: Array<{ name: string; type: string }> = [];
	const message: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(params)) {
		if (value === undefined || value === null) continue;
		const capitalizedKey = key.charAt(0).toUpperCase() + key.slice(1);
		typeFields.push({ name: capitalizedKey, type: inferEip712Type(value) });
		message[capitalizedKey] = value;
	}
	return {
		domain: { ...EIP712_DOMAIN, chainId: domainChainId },
		types: { [primaryType]: typeFields },
		primaryType,
		message,
	} as const;
}

/**
 * Build the exact dynamic EIP-712 payload required by Aster's agent approval
 * endpoint. Keep this separate from generic management signing so every
 * client signs the required `asterChain` field in the same order it is sent.
 */
export function buildApproveAgentTypedRequest(
	params: ApproveAgentParams,
	domainChainId: number,
) {
	return buildTypedRequest(
		params as unknown as Record<string, unknown>,
		"ApproveAgent",
		domainChainId,
	);
}

export function buildApproveBuilderTypedRequest(
	params: ApproveBuilderParams,
	domainChainId: number,
) {
	return buildTypedRequest(
		params as unknown as Record<string, unknown>,
		"ApproveBuilder",
		domainChainId,
	);
}

/**
 * Sign params with a dynamic EIP-712 primary type (e.g. ApproveAgent, UpdateAgent).
 * Used for agent/builder management calls that require the main wallet key.
 * Matches the Python demo's `sign_v3_eip712` function.
 */
export async function signTypedRequest(
	params: Record<string, unknown>,
	primaryType: string,
	account: AsterSigner,
	domainChainId = 56,
): Promise<{ signature: Hex }> {
	const signature = await account.signTypedData(
		buildTypedRequest(params, primaryType, domainChainId),
	);

	return { signature: signature as Hex };
}

/**
 * Generate a nonce in microseconds with jitter, matching the JS demo.
 */
export function generateNonce(): number {
	return Math.floor(Date.now() * 1000) + Math.floor(Math.random() * 1_000_000);
}

/**
 * Build a URL-encoded query string for the actual HTTP request.
 * Special-cases `batchOrders` to encode single quotes as %27.
 */
export function buildEncodedQueryString(
	params: Record<string, string>,
): string {
	return Object.entries(params)
		.filter(([, v]) => v !== undefined && v !== null)
		.map(([k, v]) => {
			if (k === "batchOrders") {
				return `${k}=${encodeURIComponent(v).replace(/'/g, "%27")}`;
			}
			return `${k}=${encodeURIComponent(v)}`;
		})
		.join("&");
}

/**
 * Sign request params with EIP-712 typed data.
 * Adds nonce, user, signer (the signing account's address), and signature to
 * the params.
 */
export async function signRequest(
	params: Record<string, unknown>,
	user: Address,
	account: AsterSigner,
	signingChainId: number = ASTER_SIGNING_CHAIN_ID.mainnet,
): Promise<Record<string, string>> {
	// Stringify all values, remove nulls/undefined
	const stringified: Record<string, string> = {};
	for (const [key, value] of Object.entries(params)) {
		if (value !== null && value !== undefined) {
			stringified[key] = String(value);
		}
	}

	// Add auth params
	stringified.nonce = String(generateNonce());
	stringified.user = user;
	stringified.signer = account.address;

	// Build raw query string for signing
	const rawQueryString = buildEncodedQueryString(stringified);

	// Sign with EIP-712
	const signature = await account.signTypedData({
		domain: { ...EIP712_DOMAIN, chainId: signingChainId },
		types: EIP712_TYPES,
		primaryType: "Message",
		message: { msg: rawQueryString },
	});

	stringified.signature = signature;
	return stringified;
}
