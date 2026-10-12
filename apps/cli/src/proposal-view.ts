import { type Proposal, publicText, publicValue } from "@mstack/proposals";
import { expiry, paint, relative, type Terminal } from "./format.ts";
import { clean } from "./render.ts";

export function proposalTiming(p: Proposal, now: number): string {
	if (
		["rejected", "submitted", "confirmed", "signed", "failed"].includes(
			p.status,
		)
	)
		return `${p.status} ${p.endedAt === undefined ? "(time not recorded)" : relative(p.endedAt, now)}`;
	return expiry(p.expiresAt, now);
}

export function showProposal(
	p: Proposal,
	now = Date.now(),
	terminal: Terminal = {},
): string {
	const statement =
		p.signing.type === "typed"
			? p.signing.typedData.message?.statement
			: undefined;
	const message =
		p.signing.type === "text"
			? p.signing.message
			: p.signing.type === "typed"
				? JSON.stringify(p.signing.typedData, null, 2)
				: JSON.stringify(p.submit.body, null, 2);
	const box = [
		`┌─ ${p.signing.type === "text" ? "Message" : p.signing.type === "none" ? "Exact JSON body" : "Exact data"}`,
		...message.split("\n").map((line) => `│ ${clean(line)}`),
		"└─",
	].join("\n");
	const next =
		p.status === "awaiting-submission"
			? `mob submit ${p.id}`
			: p.status === "awaiting-signature"
				? `mob sign ${p.id}`
				: p.status === "staged" || p.status === "previewed"
					? `mob preview ${p.id}`
					: p.status === "interrupted" || p.status === "expired"
						? `mob reject ${p.id}`
						: "mob status";
	return [
		paint(`${p.id} · ${p.purpose}`, "bold", terminal),
		...(typeof statement === "string" ? [clean(statement)] : []),
		`Status: ${p.status}`,
		`Kind: ${p.kind === "api-submit" ? "api" : "wallet"}`,
		`Route: POST ${p.submit.base}${p.submit.route}`,
		`Owner: ${p.owner.slice(0, 6)}…${p.owner.slice(-4)}`,
		p.owner,
		...([
			"staged",
			"previewed",
			"awaiting-signature",
			"awaiting-submission",
			"interrupted",
			"expired",
		].includes(p.status)
			? [`Expiry: ${proposalTiming(p, now).replace(/^expires /, "")}`]
			: [`Ended: ${proposalTiming(p, now)}`]),
		...(p.preflight
			? p.preflight.checks.map((check) =>
					paint(
						`${check.ok ? "✓" : "✗"} ${check.name ?? check.route}: ${clean(check.error ?? check.detail ?? "Passed the stored assertions")}`,
						check.ok ? "success" : "danger",
						terminal,
					),
				)
			: ["Preflight: not checked"]),
		box,
		...(p.kind === "api-submit" ? [] : [`Digest: ${p.digest}`]),
		...(p.error ? [`Issue: ${clean(publicText(p.error))}`] : []),
		paint(`Next: ${next}`, "sky", terminal),
	].join("\n");
}

/** Public intent and result, without a replayable signature. Reads do not preview. */
export function proposalView(p: Proposal) {
	return {
		id: p.id,
		kind: p.kind,
		status: p.status,
		owner: p.owner,
		purpose: p.purpose,
		createdAt: p.createdAt,
		expiresAt: p.expiresAt,
		endedAt: p.endedAt,
		digest: p.digest,
		signing: p.signing,
		submit: p.submit,
		preflight: p.preflight,
		answer: publicValue(p.answer),
		error: p.error === undefined ? undefined : publicText(p.error),
	};
}
export function proposalResult(p: Proposal) {
	return {
		proposal: proposalView(p),
		message:
			p.kind === "api-submit"
				? `Nothing is sent until \`mob submit ${p.id}\` runs under the configured policy.`
				: `Nothing is signed or sent until a human runs \`mob sign ${p.id}\`.`,
	};
}
