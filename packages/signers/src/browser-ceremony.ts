import { randomBytes } from "node:crypto";
import {
	type Address,
	getAddress,
	type Hex,
	hashTypedData,
	keccak256,
	stringToHex,
} from "viem";
import { bridgeSession } from "./bridge-session.ts";
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

// The page reads ceremony mode from the `steps` in each view.
function ceremonyHtml(nonce: string): string {
	return (baseHtml as unknown as string).replaceAll("_MSTACK_NONCE_", nonce);
}

// The page polls every 350 ms, so it reads the final state before the server stops.
const LINGER_MS = 1_200;

function checked(
	input: SigningView,
	ceremonyId: string,
	owner: Address,
	expiresAt: number,
): SigningView {
	const view = structuredClone(input);
	if (!view.id.startsWith(`${ceremonyId}:`))
		throw new Error("Signing step does not belong to ceremony");
	// A step may carry its own window (the key step is created after binding);
	// none may outlive the session deadline.
	if (
		getAddress(view.owner) !== owner ||
		!Number.isSafeInteger(view.expiresAt) ||
		view.expiresAt > expiresAt
	)
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
	const access = bridgeSession();
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
	let final: { ok: boolean; message: string } | undefined;
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
	function finish(error?: Error, lingerMs = 0) {
		if (terminal) return;
		if (timer) clearTimeout(timer);
		terminal = error ?? new Error("Browser ceremony completed");
		final = { ok: !error, message: terminal.message };
		closing = lingerMs
			? new Promise((resolve) => {
					setTimeout(
						() => void Promise.resolve(server?.stop(true)).then(resolve),
						lingerMs,
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
			development: false,
			error: () => reply(500, "Bridge error"),
			maxRequestBodySize: 65_536,
			async fetch(req) {
				const url = new URL(req.url);
				if (req.headers.get("host") !== new URL(origin).host)
					return reply(403, "Invalid host");
				const isPage = req.method === "GET" && url.pathname === `/sign/${id}`;
				const opened = isPage ? access.page(req, url) : undefined;
				if (isPage ? !opened?.ok : !access.api(req))
					return reply(
						403,
						isPage
							? "This signing link was already opened; use the tab it opened"
							: "Invalid session",
					);
				if (terminal)
					return final &&
						req.method === "GET" &&
						url.pathname === "/api/proposal"
						? Response.json({ final, steps: publicSteps() }, { headers })
						: reply(409, terminal.message);
				if (now() >= expiresAt) {
					finish(
						new Error("Ceremony expired while waiting for browser wallet"),
					);
					return reply(410, "Ceremony expired");
				}
				if (isPage)
					return new Response(ceremonyHtml(nonce), {
						headers: {
							...headers,
							"Content-Type": "text/html; charset=utf-8",
							...(opened?.setCookie ? { "Set-Cookie": opened.setCookie } : {}),
						},
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
				let body: Record<string, unknown>;
				try {
					const parsed = await req.json();
					if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
						return reply(400, "Invalid body");
					body = parsed as Record<string, unknown>;
				} catch {
					return reply(400, "Invalid JSON");
				}
				if (url.pathname === "/api/reject") {
					if (current) states.set(current.id, "rejected");
					finish(new Error("Browser wallet rejected the ceremony"), 10);
					return Response.json({ ok: true }, { headers });
				}
				if (
					typeof body.address !== "string" ||
					!/^0x[0-9a-fA-F]{40}$/.test(body.address) ||
					getAddress(body.address) !== owner
				)
					return reply(403, "Wallet account does not match owner");
				// The CLI waits for the account before it hands over the first
				// step, so the account report is accepted with no step current.
				if (url.pathname === "/api/account") {
					if (!Number.isSafeInteger(body.chainId) || Number(body.chainId) <= 0)
						return reply(400, "Invalid chainId");
					account = { address: owner, chainId: Number(body.chainId) };
					connected.resolve(owner);
					return Response.json({ ok: true }, { headers });
				}
				if (!current) return reply(409, "CLI is not ready to sign");
				if (accepting) return reply(409, "Signature verification in progress");
				accepting = true;
				try {
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
		access.bind(Number(server.port));
		timer = setTimeout(
			() =>
				finish(new Error("Ceremony expired while waiting for browser wallet")),
			Math.max(0, expiresAt - now()),
		);
		const url = `${origin}/sign/${id}?t=${access.token}`;
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
		/** With a failure, the open page shows it before the server stops. */
		async close(failure?: unknown) {
			if (!terminal)
				finish(
					failure === undefined
						? undefined
						: failure instanceof Error
							? failure
							: new Error(String(failure)),
					server ? LINGER_MS : 0,
				);
			await closing;
		},
	};
}
