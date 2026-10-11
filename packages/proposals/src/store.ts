import { lstat, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { ApiError } from "@mstack/mobius-client";
import type { Signer } from "@mstack/signers";
import {
	type Address,
	getAddress,
	type Hex,
	recoverMessageAddress,
	recoverTypedDataAddress,
} from "viem";
import {
	canonical,
	contentHash,
	digest,
	type Json,
	type JsonObject,
	type PreflightResult,
	type Proposal,
	type ProposalInput,
	validateInput,
	validateProposal,
} from "./model.ts";
import { atomic, exclusive, locked, readPrivate } from "./storage.ts";
export class ProposalStore {
	readonly directory: string;
	constructor(
		home: string,
		readonly now = Date.now,
		readonly log: (message: string) => void = console.error,
	) {
		this.directory = join(home, "proposals");
	}
	private path(id: string) {
		if (!/^p-[1-9]\d*$/.test(id)) throw new Error("Invalid Proposal id");
		return join(this.directory, `${id}.json`);
	}
	private async ready() {
		await mkdir(this.directory, { recursive: true, mode: 0o700 });
	}
	private async save(p: Proposal) {
		validateProposal(p);
		await atomic(this.path(p.id), `${JSON.stringify(p, null, 2)}\n`);
	}
	private async claimed(id: string) {
		try {
			await lstat(join(this.directory, `${id}.signature-used`));
			return true;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
			throw error;
		}
	}
	async get(id: string): Promise<Proposal> {
		let raw: string;
		try {
			raw = await readPrivate(this.path(id));
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT")
				throw new Error(`No Proposal ${id}`);
			throw error;
		}
		const p = JSON.parse(raw) as Proposal;
		validateProposal(p);
		if (p.id !== id) throw new Error("Proposal id mismatch");
		if (
			(await readPrivate(join(this.directory, `${id}.intent`))).trim() !==
			p.contentHash
		)
			throw new Error("Proposal intent was changed after staging");
		if (p.status !== "rejected" && !p.signature && (await this.claimed(id)))
			p.status = "interrupted";
		else if (
			["staged", "previewed", "awaiting-signature"].includes(p.status) &&
			this.now() >= p.expiresAt
		)
			p.status = "expired";
		return p;
	}
	private lock<T>(
		path: string,
		fn: () => Promise<T>,
		action: "write" | "reject" = "write",
	) {
		return locked(path, fn, this.log, action);
	}
	async assertSignable(id: string): Promise<Proposal> {
		const p = await this.get(id);
		await this.editable(p);
		return p;
	}
	async list(): Promise<Proposal[]> {
		await this.ready();
		const files = await readdir(this.directory);
		const result: Proposal[] = [];
		for (const file of files.filter((f) => /^p-[1-9]\d*\.json$/.test(f)))
			result.push(await this.get(file.slice(0, -5)));
		return result.sort((a, b) => Number(a.id.slice(2)) - Number(b.id.slice(2)));
	}
	async stage(input: ProposalInput): Promise<Proposal> {
		validateInput(input);
		const fixed = JSON.parse(canonical(input)) as ProposalInput;
		await this.ready();
		return this.lock(join(this.directory, "counter.lock"), async () => {
			let previous = 0;
			try {
				const raw = await readPrivate(join(this.directory, "counter"));
				if (!/^\d+\n$/.test(raw)) throw new Error("Invalid Proposal counter");
				previous = Number(raw.trim());
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			}
			if (
				!Number.isSafeInteger(previous) ||
				previous < 0 ||
				previous >= Number.MAX_SAFE_INTEGER
			)
				throw new Error("Invalid Proposal counter");
			const id = `p-${previous + 1}`;
			const now = this.now();
			// Anchor expiry to the staged request's timestamp. Crossing a second
			// while saving must neither refresh the request nor extend its window.
			const timestamp = fixed.submit.body.timestamp;
			const createdAt =
				timestamp === undefined
					? Math.floor(now / 1000) * 1000
					: Number(timestamp) * 1000;
			if (
				(timestamp !== undefined &&
					(typeof timestamp !== "number" ||
						!Number.isSafeInteger(timestamp))) ||
				!Number.isSafeInteger(createdAt) ||
				createdAt > now ||
				now >= createdAt + 300_000
			)
				throw new Error("Request timestamp is expired or in the future");
			const partial = {
				...fixed,
				id,
				createdAt,
				expiresAt: createdAt + 300_000,
				digest: digest(fixed.signing),
			};
			const p: Proposal = {
				...partial,
				version: 1,
				status: "staged",
				contentHash: contentHash(partial),
			};
			validateProposal(p);
			await atomic(join(this.directory, "counter"), `${previous + 1}\n`);
			await exclusive(
				join(this.directory, `${id}.intent`),
				`${p.contentHash}\n`,
			);
			await exclusive(this.path(id), `${JSON.stringify(p, null, 2)}\n`);
			return p;
		});
	}
	private async editable(p: Proposal): Promise<void> {
		if (p.status === "expired")
			throw new Error("Proposal expired; stage a new Proposal");
		if (
			(await this.claimed(p.id)) ||
			p.signatureAttemptedAt !== undefined ||
			!["staged", "previewed", "awaiting-signature"].includes(p.status)
		)
			throw new Error("Proposal is terminal or already used for signing");
		if (this.now() >= p.expiresAt) {
			p.status = "expired";
			await this.save(p);
			throw new Error("Proposal expired; stage a new Proposal");
		}
	}
	async preview(
		id: string,
		preflight: (p: Proposal) => Promise<PreflightResult>,
	): Promise<Proposal> {
		return this.lock(`${this.path(id)}.lock`, async () => {
			const p = await this.get(id);
			await this.editable(p);
			p.preflight = await preflight(structuredClone(p));
			await this.editable(p);
			if (!p.preflight.ok) {
				p.status = "rejected";
				p.endedAt = this.now();
				await this.save(p);
				return p;
			}
			p.status = "previewed";
			await this.save(p);
			p.status = "awaiting-signature";
			await this.save(p);
			return p;
		});
	}
	async reject(id: string): Promise<Proposal> {
		await this.get(id);
		return this.lock(
			`${this.path(id)}.lock`,
			async () => {
				const p = await this.get(id);
				if (p.signature || ["submitted", "confirmed"].includes(p.status))
					throw new Error(
						"Proposal already signed; check mob status for its result",
					);
				if (p.status === "rejected") return p;
				p.status = "rejected";
				p.endedAt = this.now();
				await this.save(p);
				return p;
			},
			"reject",
		);
	}
	async sign(
		id: string,
		options: {
			signal?: AbortSignal;
			policy: "locked" | "manual";
			owner: Address;
			connect: (proposal: Proposal) => Promise<Signer>;
			display: (p: Proposal) => void;
			submit: (p: Proposal, body: JsonObject) => Promise<Json>;
		},
	): Promise<Proposal> {
		await this.assertSignable(id);
		return this.lock(`${this.path(id)}.lock`, async () => {
			const p = await this.get(id);
			await this.editable(p);
			if (options.policy !== "manual")
				throw new Error("Wallet policy is locked");
			if (getAddress(options.owner) !== getAddress(p.owner))
				throw new Error("Configured owner does not match Proposal owner");
			if (p.status !== "awaiting-signature" || !p.preflight?.ok)
				throw new Error("Run mob preview before signing");
			options.display(structuredClone(p));
			options.signal?.throwIfAborted();
			const signer = await cancellable(
				options.connect(structuredClone(p)),
				options.signal,
			);
			options.signal?.throwIfAborted();
			if (
				getAddress(await cancellable(signer.address(), options.signal)) !==
				getAddress(options.owner)
			)
				throw new Error("Owner does not match signer address");
			await this.editable(p); // The TTY may have waited past expiry.
			options.signal?.throwIfAborted();
			// This marker is durable BEFORE touching the signer, and is never deleted.
			// Even a crash or failure cannot permit a second signing attempt.
			await exclusive(
				join(this.directory, `${id}.signature-used`),
				`${p.contentHash}\n`,
			);
			p.signatureAttemptedAt = this.now();
			await this.save(p);
			try {
				options.signal?.throwIfAborted();
				if (this.now() >= p.expiresAt) {
					p.status = "expired";
					throw new Error("Proposal expired before signing");
				}
				const signature: Hex = await cancellable(
					p.signing.type === "text"
						? signer.signMessage({ message: p.signing.message })
						: signer.signTypedData(structuredClone(p.signing.typedData)),
					options.signal,
				);
				options.signal?.throwIfAborted();
				if (this.now() >= p.expiresAt) {
					p.status = "expired";
					throw new Error(
						"Proposal expired while signing; signature will not be submitted",
					);
				}
				const recovered =
					p.signing.type === "text"
						? await recoverMessageAddress({
								message: p.signing.message,
								signature,
							})
						: await recoverTypedDataAddress({
								...p.signing.typedData,
								signature,
							});
				if (getAddress(recovered) !== getAddress(p.owner))
					throw new Error("Signature does not recover Proposal owner");
				p.signature = signature;
				p.status = "signed";
				p.endedAt = this.now();
				await this.save(p);
				if (this.now() >= p.expiresAt) {
					p.status = "expired";
					throw new Error("Proposal expired before submission");
				}
				p.status = "submitted";
				options.signal?.throwIfAborted();
				p.endedAt = this.now();
				await this.save(p);
				// A copy of the persisted body plus its signature; no prices/nonces refreshed.
				p.answer = await options.submit(structuredClone(p), {
					...structuredClone(p.submit.body),
					[p.submit.signatureField]: signature,
				});
				canonical(p.answer);
				await this.save(p);
				return p;
			} catch (error) {
				if (p.status !== "expired") p.status = "failed";
				p.endedAt = this.now();
				p.error = error instanceof Error ? error.message : String(error);
				if (error instanceof ApiError)
					p.answer = JSON.parse(JSON.stringify(error.data)) as Json;
				await this.save(p);
				throw error;
			}
		});
	}
}

async function cancellable<T>(
	operation: Promise<T>,
	signal?: AbortSignal,
): Promise<T> {
	if (!signal) return operation;
	let cancel: () => void = () => {};
	try {
		return await Promise.race([
			operation,
			new Promise<never>((_, reject) => {
				cancel = () => reject(signal.reason);
				signal.addEventListener("abort", cancel, { once: true });
				if (signal.aborted) cancel();
			}),
		]);
	} finally {
		signal.removeEventListener("abort", cancel);
	}
}
