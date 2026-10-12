import type {
	BindingTarget,
	SignRequest,
	TypedPayload,
	Venue,
} from "./types.ts";

// Ported from mobius@0e3ff530 funding-server/src/binding/apiService.ts lines 19-39.
export function canonical(value: unknown): string {
	function sort(v: unknown): unknown {
		if (Array.isArray(v)) return v.map(sort);
		if (v && typeof v === "object")
			return Object.fromEntries(
				Object.entries(v)
					.sort(([a], [b]) => a.localeCompare(b))
					.map(([k, x]) => [k, sort(x)]),
			);
		return v;
	}
	return JSON.stringify(sort(value));
}

// Ported from mobius@0e3ff530 funding-server/src/binding/apiService.ts lines 19-39.
export function bindingMessage(
	action: "prepare" | "read",
	payload: unknown,
	domain = "mobius-api",
): string {
	return `Mobius venue binding v1\ndomain=${domain}\naction=${action}\npayload=${canonical(payload)}`;
}

type Clock = () => number;
const address = /^0x[0-9a-fA-F]{40}$/;
const signature = /^0x[0-9a-fA-F]{130}$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function owner(value: string): string {
	if (!address.test(value)) throw new Error("Valid owner address required.");
	return value.toLowerCase();
}

function expiry(value: number, now: Clock): number {
	const seconds = Math.floor(now() / 1000);
	if (!Number.isSafeInteger(value) || value < seconds || value > seconds + 300)
		throw new Error("expiresAt must be within now and now + 300 seconds.");
	return value;
}

export function preparePayload(
	value: {
		owner: string;
		venues: BindingTarget[];
		nonce: string;
		expiresAt: number;
	},
	now: Clock = Date.now,
) {
	if (!/^[A-Za-z0-9_-]{16,128}$/.test(value.nonce))
		throw new Error("nonce must contain 16 to 128 allowed characters.");
	if (
		!Array.isArray(value.venues) ||
		value.venues.length < 1 ||
		value.venues.length > 4 ||
		new Set(value.venues.map((target) => target.venue)).size !==
			value.venues.length
	)
		throw new Error("venues must contain 1 to 4 distinct targets.");
	for (const target of value.venues) {
		if (target.rebind !== undefined && typeof target.rebind !== "boolean")
			throw new Error("rebind must be boolean.");
		if (
			target.venue === "hl" &&
			target.signatureChainId !== undefined &&
			(!Number.isSafeInteger(target.signatureChainId) ||
				target.signatureChainId < 1)
		)
			throw new Error("HL signatureChainId must be a positive integer.");
		if (
			(target.venue === "lighter" || target.venue === "lighter-mainnet") &&
			(!Number.isSafeInteger(target.accountIndex) || target.accountIndex < 0)
		)
			throw new Error("Lighter accountIndex must be a nonnegative integer.");
	}
	return {
		owner: owner(value.owner),
		venues: value.venues,
		nonce: value.nonce,
		expiresAt: expiry(value.expiresAt, now),
	};
}

export function readPayload(
	value: { owner: string; bindingId: string; expiresAt: number },
	now: Clock = Date.now,
) {
	if (!uuid.test(value.bindingId))
		throw new Error("Valid bindingId is required.");
	return {
		owner: owner(value.owner),
		bindingId: value.bindingId,
		expiresAt: expiry(value.expiresAt, now),
	};
}

export function readHeaders(
	value: { owner: string; expiresAt: number; signature: string },
	now: Clock = Date.now,
): Record<string, string> {
	if (!signature.test(value.signature))
		throw new Error("A 65-byte hex signature is required.");
	return {
		"X-Wallet-Address": owner(value.owner),
		"X-Wallet-Expires-At": String(expiry(value.expiresAt, now)),
		"X-Wallet-Signature": value.signature,
	};
}

function record(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error("Expected an object.");
	return value as Record<string, unknown>;
}

export function classifySignRequest(request: unknown): {
	method: SignRequest["method"];
	venue: Venue;
	action: string;
	requestId: string;
} {
	const item = record(request);
	if (typeof item.requestId !== "string" || typeof item.action !== "string")
		throw new Error("Invalid binding sign request identity.");
	if (
		!["aster", "hl", "lighter", "lighter-mainnet"].includes(String(item.venue))
	)
		throw new Error("Invalid binding sign request venue.");
	const payload = record(item.payload);
	if (item.method === "personal_sign") {
		if (
			Object.keys(payload).length !== 1 ||
			typeof payload.message !== "string"
		)
			throw new Error("Expected the prepared UTF-8 message.");
	} else if (item.method === "eth_signTypedData_v4") {
		const keys = Object.keys(payload).sort();
		if (
			keys.join(",") !== "domain,message,primaryType,types" ||
			typeof payload.primaryType !== "string"
		)
			throw new Error("Expected the prepared typed data payload.");
		record(payload.domain);
		record(payload.types);
		record(payload.message);
	} else throw new Error("Invalid binding signing method.");
	return {
		method: item.method,
		venue: item.venue as Venue,
		action: item.action,
		requestId: item.requestId,
	};
}

export type { TypedPayload };
