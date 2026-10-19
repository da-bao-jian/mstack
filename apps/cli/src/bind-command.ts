import {
	type ApproveAgentParams,
	type ArbitrageVenue,
	bindingPrepareMessage,
	buildApproveAgentTypedRequest,
	hlTypedAction,
	lighterIntegratorApprovalMessage,
	lighterPrepareMessage,
	MobiusClient,
} from "@mstack/mobius-client";
import {
	digest,
	type JsonObject,
	type PreflightCheck,
	type Proposal,
	type ProposalInput,
	ProposalStore,
} from "@mstack/proposals";
import { browserSigner } from "@mstack/signers";
import { type Address, getAddress, type TypedDataDefinition } from "viem";
import pkg from "../package.json";
import { bindingSteps } from "./bind-ceremony.ts";
import { getConfig, readConfig } from "./config.ts";
import { object, request, textField } from "./onboarding-http.ts";
import { printStaged, stageOnboarding } from "./onboarding-stage.ts";
import { Checks, configChecks } from "./preflight/checks.ts";
import type { Runtime } from "./run.ts";
import { HL_DEPOSIT_HINT, hlDeposited } from "./venue-accounts.ts";

const capabilities = {
	hl: "key can trade, cancel and adjust margin; cannot withdraw; expires after 179 days",
	aster:
		"key can trade perpetuals; cannot trade spot or withdraw; expires after 365 days",
	lighter:
		"key can trade, cancel, adjust leverage and isolated margin, approve integrators; can withdraw to your own address, not trade-only; cannot transfer to third parties without your L1 signature; no expiry",
	"lighter-mainnet":
		"key can trade, cancel, adjust leverage and isolated margin, approve integrators; can withdraw to your own address, not trade-only; cannot transfer to third parties without your L1 signature; no expiry",
} as const;
const rest = (venue: ArbitrageVenue) =>
	venue === "lighter-mainnet"
		? "https://mainnet.zklighter.elliot.ai"
		: "https://api.rh.lighter.xyz";
function positive(value: unknown, label: string, zero = false): number {
	if (
		typeof value !== "number" ||
		!Number.isSafeInteger(value) ||
		value < (zero ? 0 : 1)
	)
		throw new Error(`Invalid ${label}`);
	return value;
}
async function funded(owner: Address, rt: Runtime) {
	if (!(await hlDeposited(owner, rt))) throw new Error(`${HL_DEPOSIT_HINT}.`);
}
async function hlChain(owner: Address, rt: Runtime) {
	const config = await readConfig(rt.home);
	// WalletConnect authorizes an explicit chain namespace, not a current-chain query.
	if (config.signer === "keystore" || config.signer === "walletconnect")
		return Number(getConfig(config, "hl_signature_chain_id"));
	const signing = {
		type: "text" as const,
		message: "Connect to read the HL signing chain. No signature requested.",
	};
	const connection = browserSigner(
		{
			id: "wallet-connection",
			purpose: signing.message,
			owner,
			signing,
			digest: digest(signing),
			expiresAt: rt.now() + 300_000,
		},
		{ connectionOnly: true, now: rt.now, openUrl: rt.openUrl, onUrl: rt.out },
	);
	try {
		if (getAddress(await connection.address()) !== owner)
			throw new Error("Connected wallet does not match owner");
		if (!connection.chainId) throw new Error("Browser did not report chainId");
		return positive(await connection.chainId(), "wallet chainId");
	} finally {
		await connection.close();
	}
}
export async function bindCommand(
	name: string,
	rt: Runtime,
	refreshed = false,
) {
	if (!Object.hasOwn(capabilities, name))
		throw new Error("Venue must be hl, aster, lighter or lighter-mainnet");
	const venue = name as ArbitrageVenue;
	const group = venue.startsWith("lighter")
		? "lighter"
		: (venue as "hl" | "aster");
	const config = await readConfig(rt.home);
	await configChecks(config, new Checks(rt.now));
	const owner = getAddress(config.owner as string);
	const base = String(getConfig(config, "api_base"));
	const client = new MobiusClient({
		base,
		version: pkg.version,
		fetch: rt.fetch,
	});
	const store = new ProposalStore(rt.home, rt.now, rt.err);
	const proposals = await store.list();
	if (!refreshed) {
		const legal = proposals.findLast(
			(p) =>
				p.owner === owner &&
				p.submit.route === "/legal/acceptance" &&
				!p.signature &&
				["staged", "previewed", "awaiting-signature", "expired"].includes(
					p.status,
				),
		);
		const auth = new MobiusClient({
			base: String(getConfig(config, "auth_base")),
			version: pkg.version,
			fetch: rt.fetch,
		});
		try {
			if (!(await auth.read("/legal/acceptance", { wallet: owner })).accepted)
				rt.out(
					legal
						? `Legal acceptance ${legal.id} is still unsigned; it is needed before your first open.`
						: "Legal acceptance is not staged; it is needed before your first open. Run mob setup.",
				);
		} catch {
			rt.out(
				"Legal acceptance could not be checked; run mob setup before your first open.",
			);
		}
	}
	const history = proposals.filter(
		(p) =>
			p.owner === owner &&
			p.submit.binding?.venue === venue &&
			p.submit.binding.apiBase === base,
	);
	const credential = await client.read(`/api/binding/${group}/credential`, {
		ownerAddress: owner,
		...(venue === "lighter-mainnet" ? { venue } : {}),
	});
	const pending = (step: string, sessionId?: string) =>
		history.findLast(
			(p) =>
				p.submit.binding?.step === step &&
				p.submit.binding.sessionId === sessionId &&
				!p.signatureAttemptedAt &&
				p.status === "awaiting-signature" &&
				p.expiresAt > rt.now(),
		);
	const stage = async (
		step: string,
		signing: ProposalInput["signing"],
		submit: ProposalInput["submit"],
		sessionId?: string,
		checks: PreflightCheck[] = [],
		kind?: ProposalInput["kind"],
	) => {
		const existing = pending(step, sessionId);
		if (existing) {
			printStaged(existing, rt);
			return existing;
		}
		const expired = history.findLast(
			(p) =>
				p.submit.binding?.step === step &&
				["expired", "interrupted"].includes(p.status),
		);
		if (expired)
			rt.out(
				`${expired.id} is ${expired.status}; staging a fresh binding Proposal.`,
			);
		return stageOnboarding(
			{
				owner,
				purpose: `${venue}: ${step}; ${capabilities[venue]}`,
				kind: kind ?? (signing.type === "text" ? "sign-text" : "sign-typed"),
				signing,
				submit: {
					...submit,
					binding: {
						venue,
						step,
						apiBase: base,
						...(sessionId ? { sessionId } : {}),
						...(credential.bound && "publicKey" in credential
							? { publicKey: credential.publicKey }
							: {}),
					},
				},
				preflightPlan: {
					checks: [
						{
							route: "staged",
							name: "binding.next-step",
							detail: `${venue} ${step}${sessionId ? ` session=${sessionId}` : ""}`,
						},
						...checks,
					],
				},
			},
			rt,
		);
	};
	if (credential.bound) {
		if ("publicKey" in credential) {
			textField(credential, "publicKey");
			positive(credential.accountIndex, "accountIndex", true);
			if (credential.chainId !== (venue === "lighter-mainnet" ? 304 : 466324))
				throw new Error("Bound Lighter credential is on the wrong deployment");
		} else getAddress(credential.agentAddress);
		// Each Lighter deployment that names an integrator needs its approval.
		if (
			!("integratorApproved" in credential) ||
			credential.integratorApproved ||
			credential.integratorIndex === null
		) {
			if ("builderApproved" in credential && !credential.builderApproved)
				throw new Error(
					"Venue key is bound but builder approval is missing. The server must return a repair session before binding can continue.",
				);
			rt.out(bindingSteps(venue, "complete"));
			rt.out(
				`${venue}: bound${"integratorApproved" in credential && credential.integratorApproved ? "; integrator approved" : ""}. No Proposal needed.`,
			);
			return;
		}
		const index = positive(
			credential.integratorIndex,
			"integrator index",
			true,
		);
		const attempted = history.findLast(
			(p) =>
				p.submit.binding?.step === "approve-integrator" &&
				p.submit.binding.publicKey === credential.publicKey &&
				p.signatureAttemptedAt !== undefined,
		);
		if (attempted) {
			rt.out(bindingSteps(venue, "approve-integrator"));
			rt.out(
				`Integrator approval already attempted in ${attempted.id}; venue answer: ${JSON.stringify(attempted.answer ?? attempted.error)}. No automatic repeat.`,
			);
			return;
		}
		const timestamp = Math.floor(rt.now() / 1000),
			nonce = crypto.randomUUID();
		await stage(
			"approve-integrator",
			{
				type: "text",
				message: lighterIntegratorApprovalMessage({
					ownerAddress: owner,
					venue,
					integratorIndex: index,
					timestamp,
					nonce,
				}),
			},
			{
				base,
				route: "/api/binding/lighter/integrator-approve",
				signatureField: "signature",
				body: { ownerAddress: owner, venue, timestamp, nonce },
			},
		);
		return;
	}
	if ("repair" in credential && credential.repair)
		throw new Error(
			"Server reports a standalone builder repair for an existing key. No replacement key was prepared; complete that repair in the MoB app.",
		);
	const session: Record<string, unknown> | undefined = credential.session
		? object(credential.session)
		: undefined;
	if (!session) {
		await client.read("/api/binding/rebind-check", {
			ownerAddress: owner,
			venue,
		});
		if (venue === "hl") await funded(owner, rt);
		const timestamp = Math.floor(rt.now() / 1000),
			nonce = crypto.randomUUID();
		const body: JsonObject = { timestamp, nonce };
		let message: string;
		if (group === "lighter") {
			const data = object(
				await request(
					rt.fetch,
					`${rest(venue)}/api/v1/account?by=l1_address&value=${owner}`,
					"GET",
				),
			);
			if (data.code !== 200 || !Array.isArray(data.accounts))
				throw new Error(
					`Malformed Lighter account response: ${JSON.stringify(data)}`,
				);
			if (!data.accounts.length)
				throw new Error("Create a Lighter account first.");
			const accountIndex = positive(
				object(data.accounts[0]).index,
				"accountIndex",
				true,
			);
			const chainId = venue === "lighter-mainnet" ? 304 : 466324;
			Object.assign(
				body,
				{ accountIndex, chainId },
				venue === "lighter-mainnet" ? { venue } : {},
			);
			message = lighterPrepareMessage({
				accountIndex,
				chainId,
				nonce,
				timestamp,
				venue: venue === "lighter-mainnet" ? venue : null,
			});
		} else
			message = bindingPrepareMessage(group as "hl" | "aster", {
				nonce,
				timestamp,
			});
		await stage(
			"prepare",
			{ type: "text", message },
			{
				base,
				route: `/api/binding/${group}/prepare`,
				signatureField: "signature",
				body,
			},
			undefined,
			[
				{
					route: "/api/binding/rebind-check",
					name: "binding.rebind-allowed",
					params: { ownerAddress: owner, venue },
					assertions: [{ path: ["allowed"], equals: true }],
				},
			],
		);
		return;
	}
	const sessionId = textField(session, "sessionId");
	const status = await client.read(`/api/binding/${group}/status`, {
		sessionId,
	});
	if (status.status === "failed")
		throw new Error(
			`Binding session failed: ${status.error ?? "server refused"}`,
		);
	if (status.status === "bound") {
		if (refreshed)
			throw new Error(
				"Server status is bound but credential is still pending; run mob bind again when it is visible.",
			);
		return bindCommand(name, rt, true);
	}
	const completion = (
		finalize: boolean,
	): NonNullable<ProposalInput["submit"]["completion"]> => ({
		base,
		statusRoute: `/api/binding/${group}/status`,
		sessionId,
		...(finalize && (group === "hl" || group === "aster")
			? {
					finalize: {
						route: `/api/binding/${group}/builder-finalize` as const,
						body: { ownerAddress: owner },
					},
				}
			: {}),
	});
	const alreadySubmitted = (step: string): Proposal | undefined =>
		history.findLast(
			(p) =>
				p.submit.binding?.sessionId === sessionId &&
				p.submit.binding.step === step &&
				p.signature !== undefined,
		);
	if (group === "hl") {
		const builder = session.builderAddress;
		const needsBuilder = "needsBuilderFee" in status && status.needsBuilderFee;
		const step = needsBuilder ? "approve-builder-fee" : "approve-agent";
		const existing = pending(step, sessionId);
		if (existing) {
			printStaged(existing, rt);
			return;
		}
		if (alreadySubmitted(step)) {
			rt.out(bindingSteps(venue, step));
			rt.out(
				`${venue}: ${step} was already attempted; waiting for the server's status. No repeat signature requested.`,
			);
			return;
		}
		if (!needsBuilder) await funded(owner, rt);
		const chainId = await hlChain(owner, rt);
		const nonce = rt.now();
		const action: Record<string, string | number> = needsBuilder
			? {
					type: "approveBuilderFee",
					signatureChainId: `0x${chainId.toString(16)}`,
					hyperliquidChain: "Mainnet",
					maxFeeRate: "0.1%",
					builder: getAddress(String(builder)),
					nonce,
				}
			: {
					type: "approveAgent",
					signatureChainId: `0x${chainId.toString(16)}`,
					hyperliquidChain: "Mainnet",
					agentAddress: getAddress(textField(session, "agentAddress")),
					agentName: `mobius-bot valid_until ${nonce + 179 * 86400_000}`,
					nonce,
				};
		const typed = hlTypedAction(action);
		await stage(
			step,
			{ type: "typed", typedData: typed },
			{
				base: "https://api.hyperliquid.xyz",
				route: "/exchange",
				format: "hl",
				signatureField: "signature",
				body: { action, nonce } as JsonObject,
				...(needsBuilder || !builder
					? { completion: completion(!!builder) }
					: {}),
			},
			sessionId,
		);
	} else if (group === "aster") {
		if (alreadySubmitted("approve-agent")) {
			rt.out(bindingSteps(venue, "confirm"));
			rt.out(
				"aster: approval was already attempted; waiting for server status. No repeat signature requested.",
			);
			return;
		}
		const params = object(session.approvalParams);
		if (
			session.signingChainId !== 56 ||
			session.baseUrl !== "https://fapi.asterdex.com" ||
			getAddress(String(params.user)) !== owner ||
			getAddress(String(params.agentAddress)) !==
				getAddress(textField(session, "agentAddress")) ||
			params.canWithdraw !== false ||
			params.canSpotTrade !== false ||
			params.canPerpTrade !== true ||
			params.asterChain !== "Mainnet"
		)
			throw new Error("Unsafe or unsupported Aster approval parameters");
		textField(params, "agentName");
		positive(params.expired, "agent expiry");
		positive(params.nonce, "approval nonce");
		if (Number(params.expired) <= rt.now())
			throw new Error("Aster approval already expired");
		const typed = buildApproveAgentTypedRequest(
			params as unknown as ApproveAgentParams,
			56,
		) as unknown as TypedDataDefinition;
		const body = { ...params, signatureChainId: 56 } as JsonObject;
		await stage(
			"approve-agent",
			{ type: "typed", typedData: typed },
			{
				base: session.baseUrl,
				route: "/fapi/v3/approveAgent",
				format: "aster",
				fieldOrder: Object.keys(body),
				signatureField: "signature",
				body,
				completion: completion(true),
			},
			sessionId,
		);
	} else {
		if (alreadySubmitted("approve-key")) {
			rt.out(bindingSteps(venue, "confirm"));
			rt.out(
				`${venue}: key approval was already attempted; waiting for server status. No repeat signature requested.`,
			);
			return;
		}
		const txInfo = object(session.txInfo);
		if (Object.hasOwn(txInfo, "L1Sig"))
			throw new Error("Lighter txInfo already contains a signature");
		await stage(
			"approve-key",
			{ type: "text", message: textField(session, "messageToSign", true) },
			{
				base: rest(venue),
				route: "/api/v1/sendTx",
				format: "lighter",
				signatureField: "signature",
				body: { tx_type: 8, tx_info: txInfo } as JsonObject,
				completion: completion(false),
			},
			sessionId,
			[],
			"venue-submit",
		);
	}
}
