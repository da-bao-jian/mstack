import type { Proposal } from "@mstack/proposals";

export function showProposal(p: Proposal): string {
	return [
		p.id,
		`Status: ${p.status}`,
		`Purpose: ${p.purpose}`,
		`Owner: ${p.owner}`,
		`Route: POST ${p.submit.base}${p.submit.route}`,
		`Expires: ${new Date(p.expiresAt).toISOString()}`,
		"Message:",
		p.signing.type === "text"
			? p.signing.message
			: JSON.stringify(p.signing.typedData, null, 2),
		`Digest: ${p.digest}`,
		`Stored body: ${JSON.stringify(p.submit.body)}`,
		...(p.submit.format ? [`Submit plan: ${JSON.stringify(p.submit)}`] : []),
		...(p.preflight ? [`Preflight: ${JSON.stringify(p.preflight)}`] : []),
		...(p.answer !== undefined
			? [`Server answer: ${JSON.stringify(p.answer)}`]
			: []),
	].join("\n");
}

/** Public intent and result, without a replayable signature. Reads do not preview. */
function proposalView(p: Proposal) {
	return {
		id: p.id,
		kind: p.kind,
		status: p.status,
		owner: p.owner,
		purpose: p.purpose,
		createdAt: p.createdAt,
		expiresAt: p.expiresAt,
		digest: p.digest,
		signing: p.signing,
		submit: p.submit,
		preflight: p.preflight,
		answer: p.answer,
		error: p.error,
	};
}
export function proposalResult(p: Proposal) {
	return {
		proposal: proposalView(p),
		message: `Nothing is signed or sent until a human runs \`mob sign ${p.id}\`.`,
	};
}
