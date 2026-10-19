import { expect, test } from "bun:test";
import type { Runtime } from "../src/run.ts";
import { hlDeposited, venueAccounts } from "../src/venue-accounts.ts";
import { venueAccountResponse } from "./fixtures/venue-accounts.ts";

const owner = "0x00000000000000000000000000000000000000aa";
function runtime(missing: string[] = [], calls: string[] = []) {
	return {
		fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
			calls.push(new URL(String(input)).host);
			return (
				venueAccountResponse(input, init, owner, missing) ??
				Response.json({ error: "unexpected" }, { status: 500 })
			);
		},
	} as unknown as Runtime;
}

test("each Lighter deployment gets the wallet's own main account", async () => {
	const calls: string[] = [];
	const accounts = await venueAccounts(
		owner,
		["hl", "lighter", "lighter-mainnet", "aster"],
		runtime([], calls),
	);
	expect(Object.fromEntries(accounts)).toEqual({
		lighter: 123,
		"lighter-mainnet": 456,
	});
	expect(calls.sort()).toEqual([
		"api.hyperliquid.xyz",
		"api.rh.lighter.xyz",
		"mainnet.zklighter.elliot.ai",
	]);
});

test("a venue without an account stops before staging and names the rest", async () => {
	await expect(
		venueAccounts(
			owner,
			["hl", "lighter-mainnet", "lighter"],
			runtime(["lighter-mainnet"]),
		),
	).rejects.toThrow(
		`No lighter-mainnet (Lighter) account for ${owner}. Create it on the venue's official website, then run this again, or leave it out with --venues hl,lighter. Nothing was staged.`,
	);
	await expect(venueAccounts(owner, ["hl"], runtime(["hl"]))).rejects.toThrow(
		"No hl (Hyperliquid) account",
	);
});

test("an explicit Lighter account must be one venue's and the wallet's", async () => {
	expect(
		Object.fromEntries(await venueAccounts(owner, ["lighter"], runtime(), 900)),
	).toEqual({ lighter: 900 });
	await expect(venueAccounts(owner, ["lighter"], runtime(), 7)).rejects.toThrow(
		"Lighter account 7 does not belong to",
	);
	await expect(
		venueAccounts(owner, ["lighter", "lighter-mainnet"], runtime(), 123),
	).rejects.toThrow("--lighter-account needs exactly one Lighter venue");
});

test("a failed lookup is not read as a missing account", async () => {
	const rt = {
		fetch: async () => Response.json({ error: "down" }, { status: 503 }),
	} as unknown as Runtime;
	await expect(venueAccounts(owner, ["lighter"], rt)).rejects.toThrow(
		"Cannot check the lighter account: HTTP 503",
	);
});

test("a Hyperliquid wallet with no deposit is detected, and a lookup failure is not read as no deposit", async () => {
	expect(await hlDeposited(owner, runtime())).toBe(true);
	expect(await hlDeposited(owner, runtime(["hl-deposit"]))).toBe(false);
	const down = {
		fetch: async () => Response.json({ error: "down" }, { status: 503 }),
	} as unknown as Runtime;
	await expect(hlDeposited(owner, down)).rejects.toThrow(
		"Cannot check the hl deposit",
	);
});
