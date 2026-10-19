import { redactKey } from "@mstack/keys";
import {
	type BindingTarget,
	bindingMessage,
	preparePayload,
	readPayload,
	StrategyApiClient,
	type VenueBindingBatch,
} from "@mstack/mobius-api";
import {
	type ApiKeyCreateBody,
	type ArbitrageVenue,
	apiKeyMessage,
	lighterIntegratorApprovalMessage,
	MobiusClient,
	type WriteRoutes,
} from "@mstack/mobius-client";
import {
	type Ceremony,
	type CeremonyProposal,
	CeremonyStore,
	ceremonyFingerprint,
	ceremonyStep,
	digest,
	type Json,
	type JsonObject,
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
	explainCeremonyFailure,
	explainVenueResult,
	type FailureContext,
} from "./binding-errors.ts";
import {
	chooseSigner,
	getConfig,
	numberFlag,
	readConfig,
	SETUP_FIRST,
	UsageError,
} from "./config.ts";
import { storeCreatedKey } from "./key-create.ts";
import { cliKeyStore, requireWritableKeyStore } from "./key-store.ts";
import { keysCommand } from "./keys-command.ts";
import type { Runtime } from "./run.ts";
import { type LegalPlan, legalPlan, stageLegal } from "./setup-command.ts";
import { venueAccounts } from "./venue-accounts.ts";
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

// Readiness reasons that mean MoB holds a key it cannot use for the venue.
// Prepare refuses such a venue with rebind_required unless the request asks
// to rebind it (mobius@0e3ff530 api-server/venue-bindings.md, "Prepare").
// A Lighter key that lacks only its integrator approval stays: the ceremony
// signs the approval instead.
const unusableKey: Record<string, string> = {
	key_invalid: "has a MoB key that no longer works",
	builder_fee_missing: "has a MoB key without its builder fee approval",
};

type LighterVenue = "lighter" | "lighter-mainnet";

/** MoB's integrator for a bound Lighter key; the approval message names it. */
async function integratorIndex(
	base: string,
	owner: string,
	venue: LighterVenue,
	rt: Runtime,
): Promise<number> {
	const credential = await new MobiusClient({
		base,
		version: pkg.version,
		fetch: rt.fetch,
	}).read("/api/binding/lighter/credential", { ownerAddress: owner, venue });
	if (
		!credential.bound ||
		credential.chainId !== (venue === "lighter-mainnet" ? 304 : 466324) ||
		typeof credential.integratorIndex !== "number" ||
		!Number.isSafeInteger(credential.integratorIndex) ||
		credential.integratorIndex <= 0
	)
		throw new Error(
			`${venue}: MoB reports no bound key with an integrator to approve`,
		);
	return credential.integratorIndex;
}

async function venueReadiness(base: string, owner: string, rt: Runtime) {
	try {
		const value = await new MobiusClient({
			base,
			version: pkg.version,
			fetch: rt.fetch,
		}).read("/api/binding/readiness", { ownerAddress: owner });
		return new Map(
			value.venues.flatMap((row) =>
				typeof row.venue === "string"
					? [[row.venue, { ready: row.ready === true, issue: row.issue }]]
					: [],
			),
		);
	} catch {
		// The batch API remains authoritative when the legacy readiness route is absent.
		return new Map<string, { ready: boolean; issue?: string }>();
	}
}

interface CeremonyExtras {
	/** Legal acceptance signed first, in the same wallet session. */
	legal?: LegalPlan;
	/** A scoped key created and stored once every venue is bound. */
	keyPlan?: { name: string; maxSizeUsd: number };
}

export async function stageCeremony(
	values: Record<string, string | boolean | undefined>,
	rt: Runtime,
	onComplete?: "stage-key",
	extras: CeremonyExtras = {},
) {
	const config = await readConfig(rt.home);
	if (!config.owner) throw new UsageError(SETUP_FIRST);
	if ((config.policy ?? "manual") !== "manual")
		throw new UsageError("Wallet policy is locked");
	const owner = getAddress(config.owner);
	const readinessBase = String(getConfig(config, "api_base"));
	const strategyBase = String(getConfig(config, "strategy_api_base"));
	const readiness = await venueReadiness(readinessBase, owner, rt);
	const requested = parseVenues(values.venues);
	const ready = requested.filter((venue) => readiness.get(venue)?.ready);
	const venues = requested.filter((venue) => !readiness.get(venue)?.ready);
	if (!venues.length) {
		rt.out("Ready · all selected venues are already bound");
		return;
	}
	const approve = venues.filter(
		(venue): venue is LighterVenue =>
			(venue === "lighter" || venue === "lighter-mainnet") &&
			readiness.get(venue)?.issue === "integrator_approval_missing",
	);
	const bind = venues.filter(
		(venue) => !approve.some((item) => item === venue),
	);
	const unusable = bind.flatMap((venue) => {
		const issue = readiness.get(venue)?.issue;
		return issue && unusableKey[issue]
			? [`${venue} ${unusableKey[issue]} (${issue})`]
			: [];
	});
	if (unusable.length && values.rebind !== true)
		throw new UsageError(
			`${unusable.join("; ")}. MoB replaces such a key only when asked: run this again with --rebind to bind a new one. Nothing was staged.`,
		);
	const lighterAccount =
		typeof values["lighter-account"] === "string"
			? numberFlag(values["lighter-account"], "lighter-account", 0, true)
			: undefined;
	const accounts = await venueAccounts(owner, bind, rt, lighterAccount);
	const integrators = await Promise.all(
		approve.map(async (venue) => ({
			venue,
			integratorIndex: await integratorIndex(readinessBase, owner, venue, rt),
		})),
	);
	const targets: BindingTarget[] = bind.map((venue) => {
		if (venue === "hl")
			return {
				venue,
				signatureChainId: Number(getConfig(config, "hl_signature_chain_id")),
				...(values.rebind === true ? { rebind: true } : {}),
			};
		if (venue === "lighter" || venue === "lighter-mainnet")
			return {
				venue,
				accountIndex: accounts.get(venue) as number,
				...(values.rebind === true ? { rebind: true } : {}),
			};
		return { venue, ...(values.rebind === true ? { rebind: true } : {}) };
	});
	const store = new CeremonyStore(rt.home, rt.now, rt.err);
	const existing = (await store.list()).findLast(
		(ceremony) =>
			ceremony.owner === owner &&
			ceremony.apiBase === strategyBase &&
			// A nearly expired ceremony would leave too little time to sign.
			ceremony.expiresAt - rt.now() > 120_000 &&
			!["complete", "partial", "rejected", "failed", "expired"].includes(
				ceremony.status,
			) &&
			JSON.stringify(ceremony.venues) === JSON.stringify(targets) &&
			JSON.stringify(ceremony.integrators ?? []) ===
				JSON.stringify(integrators) &&
			JSON.stringify(ceremony.ready ?? []) === JSON.stringify(ready) &&
			Boolean(ceremony.legal) === Boolean(extras.legal) &&
			JSON.stringify(ceremony.keyPlan ?? null) ===
				JSON.stringify(extras.keyPlan ?? null),
	);
	const ceremony =
		existing ??
		(await store.stage({
			owner,
			apiBase: strategyBase,
			venues: targets,
			...(onComplete ? { onComplete } : {}),
			...(extras.legal
				? {
						legal: {
							signing: extras.legal.signing,
							base: extras.legal.base,
							body: extras.legal.body,
						},
					}
				: {}),
			...(extras.keyPlan ? { keyPlan: extras.keyPlan } : {}),
			ready,
			integrators,
		}));
	if (extras.legal || extras.keyPlan || approve.length) {
		const parts = [
			...(extras.legal ? ["accept legal terms"] : []),
			...(approve.length
				? [
						`approve the zero-fee integrator on ${approve.join(", ")} (keeps the key)`,
					]
				: []),
			...(bind.length ? [`bind ${bind.join(", ")}`] : []),
			...(extras.keyPlan
				? [
						`create key “${extras.keyPlan.name}” (cap $${extras.keyPlan.maxSizeUsd.toLocaleString("en-US")}) and store it locally`,
					]
				: []),
		];
		rt.out(
			`${ceremony.id} · ${extras.keyPlan ? "onboarding" : "venue binding"} ceremony · ${venues.join(", ")} · ${ceremony.status}`,
		);
		rt.out(`One wallet session: ${parts.join(", then ")}.`);
	} else
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
	const plan = await legalPlan(rt);
	if (plan === "locked") throw new UsageError("Wallet policy is locked");
	if (plan === "unavailable")
		rt.out(
			"Legal clickwrap is not configured on the auth server (503); continuing without it.",
		);
	const legal = typeof plan === "object" ? plan : undefined;
	const name = typeof values.name === "string" ? values.name.trim() : "mstack";
	if (!name || name.length > 64 || /[\p{Cc}\p{Cf}]/u.test(name))
		throw new UsageError("name must be 1 to 64 visible characters");
	const maxSizeUsd = numberFlag(
		typeof values["max-size"] === "string" ? values["max-size"] : "5000",
		"max-size",
		10,
	);
	await requireWritableKeyStore(rt, config.owner);
	const ceremony = await stageCeremony(values, rt, undefined, {
		legal,
		keyPlan: { name, maxSizeUsd },
	});
	if (ceremony) return;
	// Every requested venue is already bound: stage the remaining steps alone.
	if (legal) {
		await stageLegal(rt);
		return;
	}
	if (!(await (await cliKeyStore(rt)).get(getAddress(config.owner))))
		await keysCommand(
			["create"],
			{
				name,
				venues: parseVenues(values.venues).join(","),
				"max-size": String(maxSizeUsd),
			},
			rt,
		);
}

/** The command that stages a fresh ceremony with the same plan. */
function restageCommand(ceremony: Ceremony): string {
	const venues = [
		...(ceremony.ready ?? []),
		...(ceremony.integrators ?? []).map((plan) => plan.venue),
		...ceremony.venues.map((target) => target.venue),
	].join(",");
	const rebind = ceremony.venues.some((target) => target.rebind)
		? " --rebind"
		: "";
	const plan = ceremony.keyPlan;
	return plan
		? `mob onboard --native --venues '${venues}'${plan.name === "mstack" ? "" : ` --name '${plan.name}'`} --max-size '${plan.maxSizeUsd}'${rebind}`
		: `mob bind --all --venues '${venues}'${rebind}`;
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
	/** A browser page shows the failure before it closes. */
	close(failure?: unknown): Promise<void>;
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
	const failureContext: FailureContext = {
		id,
		owner: ceremony.owner,
		restage: restageCommand(ceremony),
	};
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
	// Only in-process callers (the approver) can pass a pinned fingerprint.
	if (
		typeof values.pin === "string" &&
		ceremonyFingerprint(ceremony) !== values.pin
	)
		throw new UsageError(
			`${id} changed after it was shown; nothing was signed`,
		);
	const backend = values.with ?? config.signer;
	if (!backend) throw new UsageError(chooseSigner(id));
	if (!["keystore", "browser", "walletconnect"].includes(String(backend)))
		throw new UsageError(`${backend} signer is not available in this build`);
	if (backend === "walletconnect" && !config.walletconnect_project_id)
		throw new UsageError(
			"Set walletconnect_project_id before using walletconnect",
		);
	let waiting: ReturnType<typeof walletWait> | undefined;
	let session: Session;
	// The server window binds the binding steps; the wallet session stays open
	// through status polling and the key step, which carries its own window.
	const deadline = ceremony.expiresAt + 900_000;
	const legalPending = Boolean(ceremony.legal && !ceremony.legal.signature);
	// MoB accepts an integrator approval timestamp for 300 seconds, so each
	// step is created when the wallet session starts, not when it is staged.
	// An unsigned step from an earlier session is replaced.
	const approvalBase = String(getConfig(config, "api_base"));
	for (const plan of ceremony.integrators ?? []) {
		const existing = ceremony.approvals?.find(
			(item) => item.venue === plan.venue,
		);
		if (existing?.signatureAttemptedAt !== undefined) continue;
		const createdAt = rt.now();
		const timestamp = Math.floor(createdAt / 1000);
		const nonce = crypto.randomUUID();
		const created = ceremonyStep(
			`${id}:integrator-${plan.venue}`,
			ceremony.owner,
			`Approve the zero-fee Lighter integrator on ${plan.venue} (keeps your key)`,
			{
				type: "text",
				message: lighterIntegratorApprovalMessage({
					ownerAddress: ceremony.owner,
					venue: plan.venue,
					integratorIndex: plan.integratorIndex,
					nonce,
					timestamp,
				}),
			},
			createdAt,
			Math.min(createdAt + 300_000, deadline),
			{
				type: "integrator-ceremony",
				base: approvalBase,
				body: {
					ownerAddress: ceremony.owner.toLowerCase(),
					venue: plan.venue,
					nonce,
					timestamp,
				},
			},
			{ venue: plan.venue },
		);
		ceremony = await store.update(id, (record) => {
			record.approvals = [
				...(record.approvals ?? []).filter((item) => item.venue !== plan.venue),
				created,
			];
		});
	}
	const pendingApprovals = (ceremony.approvals ?? []).filter(
		(step) => !step.signature,
	);
	if (backend === "browser") {
		const browser = browserCeremonySigner(
			ceremony.id,
			ceremony.owner,
			deadline,
			{
				now: rt.now,
				openUrl: rt.openUrl,
				onUrl: (url) => {
					waiting = walletWait(rt, ceremony.expiresAt);
					waiting.show(url, "browser");
				},
			},
		);
		browser.addSteps([
			...(legalPending && ceremony.legal ? [view(ceremony.legal)] : []),
			...pendingApprovals.map(view),
			...(ceremony.prepare ? [view(ceremony.prepare)] : []),
		]);
		session = browser;
	} else if (backend === "walletconnect") {
		const wallet = walletConnectCeremonySigner(
			ceremony.id,
			ceremony.owner,
			deadline,
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
	let failure: unknown;
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
		const find = (record: Ceremony, stepId: string) =>
			[
				record.legal,
				...(record.approvals ?? []),
				record.prepare,
				...record.requests,
				record.read,
				record.key,
			].find((item) => item?.id === stepId);
		const total = () =>
			(ceremony.legal ? 1 : 0) +
			(ceremony.integrators?.length ?? 0) +
			(ceremony.prepare ? 2 + ceremony.requests.length : 0) +
			(ceremony.keyPlan ? 1 : 0);
		const sign = async (step: CeremonyProposal) => {
			if (rt.now() >= step.expiresAt)
				throw new Error("Ceremony step expired before signing");
			card++;
			rt.out(showStep(step, card, total()));
			await store.update(id, (record) => {
				const stored = find(record, step.id);
				if (!stored || stored.signatureAttemptedAt !== undefined)
					throw new Error(
						"Ceremony step is terminal or already used for signing",
					);
				stored.signatureAttemptedAt = rt.now();
			});
			try {
				const signature = await session.sign(view(step));
				await store.update(id, (record) => {
					const stored = find(record, step.id);
					if (!stored) throw new Error("Ceremony step disappeared");
					stored.signature = signature;
					stored.status = "signed";
					if (stored.requestId)
						record.signatures.push({ requestId: stored.requestId, signature });
				});
				return signature;
			} catch (error) {
				await store.update(id, (record) => {
					const stored = find(record, step.id);
					if (stored) stored.status = "rejected";
				});
				throw error;
			}
		};

		const createKeyInSession = async (current: Ceremony, venues: string[]) => {
			const plan = current.keyPlan;
			if (!plan) return;
			const createdAt = rt.now();
			if (createdAt >= deadline) {
				rt.out(
					`Wallet session deadline passed before the key step. Retry with mob keys create --name '${plan.name}' --venues '${venues.join(",")}' --max-size '${plan.maxSizeUsd}'.`,
				);
				return;
			}
			const timestamp = Math.floor(createdAt / 1000);
			const nonce = crypto.randomUUID();
			const body: JsonObject = {
				owner: current.owner,
				name: plan.name,
				venues,
				maxSizeUsd: plan.maxSizeUsd,
				nonce,
				timestamp,
			};
			const signing = {
				type: "text" as const,
				message: apiKeyMessage("create", {
					owner: current.owner,
					timestamp,
					name: plan.name,
					venues: venues as ArbitrageVenue[],
					maxSizeUsd: plan.maxSizeUsd,
					nonce,
				}),
			};
			const fundingBase = String(getConfig(config, "api_base"));
			ceremony = await store.update(id, (record) => {
				if (!record.key)
					record.key = ceremonyStep(
						`${id}:key`,
						record.owner,
						`Create API key “${plan.name}” · venues ${venues.join(", ")} · cap $${plan.maxSizeUsd}`,
						signing,
						createdAt,
						Math.min(createdAt + 300_000, deadline),
						{ type: "key-ceremony", base: fundingBase, body },
					);
			});
			const keyStep = ceremony.key;
			if (keyStep?.submit.type !== "key-ceremony")
				throw new Error("Ceremony key step was not stored");
			session.addSteps?.([view(keyStep)]);
			try {
				// The server shows the secret once: never create it into a store
				// that cannot keep it.
				await requireWritableKeyStore(rt, current.owner);
				const signature = keyStep.signature ?? (await sign(keyStep));
				const answer = (await new MobiusClient({
					base: keyStep.submit.base,
					version: pkg.version,
					fetch: rt.fetch,
				}).write(
					"/api/keys/create",
					{ ...keyStep.submit.body, signature } as unknown as ApiKeyCreateBody,
					AbortSignal.timeout(Math.max(1, keyStep.expiresAt - rt.now())),
				)) as unknown as Json;
				const stored = await storeCreatedKey(
					rt,
					current.owner,
					keyStep.submit.body,
					answer,
				);
				const prefix = String(stored.key);
				const backend = String(stored.backend);
				await store.update(id, (record) => {
					record.keyResult = { prefix, backend };
					record.status = "complete";
				});
				rt.out(`Key ${prefix} stored in ${backend}.`);
				rt.out(
					`Ready · ${venues.length} venues bound · key ${prefix} · cap $${plan.maxSizeUsd.toLocaleString("en-US")}`,
				);
			} catch (error) {
				const message = redactKey(
					explainCeremonyFailure(error, failureContext).message,
				);
				await store.update(id, (record) => {
					record.status = "partial";
					record.error = message;
				});
				rt.out(
					`The venues are bound, but the key was not created. ${message} To create only the key, run \`mob keys create --name '${plan.name}' --venues '${venues.join(",")}' --max-size '${plan.maxSizeUsd}'\`.`,
				);
			}
		};

		if (ceremony.legal && !ceremony.legal.signature) {
			const legal = ceremony.legal;
			if (legal.submit.type !== "legal-ceremony")
				throw new Error("Invalid legal step");
			const signature = await sign(legal);
			await new MobiusClient({
				base: legal.submit.base,
				version: pkg.version,
				fetch: rt.fetch,
			}).write(
				"/legal/acceptance" as keyof WriteRoutes,
				{
					...legal.submit.body,
					signature,
				} as WriteRoutes[keyof WriteRoutes]["body"],
				AbortSignal.timeout(Math.max(1, legal.expiresAt - rt.now())),
			);
			rt.out("Legal terms accepted.");
			ceremony = await store.get(id);
		}

		const approved: string[] = [];
		for (const plan of ceremony.integrators ?? []) {
			const step = ceremony.approvals?.find(
				(item) => item.venue === plan.venue,
			);
			if (!step) throw new Error(`No integrator step for ${plan.venue}`);
			if (step.submit.type !== "integrator-ceremony")
				throw new Error("Invalid integrator step");
			session.addSteps?.([view(step)]);
			const signature = step.signature ?? (await sign(step));
			const answer = await new MobiusClient({
				base: step.submit.base,
				version: pkg.version,
				fetch: rt.fetch,
			}).write(
				"/api/binding/lighter/integrator-approve",
				{
					...step.submit.body,
					signature,
				} as unknown as WriteRoutes["/api/binding/lighter/integrator-approve"]["body"],
				AbortSignal.timeout(Math.max(1, step.expiresAt - rt.now())),
			);
			rt.out(
				`${plan.venue}: integrator approved${Number.isFinite(answer.expiresAt) ? ` until ${new Date(answer.expiresAt).toISOString().slice(0, 10)}` : ""}`,
			);
			approved.push(plan.venue);
		}
		// Venues that end ready without a new binding; the key covers them too.
		const kept = [...(ceremony.ready ?? []), ...approved];
		const prepare = ceremony.prepare;
		if (!prepare) {
			await store.update(id, (record) => {
				record.status = "complete";
			});
			rt.out(`${id} complete · ${approved.length} integrator approved`);
			if (ceremony.keyPlan) await createKeyInSession(ceremony, kept);
			else if (ceremony.onComplete === "stage-key")
				await keysCommand(
					["create"],
					{ name: "mstack", venues: kept.join(","), "max-size": "5000" },
					rt,
					read,
				);
			return;
		}
		session.addSteps?.([view(prepare)]);
		let prepareSignature = prepare.signature;
		if (!prepareSignature) {
			prepareSignature = await sign(prepare);
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
				await store.update(id, (record) => {
					record.status = "failed";
				});
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
		await store.update(id, (record) => {
			record.status =
				successful.length === latest.results.length
					? "complete"
					: successful.length
						? "partial"
						: "failed";
			record.latest = latest;
		});
		for (const result of latest.results)
			if (!["bound", "already_bound"].includes(result.status))
				rt.out(explainVenueResult(result, failureContext));
		rt.out(
			`${id} ${successful.length === latest.results.length ? "complete" : "partial"} · ${successful.length} venues bound`,
		);
		if (ceremony.keyPlan && successful.length === latest.results.length)
			await createKeyInSession(ceremony, [
				...kept,
				...successful.map((r) => r.venue),
			]);
		else if (
			ceremony.onComplete === "stage-key" &&
			successful.length === latest.results.length
		)
			await keysCommand(
				["create"],
				{
					name: "mstack",
					venues: [...kept, ...successful.map((result) => result.venue)].join(
						",",
					),
					"max-size": "5000",
				},
				rt,
				read,
			);
	} catch (error) {
		failure = explainCeremonyFailure(error, failureContext);
		throw failure;
	} finally {
		waiting?.stop();
		await session.close(failure);
	}
}
