import { StrategyApiError } from "@mstack/mobius-api";
import { ApiError } from "@mstack/mobius-client";
import { UsageError } from "./config.ts";

// Every failure a binding ceremony can hit, said as what happened and what to
// do next. Codes and texts come from MoB's servers (the upstream repo
// funding-server/src/binding/apiService.ts, apiAdapters.ts, apiWorker.ts,
// server/routes/lighter.ts and apiKeys.ts, auth-server/src/legal.ts). MoB's
// own text stays at the end for diagnosis.

const names: Record<string, string> = {
	hl: "Hyperliquid",
	aster: "Aster",
	lighter: "Lighter on Robinhood Chain",
	"lighter-mainnet": "Lighter",
};
const venueName = (venue: string) => names[venue] ?? venue;
/** The venue a MoB message starts with or names, such as "hl credential …". */
function venueIn(text: string): string {
	const named = Object.keys(names).find((venue) =>
		new RegExp(`(^|[\\s"'(])${venue}(?![\\w-])`).test(text),
	);
	return named ? venueName(named) : "a venue";
}
const quote = (text: string) => ` MoB said: "${text}"`;
const cap = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

export interface FailureContext {
	/** The command that stages a fresh ceremony with the same venues. */
	restage: string;
	owner: string;
	id: string;
}

function strategy(error: StrategyApiError, ctx: FailureContext): string {
	const text = error.error ?? error.message;
	const venue = venueIn(text);
	const again = `stage a new ceremony with \`${ctx.restage}\` and sign it`;
	switch (error.code) {
		case "authorization_expired":
			return `The binding signature arrived after its 5-minute window. ${cap(again)}. Sign each step soon after the page opens.`;
		case "invalid_signature":
		case "owner_mismatch":
			return `MoB could not match the signature to ${ctx.owner}. Connect the wallet for that address, then ${again}. Smart-contract wallets are not supported.`;
		case "nonce_conflict":
			return `This ceremony's one-time number was already used for a different request. ${cap(again)}.`;
		case "rate_limited":
			return `MoB allows 20 binding preparations per wallet in 10 minutes. Wait 10 minutes, then ${again}.`;
		case "venue_account_not_found":
			return `${venue} has no account for this wallet. Create one on ${venue === "Hyperliquid" ? "Hyperliquid (deposit funds at app.hyperliquid.xyz)" : venue.startsWith("Lighter") ? "Lighter (app.lighter.xyz; Robinhood Chain and canonical Lighter are separate accounts)" : `${venue}'s website`}, or leave the venue out, then ${again}.`;
		case "account_not_owned":
			return `The Lighter account index does not belong to ${ctx.owner}. Stage again without --lighter-account to use the wallet's main account.`;
		case "venue_account_check_unavailable":
			return `MoB could not reach ${venue} to check the account. This does not mean the account is missing. Wait a minute, then ${again}.`;
		case "rebind_required":
			return `${venue} already has a MoB key that is not usable. Stage again with --rebind to replace it; an open position on that venue blocks the rebind.`;
		case "venue_busy":
			return `${venue} has an open MoB position or order, so its key cannot be replaced now. Close the position (\`mob close\`) or wait for the order to finish, then ${again}.`;
		case "binding_in_progress":
			return `${venue} already has a binding in progress, from another session or the MoB app. Finish it there, or wait 10 minutes for it to expire, then ${again}.`;
		case "binding_expired":
		case "binding_terminal":
			return `This binding session is over (sessions last 10 minutes). ${cap(again)}.`;
		case "signature_conflict":
		case "idempotency_conflict":
			return `MoB already holds signatures for this binding. Run \`mob doctor\` to see which venues are bound; stage again only for venues that are not.`;
		case "binding_not_found":
			return `MoB has no such binding for ${ctx.owner}. ${cap(again)}.`;
		case "invalid_account":
			return "MoB needs a Lighter account index this version of mob did not send. Upgrade mob with the install line, then stage again.";
		case "service_busy":
		case "service_unavailable":
		case "binding_unavailable":
			return `MoB could not complete the request right now. Wait a minute, then run \`mob sign ${ctx.id}\` again; if the ceremony has expired, ${again}.`;
		default:
			return error.status >= 500
				? `MoB is temporarily unavailable (HTTP ${error.status}). Wait a minute, then ${again}.`
				: `MoB refused the binding request (HTTP ${error.status}${error.code ? `, ${error.code}` : ""}). ${cap(again)}.`;
	}
}

function funding(error: ApiError, ctx: FailureContext): string {
	const data = error.data;
	const text =
		data && typeof data === "object" && "error" in data
			? String((data as { error: unknown }).error)
			: error.message;
	const again = `run \`${ctx.restage}\` again and sign the new ceremony`;
	// Integrator approval (funding-server routes/lighter.ts).
	if (text === "timestamp expired or invalid")
		return `The integrator approval was signed more than 5 minutes before MoB received it. ${cap(again)}. Sign the approval soon after the page opens.`;
	if (text === "nonce already used")
		return `MoB already used this one-time approval. Run \`mob doctor\`; if Lighter still shows integrator_approval_missing, ${again}.`;
	if (text === "signature does not match ownerAddress")
		return `The approval was signed by a different wallet. Connect the wallet for ${ctx.owner}, then ${again}.`;
	if (text === "integrator is not configured")
		return "MoB has no integrator on this Lighter deployment, so there is nothing to approve. Run `mob doctor` to confirm the venue is ready.";
	// API key creation (funding-server routes/apiKeys.ts).
	if (/at most 10 active API keys/.test(text))
		return "This wallet already has 10 active MoB API keys. Revoke an unused one with `mob keys revoke <id>` (see `mob keys list`), then create the key again.";
	if (text === "Venue binding check is temporarily unavailable. Try again.")
		return "MoB could not confirm that every venue for the key is usable. For Hyperliquid this means the wallet has not deposited: deposit USDC on Hyperliquid (app.hyperliquid.xyz, from Arbitrum). Then run `mob doctor`; when every venue shows ready, create the key again.";
	if (text === "Bind the selected venues before creating an API key.")
		return "A venue for the key is not bound yet. Run `mob doctor`, bind the venue, then create the key again.";
	if (text === "Valid wallet signature required.")
		return "MoB did not accept the key signature: it was signed by a different wallet or more than 5 minutes earlier. Create the key again and sign it promptly.";
	if (text === "This signed request has already been used.")
		return "MoB already used this signed key request. Create the key again to sign a new one.";
	// Legal acceptance (auth-server legal.ts).
	if (text === "stale legal terms version")
		return `The legal terms changed while you signed. ${cap(again)}.`;
	if (text === "Signature timestamp outside acceptance window")
		return "Your computer clock is more than 10 minutes off. Correct the clock, then sign again.";
	if (text === "legal clickwrap not configured")
		return "MoB's legal service is not configured. Contact the MoB team; nothing was signed.";
	if (error.status >= 500)
		return `MoB is temporarily unavailable (HTTP ${error.status}). Wait a minute, then ${again}.`;
	return `MoB refused the request (HTTP ${error.status}). ${cap(again)}.`;
}

/** A failed ceremony as one message: what happened, then what to do. */
export function explainCeremonyFailure(
	error: unknown,
	ctx: FailureContext,
): Error {
	if (error instanceof UsageError) return error;
	const text = error instanceof Error ? error.message : String(error);
	if (error instanceof StrategyApiError)
		return new UsageError(
			`${cap(strategy(error, ctx))}${error.error ? quote(error.error) : ""}`,
		);
	if (error instanceof ApiError) {
		const data = error.data;
		const said =
			data && typeof data === "object" && "error" in data
				? String((data as { error: unknown }).error)
				: "";
		return new UsageError(`${funding(error, ctx)}${said ? quote(said) : ""}`);
	}
	if (/rejected/i.test(text))
		return new UsageError(
			`You declined a signature in the wallet, so the session stopped and nothing more was signed or sent. To try again, run \`${ctx.restage}\`.`,
		);
	if (/expired/i.test(text))
		return new UsageError(
			`The wallet session ran out of time before every step was signed. Run \`${ctx.restage}\`, keep the wallet open, and sign each step as soon as the page shows it.`,
		);
	if (/Owner does not match signer/.test(text))
		return new UsageError(
			`The connected wallet is not ${ctx.owner}. Switch the wallet to that account, then run \`mob sign ${ctx.id}\` again.`,
		);
	if (
		/fetch failed|ECONNREFUSED|ECONNRESET|ENOTFOUND|timed out|TimeoutError|aborted/i.test(
			text,
		)
	)
		return new UsageError(
			`MoB did not answer (${text}). Check your internet connection, then run \`mob sign ${ctx.id}\` again; if the ceremony has expired, run \`${ctx.restage}\`.`,
		);
	return error instanceof Error ? error : new Error(text);
}

/** A venue whose binding did not finish, with the next step. */
export function explainVenueResult(
	result: { venue: string; status: string; code?: string },
	ctx: FailureContext,
): string {
	const venue = venueName(result.venue);
	const again = `stage it again with \`${ctx.restage}\``;
	switch (result.code) {
		case "venue_busy":
			return `${venue} was not bound: it has an open MoB position or order. Close it or wait for it to finish, then ${again}.`;
		case "session_superseded":
			return `${venue} was not bound: another binding for it replaced this one, for example in the MoB app. Run \`mob doctor\`; if it is not ready, ${again}.`;
		case "aster_deposit_required":
			return `${venue} was not bound: Aster accepts an agent only after this wallet has deposited. Deposit on Aster, then ${again}.`;
		case "aster_agent_not_found":
			return `${venue} was not bound: Aster did not register the agent. ${cap(again)}.`;
		case "invalid_signing_chain":
		case "deployment_changed":
			return `${venue} was not bound: MoB changed its Lighter setup after this ceremony was prepared. ${cap(again)}.`;
		default:
			break;
	}
	if (result.status === "expired")
		return `${venue} was not bound: its signatures did not arrive before the 10-minute binding session ended. ${cap(again)}.`;
	if (result.status === "failed")
		return `${venue} was not bound${result.code ? ` (${result.code})` : ""}. ${cap(again)}; if it fails again, contact the MoB team with this code.`;
	return `${venue} is still being confirmed by MoB after 10 minutes. Do not stage another binding for it; run \`mob doctor\` in a few minutes to see the result.`;
}
