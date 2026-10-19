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

const ZERO = "0x0000000000000000000000000000000000000000";
const field = (name: string, type: string) => ({ name, type });
const DOMAIN_TYPES = [
	field("name", "string"),
	field("version", "string"),
	field("chainId", "uint256"),
	field("verifyingContract", "address"),
];
const HL_TYPES: Record<string, { name: string; type: string }[]> = {
	approveAgent: [
		field("hyperliquidChain", "string"),
		field("agentAddress", "address"),
		field("agentName", "string"),
		field("nonce", "uint64"),
	],
	approveBuilderFee: [
		field("hyperliquidChain", "string"),
		field("maxFeeRate", "string"),
		field("builder", "address"),
		field("nonce", "uint64"),
	],
};
const ASTER_TYPES = [
	field("AgentName", "string"),
	field("AgentAddress", "string"),
	field("IpWhitelist", "string"),
	field("Expired", "uint256"),
	field("CanSpotTrade", "bool"),
	field("CanPerpTrade", "bool"),
	field("CanWithdraw", "bool"),
	field("Builder", "string"),
	field("MaxFeeRate", "string"),
	field("BuilderName", "string"),
	field("AsterChain", "string"),
	field("User", "string"),
	field("Nonce", "uint256"),
];
const LIGHTER_KEY =
	/^Register Lighter Account\n\npubkey: 0x[0-9a-f]{80}\nnonce: 0x[0-9a-f]{16}\naccount index: 0x[0-9a-f]{16}\napi key index: 0x[0-9a-f]{16}\nOnly sign this message for a trusted client!$/;
const LIGHTER_INTEGRATOR =
	/^Approve zero-fee Lighter integrator owner=(0x[0-9a-f]{40}) venue=(lighter|lighter-mainnet) integratorIndex=\d{1,10} nonce=[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12} timestamp=\d{1,12}$/;

/** What each allowed binding request lets the venue key do, for the card. */
const CAPABILITY: Record<string, string> = {
	"hl:approveAgent": "trades on Hyperliquid; an agent cannot withdraw",
	"hl:approveBuilderFee": "approves a builder fee of at most 0.1%",
	"aster:approveAgent": "trades perps on Aster; withdrawal stays off",
	"lighter:changePubKey":
		"registers a Lighter API key; it can trade and withdraw only to your own address",
	"lighter:approveIntegrator": "approves the zero-fee Lighter integrator",
	"lighter-mainnet:changePubKey":
		"registers a Lighter API key; it can trade and withdraw only to your own address",
	"lighter-mainnet:approveIntegrator":
		"approves the zero-fee Lighter integrator",
};

function same(value: unknown, expected: unknown): boolean {
	return canonical(value) === canonical(expected);
}

function keys(value: Record<string, unknown>, expected: string[]): boolean {
	return same(Object.keys(value).sort(), [...expected].sort());
}

function count(value: unknown): value is number {
	return Number.isSafeInteger(value) && Number(value) > 0;
}

/** A decimal fee no higher than `max`; a trailing % is part of the string. */
function fee(value: unknown, max: number, percent: boolean): boolean {
	if (typeof value !== "string") return false;
	const match = (percent ? /^(\d+(?:\.\d+)?)%$/ : /^(\d+(?:\.\d+)?)$/).exec(
		value,
	);
	return match !== null && Number(match[1]) <= max;
}

function typedTypes(
	types: Record<string, unknown>,
	primary: string,
	fields: unknown,
): boolean {
	const { EIP712Domain, ...rest } = types;
	return (
		(EIP712Domain === undefined || same(EIP712Domain, DOMAIN_TYPES)) &&
		same(rest, { [primary]: fields })
	);
}

function checkHl(action: string, payload: Record<string, unknown>): void {
	const domain = record(payload.domain);
	const message = record(payload.message);
	const primary = `HyperliquidTransaction:${action === "approveAgent" ? "ApproveAgent" : "ApproveBuilderFee"}`;
	const chainId = domain.chainId;
	if (
		!keys(domain, ["name", "version", "chainId", "verifyingContract"]) ||
		domain.name !== "HyperliquidSignTransaction" ||
		domain.version !== "1" ||
		domain.verifyingContract !== ZERO ||
		!count(chainId) ||
		payload.primaryType !== primary ||
		!typedTypes(record(payload.types), primary, HL_TYPES[action]) ||
		typeof message.signatureChainId !== "string" ||
		!/^0x[0-9a-f]+$/i.test(message.signatureChainId) ||
		Number(message.signatureChainId) !== chainId ||
		message.hyperliquidChain !== "Mainnet" ||
		message.type !== action ||
		!count(message.nonce)
	)
		throw new Error(`Unexpected Hyperliquid ${action} request.`);
	if (action === "approveAgent") {
		if (
			!keys(message, [
				"signatureChainId",
				"hyperliquidChain",
				"type",
				"agentAddress",
				"agentName",
				"nonce",
			]) ||
			!address.test(String(message.agentAddress)) ||
			!/^mobius-bot(?: valid_until \d{13})?$/.test(String(message.agentName))
		)
			throw new Error("Unexpected Hyperliquid approveAgent request.");
	} else if (
		!keys(message, [
			"signatureChainId",
			"hyperliquidChain",
			"type",
			"builder",
			"maxFeeRate",
			"nonce",
		]) ||
		!address.test(String(message.builder)) ||
		!fee(message.maxFeeRate, 0.1, true)
	)
		throw new Error("Unexpected Hyperliquid approveBuilderFee request.");
}

function checkAster(
	payload: Record<string, unknown>,
	expectedOwner: string,
	now: Clock,
): void {
	const domain = record(payload.domain);
	const message = record(payload.message);
	const text = (value: unknown) =>
		typeof value === "string" && /^[\x20-\x7e]{1,64}$/.test(value);
	if (
		!same(domain, {
			name: "AsterSignTransaction",
			version: "1",
			chainId: 56,
			verifyingContract: ZERO,
		}) ||
		payload.primaryType !== "ApproveAgent" ||
		!typedTypes(record(payload.types), "ApproveAgent", ASTER_TYPES) ||
		!keys(
			message,
			ASTER_TYPES.map((item) => item.name),
		) ||
		String(message.User).toLowerCase() !== expectedOwner ||
		!address.test(String(message.User)) ||
		!address.test(String(message.AgentAddress)) ||
		!address.test(String(message.Builder)) ||
		message.CanWithdraw !== false ||
		message.CanSpotTrade !== false ||
		message.CanPerpTrade !== true ||
		message.AsterChain !== "Mainnet" ||
		!fee(message.MaxFeeRate, 0.001, false) ||
		!text(message.AgentName) ||
		!text(message.BuilderName) ||
		typeof message.IpWhitelist !== "string" ||
		!/^[0-9A-Fa-f.:,/ ]{0,256}$/.test(message.IpWhitelist) ||
		!count(message.Expired) ||
		Number(message.Expired) <= now() ||
		!count(message.Nonce)
	)
		throw new Error("Unexpected Aster approveAgent request.");
}

/**
 * Checks a server-prepared binding request against the exact shape of each
 * request the venues use, so a compromised or redirected server cannot get a
 * withdrawal, transfer, or token permit signed as "binding". Only the venues
 * the owner asked to bind are accepted; the payload is never rebuilt.
 */
export function classifySignRequest(
	request: unknown,
	context: { owner: string; venues: readonly Venue[]; now?: Clock },
): {
	method: SignRequest["method"];
	venue: Venue;
	action: string;
	requestId: string;
	capability: string;
} {
	const item = record(request);
	const expectedOwner = owner(context.owner);
	const venue = String(item.venue) as Venue;
	const action = String(item.action);
	const id = `${venue}:${action}`;
	if (
		!keys(item, ["requestId", "venue", "action", "method", "payload"]) ||
		item.requestId !== id ||
		!Object.hasOwn(CAPABILITY, id)
	)
		throw new Error("Unexpected binding sign request.");
	if (!context.venues.includes(venue))
		throw new Error(`Binding request for ${venue}, which was not requested.`);
	const payload = record(item.payload);
	const typed = venue === "hl" || venue === "aster";
	if (item.method !== (typed ? "eth_signTypedData_v4" : "personal_sign"))
		throw new Error("Invalid binding signing method.");
	if (typed) {
		if (!keys(payload, ["domain", "types", "primaryType", "message"]))
			throw new Error("Expected the prepared typed data payload.");
		if (venue === "hl") checkHl(action, payload);
		else checkAster(payload, expectedOwner, context.now ?? Date.now);
	} else {
		const message = payload.message;
		if (!keys(payload, ["message"]) || typeof message !== "string")
			throw new Error("Expected the prepared UTF-8 message.");
		const integrator = LIGHTER_INTEGRATOR.exec(message);
		if (
			action === "changePubKey"
				? !LIGHTER_KEY.test(message)
				: integrator?.[1] !== expectedOwner || integrator[2] !== venue
		)
			throw new Error(`Unexpected Lighter ${action} request.`);
	}
	return {
		method: item.method as SignRequest["method"],
		venue,
		action,
		requestId: id,
		capability: CAPABILITY[id] as string,
	};
}

export type { TypedPayload };
