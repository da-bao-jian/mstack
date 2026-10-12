import {
	type BindingTarget,
	bindingMessage,
	preparePayload,
	readPayload,
	StrategyApiClient,
	StrategyApiError,
	type VenueBindingBatch,
} from "@mstack/mobius-api";
import { MobiusClient } from "@mstack/mobius-client";
import {
	type CeremonyProposal,
	CeremonyStore,
	digest,
} from "@mstack/proposals";
import {
	browserCeremonySigner,
	readSecretFromTty,
	type SecretReader,
	unlockKeystore,
	walletConnectCeremonySigner,
} from "@mstack/signers";
import { getAddress, type Hex } from "viem";
import pkg from "../package.json";
import {
	getConfig,
	numberFlag,
	readConfig,
	SETUP_FIRST,
	UsageError,
} from "./config.ts";
import { keysCommand } from "./keys-command.ts";
import type { Runtime } from "./run.ts";
import { stageLegal } from "./setup-command.ts";
import { walletWait } from "./wallet-wait.ts";

const allVenues = ["hl", "lighter", "aster", "lighter-mainnet"] as const;
type Venue = (typeof allVenues)[number];

function parseVenues(raw: unknown): Venue[] {
	if (raw === undefined) return [...allVenues];
	const venues = String(raw)
		.split(",")
		.map((item) => item.trim()) as Venue[];
	if (
		!venues.length ||
		new Set(venues).size !== venues.length ||
		venues.some((venue) => !allVenues.includes(venue))
	)
		throw new UsageError(
			"venues must contain 1 to 4 unique values: hl, aster, lighter, lighter-mainnet",
		);
	return venues;
}

async function alreadyBound(base: string, owner: string, rt: Runtime) {
	try {
		const value = await new MobiusClient({
			base,
			version: pkg.version,
			fetch: rt.fetch,
		}).read("/api/binding/readiness", { ownerAddress: owner });
		const rows = value.venues;
		return new Set(
			rows.flatMap((row) => {
				return row.ready === true && typeof row.venue === "string"
					? [row.venue]
					: [];
			}),
		);
	} catch {
		// The batch API remains authoritative when the legacy readiness route is absent.
		return new Set<string>();
	}
}

export async function stageCeremony(
	values: Record<string, string | boolean | undefined>,
	rt: Runtime,
	onComplete?: "stage-key",
) {
	const config = await readConfig(rt.home);
	if (!config.owner) throw new UsageError(SETUP_FIRST);
	if ((config.policy ?? "manual") !== "manual")
		throw new UsageError("Wallet policy is locked");
	const owner = getAddress(config.owner);
	const readinessBase = String(getConfig(config, "api_base"));
	const strategyBase = String(getConfig(config, "strategy_api_base"));
	const bound = await alreadyBound(readinessBase, owner, rt);
	const requested = parseVenues(values.venues);
	const venues = requested.filter((venue) => !bound.has(venue));
	if (!venues.length) {
		rt.out("Ready · all selected venues are already bound");
		return;
	}
	const lighterAccount =
		typeof values["lighter-account"] === "string"
			? numberFlag(values["lighter-account"], "lighter-account", 0, true)
			: undefined;
	const targets: BindingTarget[] = venues.map((venue) => {
		if (venue === "hl")
			return {
				venue,
				signatureChainId: Number(getConfig(config, "hl_signature_chain_id")),
				...(values.rebind === true ? { rebind: true } : {}),
			};
		if (venue === "lighter" || venue === "lighter-mainnet")
			return {
				venue,
				...(lighterAccount === undefined
					? {}
					: { accountIndex: lighterAccount }),
				...(values.rebind === true ? { rebind: true } : {}),
			};
		return { venue, ...(values.rebind === true ? { rebind: true } : {}) };
	});
	const store = new CeremonyStore(rt.home, rt.now, rt.err);
	const existing = (await store.list()).findLast(
		(ceremony) =>
			ceremony.owner === owner &&
			ceremony.apiBase === strategyBase &&
			!["complete", "partial", "rejected", "failed", "expired"].includes(
				ceremony.status,
			) &&
			JSON.stringify(ceremony.venues) === JSON.stringify(targets),
	);
	const ceremony =
		existing ??
		(await store.stage({
			owner,
			apiBase: strategyBase,
			venues: targets,
			...(onComplete ? { onComplete } : {}),
		}));
	rt.out(
		`${ceremony.id} · venue binding ceremony · ${venues.join(", ")} · ${ceremony.status}`,
	);
	rt.out(`Next: mob sign ${ceremony.id}`);
	return ceremony;
}

export async function nativeOnboard(
	values: Record<string, string | boolean | undefined>,
	rt: Runtime,
) {
	const config = await readConfig(rt.home);
	if (!config.owner) throw new UsageError(SETUP_FIRST);
	const base = String(getConfig(config, "auth_base"));
	let accepted = false;
	try {
		accepted = (
			await new MobiusClient({
				base,
				version: pkg.version,
				fetch: rt.fetch,
			}).read("/legal/acceptance", { wallet: config.owner })
		).accepted;
	} catch {
		accepted = false;
	}
	if (!accepted) {
		await stageLegal(rt);
		return;
	}
	await stageCeremony(values, rt, "stage-key");
}

function view(step: CeremonyProposal) {
	return {
		id: step.id,
		owner: step.owner,
		purpose: step.purpose,
		expiresAt: step.expiresAt,
		digest: step.digest,
		signing: step.signing,
	};
}

function showStep(step: CeremonyProposal, index: number, total: number) {
	const exact =
		step.signing.type === "text"
			? step.signing.message
			: JSON.stringify(step.signing.typedData, null, 2);
	return [
		`${step.id} · step ${index} of ${total}`,
		`Purpose  ${step.purpose}`,
		step.signing.type === "text" ? "Exact message" : "Exact typed data",
		exact,
		`Digest   ${step.digest}`,
	].join("\n");
}

type Session = {
	address(): Promise<`0x${string}`>;
	sign(step: ReturnType<typeof view>): Promise<Hex>;
	addSteps?(steps: ReturnType<typeof view>[]): void;
	close(): Promise<void>;
};

function terminalResults(batch: VenueBindingBatch) {
	return batch.results.every((result) =>
		["bound", "already_bound", "failed", "expired"].includes(result.status),
	);
}

export async function signCeremony(
	id: string,
	values: Record<string, string | boolean | undefined>,
	rt: Runtime,
	read: SecretReader = readSecretFromTty,
) {
	const store = new CeremonyStore(rt.home, rt.now, rt.err);
	let ceremony = await store.get(id);
	if (
		["complete", "partial", "rejected", "failed", "expired"].includes(
			ceremony.status,
		)
	)
		throw new UsageError(`Ceremony ${id} is ${ceremony.status}`);
	const config = await readConfig(rt.home);
	if (!config.owner || getAddress(config.owner) !== getAddress(ceremony.owner))
		throw new UsageError("Configured owner does not match ceremony owner");
	if ((config.policy ?? "manual") !== "manual")
		throw new UsageError("Wallet policy is locked");
	const backend = values.with ?? config.signer;
	if (!backend) throw new UsageError(SETUP_FIRST);
	if (!["keystore", "browser", "walletconnect"].includes(String(backend)))
		throw new UsageError(`${backend} signer is not available in this build`);
	if (backend === "walletconnect" && !config.walletconnect_project_id)
		throw new UsageError(
			"Set walletconnect_project_id before using walletconnect",
		);
	let waiting: ReturnType<typeof walletWait> | undefined;
	let session: Session;
	if (backend === "browser") {
		const browser = browserCeremonySigner(
			ceremony.id,
			ceremony.owner,
			ceremony.expiresAt,
			{
				now: rt.now,
				openUrl: rt.openUrl,
				onUrl: (url) => {
					waiting = walletWait(rt, ceremony.expiresAt);
					waiting.show(url, "browser");
				},
			},
		);
		browser.addSteps([view(ceremony.prepare)]);
		session = browser;
	} else if (backend === "walletconnect") {
		const wallet = walletConnectCeremonySigner(
			ceremony.id,
			ceremony.owner,
			ceremony.expiresAt,
			{
				projectId: config.walletconnect_project_id as string,
				now: rt.now,
				createClient: rt.walletConnectClientFactory,
				onPairing: (uri) => {
					waiting = walletWait(rt, ceremony.expiresAt);
					waiting.show(uri, "walletconnect");
				},
			},
		);
		session = wallet;
	} else {
		const signer = await unlockKeystore(rt.home, ceremony.owner, read, {
			reusable: true,
		});
		session = {
			address: signer.address,
			async sign(step) {
				return step.signing.type === "text"
					? signer.signMessage({ message: step.signing.message })
					: signer.signTypedData(step.signing.typedData);
			},
			close: async () => signer.close?.(),
		};
	}
	try {
		if (getAddress(await session.address()) !== getAddress(ceremony.owner))
			throw new Error("Owner does not match signer address");
		const client = new StrategyApiClient({
			base: ceremony.apiBase,
			version: pkg.version,
			fetch: rt.fetch,
			now: rt.now,
		});
		let card = 0;
		const sign = async (step: CeremonyProposal) => {
			if (rt.now() >= step.expiresAt)
				throw new Error("Ceremony step expired before signing");
			card++;
			rt.out(showStep(step, card, 2 + ceremony.requests.length));
			await store.update(id, (record) => {
				const stored =
					step.id === record.prepare.id
						? record.prepare
						: step.id === record.read?.id
							? record.read
							: record.requests.find((item) => item.id === step.id);
				if (!stored || stored.signatureAttemptedAt !== undefined)
					throw new Error(
						"Ceremony step is terminal or already used for signing",
					);
				stored.signatureAttemptedAt = rt.now();
			});
			try {
				const signature = await session.sign(view(step));
				await store.update(id, (record) => {
					const stored =
						step.id === record.prepare.id
							? record.prepare
							: step.id === record.read?.id
								? record.read
								: record.requests.find((item) => item.id === step.id);
					if (!stored) throw new Error("Ceremony step disappeared");
					stored.signature = signature;
					stored.status = "signed";
					if (stored.requestId)
						record.signatures.push({ requestId: stored.requestId, signature });
				});
				return signature;
			} catch (error) {
				await store.update(id, (record) => {
					const stored = record.requests.find((item) => item.id === step.id);
					if (stored) stored.status = "rejected";
				});
				throw error;
			}
		};

		let prepareSignature = ceremony.prepare.signature;
		if (!prepareSignature) {
			prepareSignature = await sign(ceremony.prepare);
			ceremony = await store.update(id, (record) => {
				record.status = "preparing";
			});
		}
		if (!ceremony.bindingId) {
			const payload = preparePayload(
				{
					owner: ceremony.owner,
					venues: ceremony.venues,
					nonce: ceremony.nonce,
					expiresAt: Math.floor(ceremony.expiresAt / 1000),
				},
				rt.now,
			);
			let prepared: VenueBindingBatch;
			try {
				prepared = await client.prepareVenueBindings(
					{
						owner: payload.owner,
						venues: payload.venues,
						authorization: {
							nonce: ceremony.nonce,
							expiresAt: Math.floor(ceremony.expiresAt / 1000),
							signature: prepareSignature,
						},
					},
					{ idempotencyKey: ceremony.prepareIdempotencyKey },
				);
			} catch (error) {
				if (
					error instanceof StrategyApiError &&
					error.code === "rebind_required"
				)
					throw new UsageError(
						"A venue requires repair. Review active tasks, then rerun with --rebind.",
					);
				throw error;
			}
			ceremony = await store.recordPrepared(id, prepared);
		}

		session.addSteps?.(ceremony.requests.map(view));
		let rejected = false;
		for (const step of ceremony.requests) {
			if (step.signature) continue;
			try {
				await sign(step);
			} catch (error) {
				if (
					!/reject/i.test(
						error instanceof Error ? error.message : String(error),
					)
				)
					throw error;
				rejected = true;
				break;
			}
		}
		ceremony = await store.get(id);
		if (!ceremony.bindingId) throw new Error("Ceremony has no binding id");
		const bindingId = ceremony.bindingId;
		if (rejected) {
			if (ceremony.signatures.length)
				await client.submitVenueBindings(
					bindingId,
					{ signatures: ceremony.signatures },
					{ idempotencyKey: ceremony.submitIdempotencyKey },
				);
			const incomplete = [
				...new Set(
					ceremony.requests
						.filter((step) => !step.signature)
						.map((step) => step.venue),
				),
			].filter(Boolean);
			await store.update(id, (record) => {
				record.status = "partial";
			});
			rt.out(`Ceremony partial · ${incomplete.join(", ")} stays incomplete`);
			return;
		}

		const readExpiresAt = Math.floor(ceremony.expiresAt / 1000);
		const readBody = readPayload(
			{ owner: ceremony.owner, bindingId, expiresAt: readExpiresAt },
			rt.now,
		);
		const readSigning = {
			type: "text" as const,
			message: bindingMessage("read", readBody),
		};
		ceremony = await store.update(id, (record) => {
			if (!record.read)
				record.read = {
					id: `${id}:read`,
					kind: "sign-text",
					owner: record.owner,
					purpose: "Authorize binding status reads",
					createdAt: rt.now(),
					expiresAt: record.expiresAt,
					digest: digest(readSigning),
					signing: readSigning,
					status: "awaiting-signature",
					submit: { type: "read-ceremony" },
				};
		});
		if (!ceremony.read) throw new Error("Ceremony read step was not stored");
		session.addSteps?.([view(ceremony.read)]);
		const readSignature =
			ceremony.read.signature ?? (await sign(ceremony.read));
		await store.update(id, (record) => {
			record.status = "submitting";
		});
		let latest = await client.submitVenueBindings(
			bindingId,
			{ signatures: (await store.get(id)).signatures },
			{ idempotencyKey: ceremony.submitIdempotencyKey },
		);
		await store.update(id, (record) => {
			record.latest = latest;
			record.status = "polling";
		});
		const pollStarted = rt.now();
		while (!terminalResults(latest) && rt.now() - pollStarted < 600_000) {
			latest = await client.getVenueBinding(bindingId, {
				owner: ceremony.owner,
				expiresAt: readExpiresAt,
				signature: readSignature,
			});
			await store.update(id, (record) => {
				record.latest = latest;
			});
			if (!terminalResults(latest)) await (rt.sleep ?? Bun.sleep)(5000);
		}
		const successful = latest.results.filter((result) =>
			["bound", "already_bound"].includes(result.status),
		);
		const failures = latest.results.filter(
			(result) => result.status === "failed",
		);
		await store.update(id, (record) => {
			record.status =
				successful.length === latest.results.length
					? "complete"
					: successful.length
						? "partial"
						: "failed";
			record.latest = latest;
		});
		for (const result of failures)
			rt.out(
				`${result.venue} failed · ${result.code ?? "unknown"} · retryable ${result.retryable ?? false}`,
			);
		rt.out(
			`${id} ${successful.length === latest.results.length ? "complete" : "partial"} · ${successful.length} venues bound`,
		);
		if (
			ceremony.onComplete === "stage-key" &&
			successful.length === latest.results.length
		)
			await keysCommand(
				["create"],
				{
					name: "mstack",
					venues: successful.map((result) => result.venue).join(","),
					"max-size": "5000",
				},
				rt,
				read,
			);
	} finally {
		waiting?.stop();
		await session.close();
	}
}
