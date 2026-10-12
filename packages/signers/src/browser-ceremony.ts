import { randomBytes, timingSafeEqual } from "node:crypto";
import {
	type Address,
	getAddress,
	type Hex,
	hashTypedData,
	keccak256,
	stringToHex,
} from "viem";
import baseHtml from "./browser.html" with { type: "text" };
import {
	deferred,
	pinnedChain,
	type SigningView,
	verifySignature,
} from "./interactive.ts";
import { openUrl } from "./open-url.ts";

export interface BrowserCeremonyOptions {
	openUrl?: (url: string) => Promise<void>;
	onUrl?: (url: string) => void;
	now?: () => number;
}

type PublicStep = Pick<SigningView, "id" | "purpose" | "digest"> & {
	status: "pending" | "current" | "signed" | "rejected";
};

function ceremonyHtml(nonce: string): string {
	return (baseHtml as unknown as string)
		.replace("mstack — Review signature", "mstack — Review ceremony")
		.replace(
			'Review signature · <span id="id"></span>',
			'Review ceremony · <span id="id"></span>',
		)
		.replace(
			'<p class="scope">It cannot move funds.</p>',
			'<p class="scope">It cannot move funds.</p><section><h2>Ceremony steps</h2><ol id="steps"></ol></section>',
		)
		.replace(
			"let proposal, provider, address, chainId, loadedAt, selectedIndex = 0, ready = false, busy = false, submitting = false, done = false;",
			"let proposal, provider, address, chainId, loadedAt, selectedIndex = 0, ready = false, busy = false, submitting = false, done = false;",
		)
		.replace(
			'el("sign").disabled = done || busy || !ready || !matches() || wrongChain();',
			'el("sign").disabled = done || busy || !ready || !matches();',
		)
		.replace(
			"if (wrongChain()) { accountStatus(); return; }\n    await reportAccount();",
			'if (wrongChain()) {\n      status("chain", "Switching to " + chainName() + ". Confirm the chain change in your wallet.");\n      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x" + Number(pinned()).toString(16) }] });\n      chainId = Number(await provider.request({ method: "eth_chainId" }));\n      if (wrongChain()) throw new Error("Wallet did not switch to " + chainName() + ".");\n    }\n    await reportAccount();',
		)
		.replace(
			'await api("/api/signature", { address, signature });',
			'await api("/api/signature", { stepId: proposal.id, address, signature });',
		)
		.replace(
			'done = true; status("accepted", "Done. You can close this tab.");',
			'status("accepted", "Signature accepted. Review the next step, then click Sign again."); proposal = undefined; ready = false;',
		)
		.replace(
			'await api("/api/reject", {})',
			'await api("/api/reject", { stepId: proposal?.id })',
		)
		.replace(
			"if (!proposal) {\n      proposal = view; loadedAt = Date.now();",
			'el("steps").replaceChildren(...view.steps.map(item => { const li = document.createElement("li"); li.textContent = (item.status === "signed" ? "✓" : item.status === "current" ? "▶" : "·") + " " + item.purpose + " · " + item.digest; return li; }));\n    if (!proposal || proposal.id !== view.id) {\n      proposal = view; loadedAt = Date.now();',
		)
		.replaceAll("_MSTACK_NONCE_", nonce);
}

function checked(
	input: SigningView,
	ceremonyId: string,
	owner: Address,
	expiresAt: number,
): SigningView {
	const view = structuredClone(input);
	if (!view.id.startsWith(`${ceremonyId}:`))
		throw new Error("Signing step does not belong to ceremony");
	if (getAddress(view.owner) !== owner || view.expiresAt !== expiresAt)
		throw new Error("Signing step identity differs from ceremony");
	const actual =
		view.signing.type === "text"
			? keccak256(stringToHex(view.signing.message))
			: hashTypedData(view.signing.typedData);
	if (actual !== view.digest)
		throw new Error("Ceremony signing step digest mismatch");
	pinnedChain(view);
	return view;
}

/** One local page and wallet connection for all explicit steps in one ceremony. */
export function browserCeremonySigner(
	id: string,
	ownerInput: Address,
	expiresAt: number,
	options: BrowserCeremonyOptions = {},
) {
	if (!/^c-[1-9]\d*$/.test(id)) throw new Error("Invalid ceremony id");
	const owner = getAddress(ownerInput);
	const now = options.now ?? Date.now;
	const token = randomBytes(32).toString("hex");
	const nonce = randomBytes(24).toString("base64");
	const connected = deferred<Address>();
	const views = new Map<string, SigningView>();
	const states = new Map<string, PublicStep["status"]>();
	const pending = new Map<string, ReturnType<typeof deferred<Hex>>>();
	let current: SigningView | undefined;
	let last: SigningView | undefined;
	let account: { address: Address; chainId: number } | undefined;
	let server: ReturnType<typeof Bun.serve> | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let terminal: Error | undefined;
	let accepting = false;
	let origin = "";
	let closing: Promise<void> = Promise.resolve();
	const headers = {
		"Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; img-src data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
		"Cache-Control": "no-store",
		Connection: "close",
		"Referrer-Policy": "no-referrer",
		"X-Content-Type-Options": "nosniff",
		"X-Frame-Options": "DENY",
	};
	const rejectAll = (error: Error) => {
		for (const item of pending.values()) item.reject(error);
		pending.clear();
	};
	function finish(error?: Error, drain = false) {
		if (terminal) return;
		if (timer) clearTimeout(timer);
		terminal = error ?? new Error("Browser ceremony completed");
		closing = drain
			? new Promise((resolve) => {
					setTimeout(
						() => void Promise.resolve(server?.stop(true)).then(resolve),
						10,
					);
				})
			: Promise.resolve(server?.stop(true));
		if (error) {
			connected.reject(error);
			rejectAll(error);
		}
	}
	function alive() {
		if (now() >= expiresAt) {
			const error = new Error(
				"Ceremony expired while waiting for browser wallet",
			);
			finish(error);
			throw error;
		}
		if (terminal) throw terminal;
	}
	const reply = (status: number, reason: string) =>
		Response.json({ error: reason }, { status, headers });
	const publicSteps = () =>
		[...views.values()].map((view) => ({
			id: view.id,
			purpose: view.purpose,
			digest: view.digest,
			status: states.get(view.id) ?? "pending",
		}));
	function start() {
		alive();
		if (server) return;
		server = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			maxRequestBodySize: 65_536,
			async fetch(req) {
				const url = new URL(req.url);
				if (req.headers.get("host") !== new URL(origin).host)
					return reply(403, "Invalid host");
				const supplied = url.searchParams.get("t") ?? "";
				if (
					!/^[a-f0-9]{64}$/.test(supplied) ||
					!timingSafeEqual(Buffer.from(supplied), Buffer.from(token))
				)
					return reply(403, "Invalid token");
				if (terminal) return reply(409, terminal.message);
				if (now() >= expiresAt) {
					finish(
						new Error("Ceremony expired while waiting for browser wallet"),
					);
					return reply(410, "Ceremony expired");
				}
				if (req.method === "GET" && url.pathname === `/sign/${id}`)
					return new Response(ceremonyHtml(nonce), {
						headers: { ...headers, "Content-Type": "text/html; charset=utf-8" },
					});
				if (req.method === "GET" && url.pathname === "/api/proposal") {
					const view = current ?? last ?? [...views.values()][0];
					if (!view) return reply(409, "Ceremony has no signing steps");
					return Response.json(
						{ ...view, ready: Boolean(current), steps: publicSteps() },
						{ headers },
					);
				}
				if (req.method !== "POST") return reply(404, "Unknown route");
				if (req.headers.get("origin") !== origin)
					return reply(403, "Invalid Origin");
				if (
					req.headers.get("content-type")?.split(";")[0] !== "application/json"
				)
					return reply(415, "Expected JSON");
				const body = (await req.json()) as Record<string, unknown>;
				if (url.pathname === "/api/reject") {
					if (current) states.set(current.id, "rejected");
					finish(new Error("Browser wallet rejected the ceremony"), true);
					return Response.json({ ok: true }, { headers });
				}
				if (!current) return reply(409, "CLI is not ready to sign");
				if (accepting) return reply(409, "Signature verification in progress");
				accepting = true;
				try {
					if (
						typeof body.address !== "string" ||
						getAddress(body.address) !== owner
					)
						return reply(403, "Wallet account does not match owner");
					if (url.pathname === "/api/account") {
						if (
							!Number.isSafeInteger(body.chainId) ||
							Number(body.chainId) <= 0
						)
							return reply(400, "Invalid chainId");
						account = { address: owner, chainId: Number(body.chainId) };
						connected.resolve(owner);
						return Response.json({ ok: true }, { headers });
					}
					if (url.pathname !== "/api/signature")
						return reply(404, "Unknown route");
					if (body.stepId !== current.id || !account)
						return reply(409, "Signing step is not current");
					const chain = pinnedChain(current);
					if (chain !== undefined && account.chainId !== chain)
						return reply(409, "Wallet chain does not match signing step");
					const signature = await verifySignature(
						current,
						body.address,
						body.signature,
					);
					const accepted = current;
					states.set(accepted.id, "signed");
					last = accepted;
					current = undefined;
					pending.get(accepted.id)?.resolve(signature);
					pending.delete(accepted.id);
					return Response.json({ ok: true }, { headers });
				} catch (error) {
					return reply(
						400,
						error instanceof Error ? error.message : "Invalid signature",
					);
				} finally {
					accepting = false;
				}
			},
		});
		origin = `http://127.0.0.1:${server.port}`;
		timer = setTimeout(
			() =>
				finish(new Error("Ceremony expired while waiting for browser wallet")),
			Math.max(0, expiresAt - now()),
		);
		const url = `${origin}/sign/${id}?t=${token}`;
		options.onUrl?.(url);
		void (options.openUrl ?? openUrl)(url).catch((error) =>
			finish(
				new Error(
					`Cannot open browser: ${error instanceof Error ? error.message : String(error)}`,
				),
			),
		);
	}
	function addSteps(inputs: SigningView[]) {
		alive();
		for (const input of inputs) {
			const view = checked(input, id, owner, expiresAt);
			const existing = views.get(view.id);
			if (existing && existing.digest !== view.digest)
				throw new Error("Ceremony signing step changed after display");
			views.set(view.id, view);
			if (!states.has(view.id)) states.set(view.id, "pending");
		}
	}
	async function sign(input: SigningView): Promise<Hex> {
		alive();
		const view = checked(input, id, owner, expiresAt);
		addSteps([view]);
		if (states.get(view.id) !== "pending")
			throw new Error("Ceremony signing step is already used");
		if (current) throw new Error("Another ceremony signing step is current");
		const result = deferred<Hex>();
		pending.set(view.id, result);
		current = view;
		states.set(view.id, "current");
		start();
		return result.promise;
	}
	return {
		addSteps,
		async address() {
			start();
			return connected.promise;
		},
		sign,
		async close() {
			if (!terminal) finish();
			await closing;
		},
	};
}
