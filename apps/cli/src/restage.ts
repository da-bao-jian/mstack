import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type Proposal, ProposalStore } from "@mstack/proposals";
import { UsageError } from "./config.ts";
import { showProposal } from "./proposal-view.ts";
import type { Runtime } from "./run.ts";

interface StagedRequest {
	command: string;
	args: string[];
	values: Record<string, string | boolean>;
}

function requestPath(home: string, id: string): string {
	if (!/^p-[1-9]\d*$/.test(id)) throw new Error("Invalid Proposal id");
	return join(home, "proposals", `${id}.request.json`);
}

/** Records the public command that staged a task Proposal. */
export async function writeRequest(
	home: string,
	id: string,
	request: {
		command: string;
		args: string[];
		values: Record<string, string | boolean | undefined>;
	},
): Promise<void> {
	const values = Object.fromEntries(
		Object.entries(request.values).filter(([, value]) => value !== undefined),
	) as Record<string, string | boolean>;
	await mkdir(join(home, "proposals"), { recursive: true, mode: 0o700 });
	await writeFile(
		requestPath(home, id),
		`${JSON.stringify({ command: request.command, args: request.args, values }, null, 2)}\n`,
		{ mode: 0o600 },
	);
}

async function readRequest(
	home: string,
	id: string,
): Promise<StagedRequest | null> {
	let raw: string;
	try {
		raw = await readFile(requestPath(home, id), "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
	const parsed: unknown = JSON.parse(raw);
	const record = parsed as Partial<StagedRequest> | null;
	if (
		!record ||
		typeof record !== "object" ||
		typeof record.command !== "string" ||
		!Array.isArray(record.args) ||
		!record.args.every((item) => typeof item === "string") ||
		!record.values ||
		typeof record.values !== "object" ||
		Object.values(record.values).some(
			(value) => typeof value !== "string" && typeof value !== "boolean",
		)
	)
		throw new Error(`Invalid staged request record for ${id}`);
	return record as StagedRequest;
}

/**
 * Stages the same intent again under a new id, with a fresh preflight. The new
 * id always needs new consent; this never signs or submits.
 */
export async function restageProposal(
	id: string,
	rt: Runtime,
): Promise<Proposal | null> {
	const store = new ProposalStore(rt.home, rt.now, rt.err);
	const previous = await store.get(id);
	if (previous.status !== "expired")
		throw new UsageError(
			`${id} is ${previous.status}; only an expired Proposal can be restaged`,
		);
	const request = await readRequest(rt.home, id);
	if (!request) return null;
	const { stagePosition } = await import("./positions.ts");
	const fresh = await stagePosition(
		request.command,
		request.args,
		request.values,
		rt,
	);
	rt.out(showProposal(fresh, rt.now(), rt));
	if (!fresh.preflight?.ok)
		throw new Error(`Preflight rejected the restaged Proposal ${fresh.id}`);
	rt.out(
		`${id} expired; staged ${fresh.id} with the same intent. Name ${fresh.id} to authorize: ${
			fresh.kind === "api-submit"
				? `mob submit ${fresh.id}`
				: `mob sign ${fresh.id}`
		}.`,
	);
	return fresh;
}
