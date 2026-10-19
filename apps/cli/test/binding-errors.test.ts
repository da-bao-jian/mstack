import { expect, test } from "bun:test";
import { StrategyApiError } from "@mstack/mobius-api";
import { ApiError } from "@mstack/mobius-client";
import {
	explainCeremonyFailure,
	explainVenueResult,
} from "../src/binding-errors.ts";
import { UsageError } from "../src/config.ts";

const ctx = {
	id: "c-3",
	owner: "0x00000000000000000000000000000000000000aa",
	restage:
		"mob onboard --native --venues 'lighter,hl' --max-size '5000' --rebind",
};
const strategy = (status: number, code: string, serverError: string) =>
	explainCeremonyFailure(
		new StrategyApiError({
			route: "/v1/venue-bindings/prepare",
			status,
			code,
			serverError,
			message: `HTTP ${status}: ${serverError}`,
		}),
		ctx,
	);

// Every code MoB's batch API returns (funding-server binding/apiService.ts,
// apiAdapters.ts) becomes a message that names what to do next.
test.each([
	[
		401,
		"authorization_expired",
		"Authorization expiresAt must be within the next 300 seconds.",
		"after its 5-minute window",
	],
	[
		403,
		"owner_mismatch",
		"Signature does not match owner.",
		"MoB could not match the signature to 0x00000000000000000000000000000000000000aa. Connect the wallet for that address",
	],
	[
		409,
		"nonce_conflict",
		"Nonce was used for a different request.",
		"one-time number was already used",
	],
	[
		429,
		"rate_limited",
		"Too many binding preparations. Retry later.",
		"Wait 10 minutes",
	],
	[
		422,
		"venue_account_not_found",
		"No hl account found for this wallet. Create an account on the venue's official website before binding.",
		"Hyperliquid has no account for this wallet. Create one on Hyperliquid (deposit funds at app.hyperliquid.xyz)",
	],
	[
		403,
		"account_not_owned",
		"lighter accountIndex does not belong to this wallet.",
		"without --lighter-account",
	],
	[
		503,
		"venue_account_check_unavailable",
		"lighter account lookup could not be completed. Retry when the venue is available.",
		"This does not mean the account is missing",
	],
	[
		409,
		"rebind_required",
		"hl credential is not usable; explicitly request rebind.",
		"Hyperliquid already has a MoB key that is not usable. Stage again with --rebind",
	],
	[
		409,
		"venue_busy",
		"hl is used by an active strategy or order.",
		"Hyperliquid has an open MoB position or order",
	],
	[
		409,
		"binding_in_progress",
		"lighter already has a pending binding session.",
		"Lighter on Robinhood Chain already has a binding in progress",
	],
	[
		410,
		"binding_expired",
		"Binding session expired. Prepare a new binding.",
		"This binding session is over",
	],
	[
		409,
		"signature_conflict",
		"Signature has already been accepted.",
		"Run `mob doctor`",
	],
	[404, "binding_not_found", "Binding not found.", "MoB has no such binding"],
	[
		503,
		"binding_unavailable",
		"Binding request could not be completed.",
		"Wait a minute, then run `mob sign c-3` again",
	],
] as const)("%i %s explains the fix", (status, code, serverError, fix) => {
	const error = strategy(status, code, serverError);
	expect(error).toBeInstanceOf(UsageError);
	expect(error.message).toContain(fix);
	expect(error.message).toContain(`MoB said: "${serverError}"`);
});

test("every staged-again instruction carries the exact command", () => {
	expect(strategy(401, "authorization_expired", "expired").message).toContain(
		"Stage a new ceremony with `mob onboard --native --venues 'lighter,hl' --max-size '5000' --rebind` and sign it.",
	);
});

test.each([
	[
		400,
		"timestamp expired or invalid",
		"more than 5 minutes before MoB received it",
	],
	[409, "nonce already used", "already used this one-time approval"],
	[
		403,
		"signature does not match ownerAddress",
		"signed by a different wallet",
	],
	[
		409,
		"A wallet can have at most 10 active API keys.",
		"Revoke an unused one with `mob keys revoke <id>`",
	],
	[
		409,
		"Bind the selected venues before creating an API key.",
		"bind the venue, then create the key again",
	],
	[
		401,
		"Valid wallet signature required.",
		"Create the key again and sign it promptly",
	],
	[
		409,
		"stale legal terms version",
		"The legal terms changed while you signed",
	],
	[401, "Signature timestamp outside acceptance window", "Correct the clock"],
	[
		500,
		"The service is temporarily unavailable. Please try again later.",
		"MoB is temporarily unavailable (HTTP 500)",
	],
] as const)(
	"funding and auth server %i %s explains the fix",
	(status, text, fix) => {
		const error = explainCeremonyFailure(
			new ApiError(`HTTP ${status}: ${text}`, status, { error: text }),
			ctx,
		);
		expect(error.message).toContain(fix);
		expect(error.message).toContain(`MoB said: "${text}"`);
	},
);

test.each([
	[
		"Browser wallet rejected the ceremony",
		"You declined a signature in the wallet",
	],
	["Ceremony expired while waiting for browser wallet", "ran out of time"],
	["Owner does not match signer address", "The connected wallet is not"],
	["fetch failed", "MoB did not answer (fetch failed)"],
])("%s explains the fix", (message, fix) => {
	expect(explainCeremonyFailure(new Error(message), ctx).message).toContain(
		fix,
	);
});

test("an unknown error passes through unchanged", () => {
	const error = new Error("something new");
	expect(explainCeremonyFailure(error, ctx)).toBe(error);
});

test.each([
	[
		{ venue: "aster", status: "failed", code: "aster_deposit_required" },
		"Deposit on Aster",
	],
	[
		{ venue: "hl", status: "failed", code: "venue_busy" },
		"Hyperliquid was not bound: it has an open MoB position or order",
	],
	[
		{ venue: "lighter", status: "failed", code: "session_superseded" },
		"another binding for it replaced this one",
	],
	[
		{
			venue: "lighter-mainnet",
			status: "failed",
			code: "invalid_signing_chain",
		},
		"changed its Lighter setup",
	],
	[
		{ venue: "hl", status: "expired" },
		"did not arrive before the 10-minute binding session ended",
	],
	[
		{ venue: "hl", status: "confirming" },
		"Do not stage another binding for it",
	],
	[
		{ venue: "hl", status: "failed", code: "something_new" },
		"contact the MoB team with this code",
	],
] as const)("venue result %o explains the fix", (result, fix) => {
	expect(explainVenueResult(result, ctx)).toContain(fix);
});
