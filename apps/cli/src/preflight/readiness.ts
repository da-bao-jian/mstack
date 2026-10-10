import type {
	ArbitrageVenue,
	ArbitrageVenueReadinessItem,
	ReadRoutes,
} from "@mstack/mobius-client";
import type { ReadCheck } from "@mstack/proposals";
import { Checks, type Reader } from "./checks.ts";

export const executionVenues = [
	"hl",
	"aster",
	"lighter",
	"lighter-mainnet",
] as const;
type Credential =
	| ReadRoutes["/api/binding/hl/credential"]["result"]
	| ReadRoutes["/api/binding/aster/credential"]["result"]
	| ReadRoutes["/api/binding/lighter/credential"]["result"];

function credentialReadiness(
	venue: ArbitrageVenue,
	credential: Credential,
	now: number,
): ArbitrageVenueReadinessItem {
	if (!credential.bound)
		return {
			venue,
			ready: false,
			issue:
				"issue" in credential && credential.issue === "key_invalid"
					? "key_invalid"
					: "repair" in credential && credential.repair
						? "builder_fee_missing"
						: "not_bound",
		};
	if (venue === "hl" || venue === "aster")
		return "builderApproved" in credential && credential.builderApproved
			? { venue, ready: true }
			: { venue, ready: false, issue: "builder_fee_missing" };
	if (
		venue === "lighter-mainnet" &&
		(!("integratorApproved" in credential) ||
			!credential.integratorApproved ||
			typeof credential.integratorApprovalExpiresAt !== "number" ||
			!Number.isFinite(credential.integratorApprovalExpiresAt) ||
			credential.integratorApprovalExpiresAt <= now + 86_400_000)
	)
		return { venue, ready: false, issue: "integrator_approval_missing" };
	return { venue, ready: true };
}

export async function checkReadiness(
	venue: ArbitrageVenue,
	owner: string,
	reader: Reader,
	checks: Checks,
): Promise<void> {
	const route =
		venue === "hl"
			? "/api/binding/hl/credential"
			: venue === "aster"
				? "/api/binding/aster/credential"
				: "/api/binding/lighter/credential";
	const params =
		route === "/api/binding/lighter/credential"
			? { ownerAddress: owner, venue: venue as "lighter" | "lighter-mainnet" }
			: { ownerAddress: owner };
	const name = `readiness.${venue}`;
	let credential: Credential;
	try {
		credential = await reader.read(route, params);
	} catch (error) {
		checks.fail(route, name, error);
	}
	const status = credentialReadiness(venue, credential, checks.now());
	if (!status.ready)
		checks.fail(route, name, new Error(`${venue}: ${status.issue}`));
	const assertions: ReadCheck["assertions"] = [
		{ path: ["bound"], equals: true },
	];
	if (venue === "hl" || venue === "aster")
		assertions.push({ path: ["builderApproved"], equals: true });
	if (venue === "lighter-mainnet")
		assertions.push(
			{ path: ["integratorApproved"], equals: true },
			{ path: ["integratorApprovalExpiresAt"], remainingMs: 86_400_000 },
		);
	checks.recordRead({ route, name, params, assertions });
	await checks.read(
		{
			route: "/api/binding/rebind-check",
			name: `rebind-check.${venue}`,
			params: { ownerAddress: owner, venue },
			assertions: [{ path: ["allowed"], equals: true }],
		},
		reader,
	);
}

export async function bindingReadiness(
	owner: string,
	reader: Reader,
	now: () => number,
) {
	return Promise.all(
		executionVenues.map(async (venue) => {
			const checks = new Checks(now);
			try {
				await checkReadiness(venue, owner, reader, checks);
				return { venue, ready: true };
			} catch {
				const error = checks.checks.at(-1)?.error;
				const issue =
					(
						[
							"not_bound",
							"key_invalid",
							"builder_fee_missing",
							"integrator_approval_missing",
						] as const
					).find((issue) => error?.endsWith(`: ${issue}`)) ?? "unavailable";
				return {
					venue,
					ready: false,
					issue,
					error,
					check: checks.checks.at(-1)?.name,
				};
			}
		}),
	);
}
