import { createHash } from "node:crypto";
import { type Proposal, validateProposal } from "./model.ts";

const hash = (text: string) => createHash("sha256").update(text).digest("hex");

/** The record checksum covers audit fields and formatting, not just signed intent. */
export function serializeRecord(p: Proposal): string {
	const bytes = `${JSON.stringify(p, null, 2)}\n`;
	return `${JSON.stringify({ ...p, recordHash: hash(bytes) }, null, 2)}\n`;
}

export function readRecord(raw: string): Proposal {
	let value: Record<string, unknown>;
	try {
		value = JSON.parse(raw);
	} catch {
		throw new Error("JSON: malformed Proposal JSON");
	}
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error("Proposal: expected an object");
	const { recordHash, ...p } = value;
	const fields = new Set([
		"version",
		"id",
		"createdAt",
		"expiresAt",
		"digest",
		"contentHash",
		"status",
		"kind",
		"owner",
		"purpose",
		"signing",
		"submit",
		"preflightPlan",
		"endedAt",
		"preflight",
		"signatureAttemptedAt",
		"signature",
		"answer",
		"error",
	]);
	for (const field of Object.keys(p))
		if (!fields.has(field))
			throw new Error(`Proposal.${JSON.stringify(field)}: unknown field`);
	// W7–W16 records have no checksum. They retain the immutable intent check;
	// every subsequent write upgrades them without changing the signing digest.
	if (recordHash !== undefined) {
		if (recordHash !== hash(`${JSON.stringify(p, null, 2)}\n`))
			throw new Error("recordHash: Proposal record integrity check failed");
		if (raw !== serializeRecord(p as unknown as Proposal))
			throw new Error("recordHash: Proposal record bytes changed");
	}
	validateProposal(p as unknown as Proposal);
	return p as unknown as Proposal;
}
