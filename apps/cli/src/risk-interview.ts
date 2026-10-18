import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const RISK_INTERVIEW_TTL_MS = 24 * 60 * 60 * 1000;

export interface RiskInterview {
	due: boolean;
	acknowledgedAt: number | null;
}

/** The first-open risk questions are due once per owner per day. */
export async function riskInterviewStatus(
	home: string,
	owner: string | undefined,
	now: number,
): Promise<RiskInterview> {
	if (!owner) return { due: true, acknowledgedAt: null };
	try {
		const raw: unknown = JSON.parse(
			await readFile(join(home, "risk-interview.json"), "utf8"),
		);
		const record = raw as { owner?: unknown; acknowledgedAt?: unknown } | null;
		if (
			record &&
			typeof record.owner === "string" &&
			record.owner.toLowerCase() === owner.toLowerCase() &&
			Number.isSafeInteger(record.acknowledgedAt) &&
			(record.acknowledgedAt as number) <= now &&
			now - (record.acknowledgedAt as number) < RISK_INTERVIEW_TTL_MS
		)
			return { due: false, acknowledgedAt: record.acknowledgedAt as number };
	} catch (error) {
		if (
			(error as NodeJS.ErrnoException).code !== "ENOENT" &&
			!(error instanceof SyntaxError)
		)
			throw error;
	}
	return { due: true, acknowledgedAt: null };
}

export async function acknowledgeRiskInterview(
	home: string,
	owner: string,
	now: number,
): Promise<void> {
	await mkdir(home, { recursive: true, mode: 0o700 });
	await writeFile(
		join(home, "risk-interview.json"),
		`${JSON.stringify({ owner, acknowledgedAt: now }, null, 2)}\n`,
		{ mode: 0o600 },
	);
}
