import { ApiError } from "@mstack/mobius-client";
import { UsageError } from "./config.ts";
import { object, request } from "./onboarding-http.ts";
import type { Runtime } from "./run.ts";

// The server checks these accounts before it prepares a binding
// (mobius@0e3ff530 api-server/venue-bindings.md, "Account existence precheck").
// Checking first means the wallet never signs a prepare request the server
// must refuse.
type Lighter = "lighter" | "lighter-mainnet";
const lighterRest: Record<Lighter, string> = {
	lighter: "https://api.rh.lighter.xyz",
	"lighter-mainnet": "https://mainnet.zklighter.elliot.ai",
};
const names: Record<string, string> = {
	hl: "hl (Hyperliquid)",
	lighter: "lighter (Lighter on Robinhood Chain)",
	"lighter-mainnet": "lighter-mainnet (Lighter)",
};
// Lighter answers HTTP 400 with this code when the wallet has no account.
const NO_ACCOUNT = 21100;

const isLighter = (venue: string): venue is Lighter =>
	venue === "lighter" || venue === "lighter-mainnet";
const reason = (error: unknown) =>
	error instanceof Error ? error.message : String(error);

/** The wallet's account indexes on one Lighter deployment, main account first. */
async function lighterAccounts(
	venue: Lighter,
	owner: string,
	rt: Runtime,
): Promise<number[]> {
	const url = `${lighterRest[venue]}/api/v1/accountsByL1Address?l1_address=${owner}`;
	let value: unknown;
	try {
		value = await request(rt.fetch, url, "GET");
	} catch (error) {
		if (
			error instanceof ApiError &&
			error.data &&
			typeof error.data === "object" &&
			(error.data as Record<string, unknown>).code === NO_ACCOUNT
		)
			return [];
		throw new Error(`Cannot check the ${venue} account: ${reason(error)}`);
	}
	const body = object(value);
	if (body.code === NO_ACCOUNT) return [];
	if (body.code !== 200 || !Array.isArray(body.sub_accounts))
		throw new Error(`Cannot check the ${venue} account: unexpected response`);
	const accounts = body.sub_accounts.map((item) => {
		const row = object(item);
		if (
			typeof row.index !== "number" ||
			!Number.isSafeInteger(row.index) ||
			row.index < 0 ||
			typeof row.l1_address !== "string" ||
			row.l1_address.toLowerCase() !== owner.toLowerCase()
		)
			throw new Error(`Cannot check the ${venue} account: invalid account`);
		return { index: row.index, main: row.account_type === 0 };
	});
	return [
		...accounts.filter((account) => account.main),
		...accounts.filter((account) => !account.main),
	].map((account) => account.index);
}

async function hlMissing(owner: string, rt: Runtime): Promise<boolean> {
	let value: unknown;
	try {
		value = await request(
			rt.fetch,
			"https://api.hyperliquid.xyz/info",
			"POST",
			{ type: "userRole", user: owner },
		);
	} catch (error) {
		throw new Error(`Cannot check the hl account: ${reason(error)}`);
	}
	const { role } = object(value);
	if (typeof role !== "string")
		throw new Error("Cannot check the hl account: unexpected response");
	return role === "missing";
}

/**
 * True when the wallet's Hyperliquid perps account holds value. MoB reports
 * the venue as unavailable without it, which blocks key creation and opens.
 */
export async function hlDeposited(
	owner: string,
	rt: Runtime,
): Promise<boolean> {
	let clearing: unknown;
	try {
		clearing = await request(
			rt.fetch,
			"https://api.hyperliquid.xyz/info",
			"POST",
			{ type: "clearinghouseState", user: owner },
		);
	} catch (error) {
		throw new Error(`Cannot check the hl deposit: ${reason(error)}`);
	}
	const value = object(object(clearing).marginSummary).accountValue;
	if (
		typeof value !== "string" ||
		!value.trim() ||
		!Number.isFinite(Number(value))
	)
		throw new Error("Cannot check the hl deposit: malformed balance");
	return Number(value) > 0;
}

export const HL_DEPOSIT_HINT =
	"This wallet's Hyperliquid perps account holds no USDC, so MoB reports Hyperliquid as unavailable and cannot create a key for it. Deposit USDC into Hyperliquid perps (app.hyperliquid.xyz, from Arbitrum), then run this again";
/** MoB's readiness reason that is not a binding problem. */
export function unavailableHint(venue: string): string {
	return venue === "hl"
		? HL_DEPOSIT_HINT
		: `MoB cannot confirm ${venue} is usable right now (unavailable). Wait a minute, then run this again`;
}

/**
 * Returns the account index for each selected Lighter deployment. Stops before
 * staging when a venue has no account for the owner, or when an explicit
 * Lighter account does not belong to it.
 */
export async function venueAccounts(
	owner: string,
	venues: readonly string[],
	rt: Runtime,
	explicitLighter?: number,
	/** Every venue the user asked for, for the "leave it out" hint. */
	selected: readonly string[] = venues,
): Promise<Map<Lighter, number>> {
	const lighters = venues.filter(isLighter);
	if (explicitLighter !== undefined && lighters.length !== 1)
		throw new UsageError(
			"--lighter-account needs exactly one Lighter venue; each deployment has its own account",
		);
	const [hl, ...found] = await Promise.all([
		venues.includes("hl") ? hlMissing(owner, rt) : false,
		...lighters.map((venue) => lighterAccounts(venue, owner, rt)),
	]);
	const missing = [
		...(hl ? ["hl"] : []),
		...lighters.filter((_, index) => !found[index]?.length),
	];
	if (missing.length) {
		const rest = selected.filter((venue) => !missing.includes(venue));
		throw new UsageError(
			`No ${missing.map((venue) => names[venue]).join(" or ")} account for ${owner}. Create it on the venue's official website, then run this again${rest.length ? `, or leave it out with --venues ${rest.join(",")}` : ""}. Nothing was staged.`,
		);
	}
	const indexes = new Map<Lighter, number>();
	lighters.forEach((venue, index) => {
		const owned = found[index] as number[];
		if (explicitLighter !== undefined && !owned.includes(explicitLighter))
			throw new UsageError(
				`Lighter account ${explicitLighter} does not belong to ${owner} on ${venue}. Nothing was staged.`,
			);
		indexes.set(venue, explicitLighter ?? (owned[0] as number));
	});
	return indexes;
}
