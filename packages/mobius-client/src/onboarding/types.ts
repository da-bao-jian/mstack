// Ported from mobius@33ed2ece packages/aster-client/src/types.ts
import type { Address, Hex } from "viem";
export interface ApproveAgentParams {
	user: Address;
	agentName: string;
	agentAddress: Address;
	expired: number;
	canSpotTrade: boolean;
	canPerpTrade: boolean;
	canWithdraw: boolean;
	/**
	 * Aster's management endpoints include this network discriminator in both
	 * the submitted form data and the signed EIP-712 message.
	 */
	asterChain: "Mainnet" | "Testnet";
	ipWhitelist?: string;
	builder?: Address;
	maxFeeRate?: string;
	builderName?: string;
	nonce: number;
}

export interface ApproveBuilderParams {
	builder: Address;
	maxFeeRate: string;
	builderName: string;
	asterChain: "Mainnet" | "Testnet";
	user: Address;
	nonce: number;
}

export interface AsterSigner {
	address: Address;
	signTypedData: (parameters: any) => Promise<Hex>;
}
