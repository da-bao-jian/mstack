import type { Hex } from "viem";
import type { ArbitrageVenue } from "./types.ts";

declare const secretBrand: unique symbol;
export type Secret<T> = T & { readonly [secretBrand]: "secret" };

export interface ApiKeyRecord {
	id: string;
	name: string;
	venues: ArbitrageVenue[];
	max_size_usd: string;
	key_prefix: string;
	created_at: string;
	revoked_at: string | null;
}

export interface ApiKeyListBody {
	owner: string;
	timestamp: number;
	signature: Hex;
}
export interface ApiKeyCreateBody extends ApiKeyListBody {
	name: string;
	venues: ArbitrageVenue[];
	maxSizeUsd?: number;
	nonce: string;
}
export interface ApiKeyRevokeBody extends ApiKeyListBody {
	id: string;
}

// Ported from mobius@0e3ff530 funding-server/src/server/routes/apiKeys.ts
// SHA-256 1b43c60fa77af0b16ec8e6924960e21b26d23f62d42a879ac721372d72ac5047
export function apiKeyMessage(
	action: "list" | "create" | "revoke",
	params: {
		owner: string;
		timestamp: number;
		name?: string;
		venues?: readonly ArbitrageVenue[];
		maxSizeUsd?: number;
		nonce?: string;
		id?: string;
	},
): string {
	const base = `Mobius API keys: ${action} owner=${params.owner.toLowerCase()}`;
	if (action === "create")
		return `${base} name=${JSON.stringify(params.name)} venues=${params.venues?.join(",")}${params.maxSizeUsd === undefined ? "" : ` maxSizeUsd=${params.maxSizeUsd}`} nonce=${params.nonce} timestamp=${params.timestamp}`;
	if (action === "revoke")
		return `${base} id=${params.id} timestamp=${params.timestamp}`;
	return `${base} timestamp=${params.timestamp}`;
}

const venues = ["aster", "hl", "lighter", "lighter-mainnet"];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const address = /^0x[0-9a-fA-F]{40}$/;
const signature = /^0x[0-9a-fA-F]{130}$/;

export function validateApiKeyBody(
	action: "list" | "create" | "revoke",
	value: unknown,
): void {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error("Invalid API key body.");
	const body = value as Record<string, unknown>;
	const allowed =
		action === "create"
			? [
					"owner",
					"name",
					"venues",
					"maxSizeUsd",
					"nonce",
					"timestamp",
					"signature",
				]
			: action === "revoke"
				? ["owner", "id", "timestamp", "signature"]
				: ["owner", "timestamp", "signature"];
	if (Object.keys(body).some((key) => !allowed.includes(key)))
		throw new Error("Unsupported API key body field.");
	if (!address.test(String(body.owner)))
		throw new Error("Invalid API key owner.");
	if (!Number.isSafeInteger(body.timestamp))
		throw new Error("Invalid API key timestamp.");
	if (!signature.test(String(body.signature)))
		throw new Error("Invalid API key signature.");
	if (action === "create") {
		if (
			typeof body.name !== "string" ||
			!body.name.trim() ||
			body.name.length > 64 ||
			/[\p{Cc}\p{Cf}]/u.test(body.name)
		)
			throw new Error("Invalid API key name.");
		if (
			!Array.isArray(body.venues) ||
			body.venues.length < 1 ||
			body.venues.length > 4 ||
			body.venues.some((venue) => !venues.includes(String(venue))) ||
			new Set(body.venues).size !== body.venues.length
		)
			throw new Error("Invalid API key venues.");
		if (!uuid.test(String(body.nonce)))
			throw new Error("Invalid API key nonce.");
		if (
			body.maxSizeUsd !== undefined &&
			(typeof body.maxSizeUsd !== "number" ||
				!Number.isFinite(body.maxSizeUsd) ||
				body.maxSizeUsd < 10 ||
				body.maxSizeUsd > 1_000_000_000 ||
				Math.round(body.maxSizeUsd * 1_000_000) / 1_000_000 !== body.maxSizeUsd)
		)
			throw new Error("Invalid API key maxSizeUsd.");
	}
	if (action === "revoke" && !uuid.test(String(body.id)))
		throw new Error("Invalid API key id.");
}

function object(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error("expected object");
	return value as Record<string, unknown>;
}

export function validateApiKeyRecord(value: unknown): ApiKeyRecord {
	const row = object(value);
	for (const key of ["id", "name", "max_size_usd", "key_prefix", "created_at"])
		if (typeof row[key] !== "string") throw new Error(`invalid ${key}`);
	if (
		!Array.isArray(row.venues) ||
		row.venues.some((venue) => !venues.includes(String(venue)))
	)
		throw new Error("invalid venues");
	if (row.revoked_at !== null && typeof row.revoked_at !== "string")
		throw new Error("invalid revoked_at");
	return row as unknown as ApiKeyRecord;
}

export function validateApiKeyResponse(
	action: "list" | "create" | "revoke",
	value: unknown,
): unknown {
	if (action === "list") {
		if (!Array.isArray(value)) throw new Error("expected API key array");
		return value.map(validateApiKeyRecord);
	}
	const body = object(value);
	if (action === "revoke") {
		if (body.ok !== true) throw new Error("API key was not revoked");
		return { ok: true as const };
	}
	if (
		typeof body.key !== "string" ||
		!/^mobius_[0-9a-f-]{36}\.[0-9a-f]{64}$/.test(body.key)
	)
		throw new Error("invalid API key secret");
	return {
		key: body.key as Secret<string>,
		record: validateApiKeyRecord(body.record),
	};
}
