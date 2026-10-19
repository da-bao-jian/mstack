import type { TypedDataDomain } from "viem";

export type Venue = "aster" | "hl" | "lighter" | "lighter-mainnet";
export type HexSignature = `0x${string}`;
export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

// Ported from mobius@0e3ff530 funding-server/src/binding/apiTypes.ts
export interface TypedPayload {
	domain: TypedDataDomain;
	types: Record<string, readonly { name: string; type: string }[]>;
	primaryType: string;
	message: Record<string, unknown>;
}

// Ported from mobius@0e3ff530 funding-server/src/binding/apiTypes.ts. API 1.2.0
// requires a Lighter accountIndex; each deployment has its own account.
export type BindingTarget =
	| { venue: "hl"; signatureChainId?: number; rebind?: boolean }
	| { venue: "aster"; rebind?: boolean }
	| {
			venue: "lighter" | "lighter-mainnet";
			accountIndex: number;
			rebind?: boolean;
	  };

// Ported from mobius@0e3ff530 funding-server/src/binding/apiTypes.ts
export interface SignRequest {
	requestId: string;
	venue: Venue;
	action: string;
	method: "personal_sign" | "eth_signTypedData_v4";
	payload: { message: string } | TypedPayload;
}

export interface CreateTask {
	longVenue: Venue;
	shortVenue: Venue;
	longMarket: string;
	shortMarket: string;
	sizeUsd: number;
	minFundingApy?: number;
	autoClose?: boolean;
	maxSpreadBps?: number;
	liqProtectionPct?: number;
	sizeMismatchPct?: number;
}

export interface ResizeTask {
	longTargetBase?: number;
	shortTargetBase?: number;
	disableSizeMismatchAutoClose?: boolean;
}

export interface Task {
	taskId: string;
	longVenue: Venue;
	shortVenue: Venue;
	longMarket: string;
	shortMarket: string;
	sizeUsd: string;
	status: string;
	longSize: string | null;
	shortSize: string | null;
	longEntry: string | null;
	shortEntry: string | null;
	longPrice: string | null;
	shortPrice: string | null;
	longLeverage: string | null;
	shortLeverage: string | null;
	liqProtectionPct: string | null;
	sizeMismatchPct: string | null;
	fundingUsd: string;
	longMarginMode: string | null;
	shortMarginMode: string | null;
	closeReason: string | null;
	error: string | null;
	createdAt: string;
	updatedAt: string;
	closeRequestedAt: string | null;
}

export interface RequestLog {
	request_id: string;
	action: string;
	path: string;
	task_id: string | null;
	http_status: number;
	error_code: string | null;
	replayed: boolean;
	created_at: string;
	order_id: string | null;
}

export interface BindingResult {
	venue: Venue;
	sessionId: string | null;
	status:
		| "awaiting_signatures"
		| "queued"
		| "confirming"
		| "bound"
		| "already_bound"
		| "failed"
		| "expired";
	code?: string;
	retryable?: boolean;
}

export interface VenueBindingBatch {
	bindingId: string;
	owner: string;
	expiresAt: string;
	status:
		| "awaiting_signatures"
		| "processing"
		| "bound"
		| "partial_success"
		| "failed";
	results: BindingResult[];
	signRequests: SignRequest[];
}

export interface PrepareVenueBindings {
	owner: string;
	venues: BindingTarget[];
	authorization: {
		nonce: string;
		expiresAt: number;
		signature: HexSignature;
	};
}

export interface SubmitVenueBindings {
	signatures: { requestId: string; signature: HexSignature }[];
}

export interface MutationOptions {
	idempotencyKey: string;
	signal?: AbortSignal;
}

export type AcceptedStatus =
	| "pending"
	| "cancelled"
	| "close_queued"
	| "resizing";
export interface AcceptedTask<S extends AcceptedStatus = AcceptedStatus> {
	taskId: string;
	status: S;
	disposition: "accepted, not executed";
}
