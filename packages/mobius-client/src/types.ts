import type { Hex } from "viem";
import type {
	AsterCredentialResp,
	AsterPrepareResp,
	AsterStatusResp,
	HlCredentialResp,
	HlPrepareResp,
	HlStatusResp,
	LighterCredentialResp,
	LighterPrepareResp,
	LighterStatusResp,
} from "./binding.ts";
import type { buildOpenTaskMessage } from "./openTaskMessage.ts";
import type { buildResizeTaskMessage } from "./resizeTaskMessage.ts";
import type { LogPage, PublicTask } from "./tasks.ts";

export type ArbitrageVenue = "aster" | "hl" | "lighter" | "lighter-mainnet";
export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
export type OpenBody = Parameters<typeof buildOpenTaskMessage>[0];
export type ResizeBody = Parameters<typeof buildResizeTaskMessage>[0];
export type Signed<T> = T & { signature: Hex };
type TaskAuth = { taskId: string; timestamp: number };
type Prepare = { timestamp: number; nonce: string };
type Owner = { owner: string };
type Task = Owner & { taskId: string };
type Page = Task & { limit: number; cursor?: string };
export interface ReadRoutes {
	"/legal/terms": {
		params: Record<string, never>;
		result: {
			termsVersion: string;
			termsUrl: string;
			privacyVersion: string;
			privacyUrl: string;
		};
	};
	"/legal/acceptance": {
		params: { wallet: string };
		result: {
			accepted: boolean;
			termsVersion: string;
			privacyVersion: string;
			acceptedAt: string | null;
		};
	};
	"/api/arbitrage/list": { params: Owner; result: PublicTask[] };
	"/api/arbitrage/task": { params: Task; result: PublicTask };
	"/api/arbitrage/liq-trims": { params: Page; result: LogPage };
	"/api/arbitrage/resizes": { params: Page; result: LogPage };
	"/api/arbitrage/alert-dismissals": {
		params: Owner;
		result: { taskId: string; kind: string }[];
	};
	"/api/arbitrage/rates": {
		params: Record<string, never>;
		result: {
			observedAt: number;
			listed: string[];
			failed: string[];
			rates: {
				venue: string;
				market: string;
				ratePerInterval: number;
				intervalHours: number;
				annualizedPct: number;
			}[];
		};
	};
	"/api/binding/hl/credential": {
		params: { ownerAddress: string };
		result: HlCredentialResp;
	};
	"/api/binding/aster/credential": {
		params: { ownerAddress: string };
		result: AsterCredentialResp;
	};
	"/api/binding/lighter/credential": {
		params: { ownerAddress: string; venue?: "lighter" | "lighter-mainnet" };
		result: LighterCredentialResp;
	};
	"/api/binding/hl/status": {
		params: { sessionId: string };
		result: HlStatusResp;
	};
	"/api/binding/aster/status": {
		params: { sessionId: string };
		result: AsterStatusResp;
	};
	"/api/binding/lighter/status": {
		params: { sessionId: string };
		result: LighterStatusResp;
	};
	"/api/binding/rebind-check": {
		params: { ownerAddress: string; venue: ArbitrageVenue };
		result: { allowed: true };
	};
}
export interface WriteRoutes {
	"/legal/acceptance": {
		body: {
			wallet: string;
			termsVersion: string;
			privacyVersion: string;
			signedAt: number;
			signature: `0x${string}`;
		};
		result: { ok: true };
	};
	"/api/arbitrage/create": {
		body: Signed<OpenBody>;
		result: { taskId: string };
	};
	"/api/arbitrage/close": { body: Signed<TaskAuth>; result: { ok: boolean } };
	"/api/arbitrage/neutralize": {
		body: Signed<TaskAuth>;
		result: { ok: boolean };
	};
	"/api/arbitrage/resize": {
		body: Signed<ResizeBody>;
		result: { ok: boolean };
	};
	"/api/arbitrage/auto-close": {
		body: Signed<TaskAuth & { autoClose: boolean; minFundingApy: number }>;
		result: { ok: boolean };
	};
	"/api/arbitrage/liq-protection": {
		body: Signed<TaskAuth & { liqProtectionPct: number | null }>;
		result: { ok: boolean };
	};
	"/api/arbitrage/size-mismatch-auto-close": {
		body: Signed<TaskAuth & { enabled: boolean; thresholdPct: number }>;
		result: { ok: boolean };
	};
	"/api/arbitrage/alert-dismiss": {
		body: { owner: string; taskId: string; kind: string };
		result: { ok: boolean };
	};
	"/api/binding/hl/prepare": { body: Signed<Prepare>; result: HlPrepareResp };
	"/api/binding/aster/prepare": {
		body: Signed<Prepare>;
		result: AsterPrepareResp;
	};
	"/api/binding/lighter/prepare": {
		body: Signed<
			Prepare & {
				accountIndex: number;
				chainId: 304 | 466324;
				venue?: "lighter" | "lighter-mainnet";
			}
		>;
		result: LighterPrepareResp;
	};
	"/api/binding/lighter/integrator-approve": {
		body: Signed<
			Prepare & { ownerAddress: string; venue: "lighter" | "lighter-mainnet" }
		>;
		result: { ok: true; integratorIndex: number; expiresAt: number };
	};
	"/api/binding/hl/builder-finalize": {
		body: { ownerAddress: string };
		result: { ok: true };
	};
	"/api/binding/aster/builder-finalize": {
		body: { ownerAddress: string };
		result: { ok: true };
	};
}
