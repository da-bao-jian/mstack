// Ported from mobius@33ed2ece frontend/src/features/binding/api.ts

import type { Address } from "viem";
import type { ArbitrageVenue } from "./types.ts";
// Ported from mobius@33ed2ece packages/aster-client/src/types.ts
export interface ApproveAgentParams {
	user: Address;
	agentName: string;
	agentAddress: Address;
	expired: number;
	canSpotTrade: boolean;
	canPerpTrade: boolean;
	canWithdraw: boolean;
	asterChain: "Mainnet" | "Testnet";
	ipWhitelist?: string;
	builder?: Address;
	maxFeeRate?: string;
	builderName?: string;
	nonce: number;
}
export interface HlCredential {
	bound: true;
	agentAddress: string;
	builderApproved: boolean;
	builderAddress: string | null;
	isTestnet: boolean;
}

export interface AsterCredential {
	bound: true;
	agentAddress: string;
	builderApproved: boolean;
	builderAddress: string | null;
	feeRate: string | null;
	signingChainId: number;
}

export interface AsterSession {
	sessionId: string;
	status: string;
	agentAddress: string;
	approvalParams?: ApproveAgentParams;
	baseUrl?: string;
	signingChainId?: number;
}

export interface AsterRepair {
	agentAddress: string;
	builderAddress: string;
	maxFeeRate: string;
	builderName: string;
	needsBuilderFee: true;
}

export type AsterCredentialResp =
	| AsterCredential
	| {
			bound: false;
			session?: AsterSession;
			repair?: AsterRepair;
			issue?: "key_invalid";
			error?: string;
	  };

export interface AsterPrepareResp {
	sessionId: string;
	agentAddress: string;
	approvalParams: ApproveAgentParams;
	baseUrl: string;
	signingChainId: number;
}

export interface AsterStatusResp {
	status: "pending" | "bound" | "failed";
	agentAddress?: string;
	needsBuilderFee?: boolean;
	builderAddress?: string;
	maxFeeRate?: string;
	builderName?: string;
	error?: string;
}

export interface HlSession {
	sessionId: string;
	status: string;
	agentAddress: string;
	builderAddress?: string | null;
}

export interface HlRepair {
	agentAddress: string;
	builderAddress: string;
	needsBuilderFee: true;
}

export type HlCredentialResp =
	| HlCredential
	| {
			bound: false;
			session?: HlSession;
			repair?: HlRepair;
			issue?: "key_invalid";
			error?: string;
	  };

export interface HlPrepareResp {
	sessionId: string;
	agentAddress: string;
	builderAddress?: string;
}

export interface HlStatusResp {
	status: "pending" | "bound" | "failed";
	agentAddress?: string;
	needsBuilderFee?: boolean;
	error?: string;
}

export interface LighterCredential {
	bound: true;
	publicKey: string;
	slot: number;
	accountIndex: number;
	chainId: number;
	integratorApproved: boolean;
	integratorIndex: number | null;
	integratorAddress: string | null;
}

export interface LighterSession {
	sessionId: string;
	status: string;
	publicKey?: string;
	slot?: number;
	accountIndex?: number;
	chainId?: number;
	messageToSign?: string;
	txInfo?: Record<string, unknown>;
}

export type LighterCredentialResp =
	| LighterCredential
	| {
			bound: false;
			session?: LighterSession;
			integratorIndex?: number | null;
			integratorAddress?: string | null;
	  };

export interface LighterPrepareResp {
	sessionId: string;
	messageToSign: string;
	txInfo: Record<string, unknown>;
}

export interface LighterStatusResp {
	status: "pending" | "bound" | "failed";
	publicKey?: string;
	slot?: number;
	integratorIndex?: number | null;
	integratorAddress?: string | null;
	integratorApproved?: boolean;
	error?: string;
}

export type ArbitrageVenueReadinessIssue =
	| "not_bound"
	| "key_invalid"
	| "builder_fee_missing"
	| "integrator_approval_missing"
	| "unavailable";

export interface ArbitrageVenueReadinessItem {
	venue: ArbitrageVenue;
	ready: boolean;
	issue?: ArbitrageVenueReadinessIssue;
}

export interface ArbitrageVenueReadinessResp {
	ready: boolean;
	venues: ArbitrageVenueReadinessItem[];
}

export interface ArbitrageVenueReadinessError {
	error: "Venue readiness check failed." | "venue readiness failed";
	readiness: ArbitrageVenueReadinessResp;
}

export function isVenueReadinessError(
	value: unknown,
): value is ArbitrageVenueReadinessError {
	if (!value || typeof value !== "object") return false;
	const record = value as Record<string, unknown>;
	const readiness = record.readiness;
	return (
		(record.error === "Venue readiness check failed." ||
			record.error === "venue readiness failed") &&
		!!readiness &&
		typeof readiness === "object" &&
		Array.isArray((readiness as Record<string, unknown>).venues)
	);
}
