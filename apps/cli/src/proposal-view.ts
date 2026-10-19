import {
	type Ceremony,
	type Proposal,
	publicText,
	publicValue,
} from "@mstack/proposals";
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

/** The ordered signing steps of a ceremony. */
export function ceremonySteps(ceremony: Ceremony) {
	return [
		...(ceremony.legal ? [ceremony.legal] : []),
		...(ceremony.approvals ?? []),
		...(ceremony.prepare ? [ceremony.prepare] : []),
		...ceremony.requests,
		...(ceremony.read ? [ceremony.read] : []),
		...(ceremony.key ? [ceremony.key] : []),
	];
}

export function ceremonyCard(ceremony: Ceremony, now: number): string {
	// Integrator approvals are created when signed; list the planned ones
	// in their place, after the legal step.
	const created = ceremonySteps(ceremony);
	const planned = (ceremony.integrators ?? [])
		.filter(
			(plan) => !ceremony.approvals?.some((step) => step.venue === plan.venue),
		)
		.map((plan) => ({
			status: "planned",
			purpose: `Approve the zero-fee Lighter integrator on ${plan.venue} (keeps your key)`,
		}));
	const at = ceremony.legal ? 1 : 0;
	const steps = [...created.slice(0, at), ...planned, ...created.slice(at)];
	const signable = ![
		"complete",
		"partial",
		"rejected",
		"failed",
		"expired",
	].includes(ceremony.status);
	return [
		`${ceremony.id} · ceremony · ${ceremony.status} · ${expiry(ceremony.expiresAt, now)}`,
		`Owner    ${ceremony.owner}`,
		`Venues   ${[
			...ceremony.venues.map((venue) => venue.venue),
			...(ceremony.integrators ?? []).map(
				(plan) => `${plan.venue} (integrator approval)`,
			),
		].join(", ")}`,
		...(ceremony.keyPlan
			? [
					`Key      “${ceremony.keyPlan.name}” · cap $${ceremony.keyPlan.maxSizeUsd.toLocaleString("en-US")}${ceremony.keyResult ? ` · stored ${ceremony.keyResult.prefix} in ${ceremony.keyResult.backend}` : ""}`,
				]
			: []),
		"Steps",
		...steps.map(
			(step, index) =>
				`  ${index + 1}. ${step.status === "signed" ? "✓" : "·"} ${step.purpose}`,
		),
		...(ceremony.keyPlan && !ceremony.key
			? [
					`  ${steps.length + 1}. · Create API key “${ceremony.keyPlan.name}” and store it locally`,
				]
			: []),
		...(signable ? [`Next: mob sign ${ceremony.id}`] : []),
	].join("\n");
}
