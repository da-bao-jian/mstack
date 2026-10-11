import { randomBytes, timingSafeEqual } from "node:crypto";
import { getAddress, type Hex } from "viem";
import html from "./browser.html" with { type: "text" };
import {
	assertPayload,
	checkedView,
	deferred,
	type InteractiveSigner,
	pinnedChain,
	type SigningView,
	verifySignature,
} from "./interactive.ts";
import { openUrl } from "./open-url.ts";

export interface BrowserOptions {
	openUrl?: (url: string) => Promise<void>;
	onUrl?: (url: string) => void;
	now?: () => number;
	connectionOnly?: boolean;
}

/** One process, one Proposal, one accepted signature. The token never touches disk. */
export function browserSigner(
	input: SigningView,
	options: BrowserOptions = {},
): InteractiveSigner {
	const view = checkedView(input, options.connectionOnly);
	const now = options.now ?? Date.now;
	const token = randomBytes(32).toString("hex");
	const nonce = randomBytes(24).toString("base64");
	const connected = deferred<{ address: typeof view.owner; chainId: number }>();
	const signed = deferred<Hex>();
	let account: { address: typeof view.owner; chainId: number } | undefined;
	let server: ReturnType<typeof Bun.serve> | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let terminal: Error | undefined;
	let requested = false;
	let accepting = false;
	let used = false;
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
	function finish(error?: Error, drainResponse = false) {
		if (terminal) return;
		if (timer) clearTimeout(timer);
		terminal = error ?? new Error("Browser signing completed");
		// Bun 1.3.8 stop(false) inside fetch leaves keep-alive sockets serving requests.
		// Give the final response one short flush window, then close every socket.
		closing = drainResponse
			? new Promise((resolve) => {
					setTimeout(() => {
						void Promise.resolve(server?.stop(true)).then(resolve);
					}, 10);
				})
			: Promise.resolve(server?.stop(true));
		if (error)
			void closing.then(() => {
				connected.reject(error);
				signed.reject(error);
			});
	}
	function alive() {
		if (now() >= view.expiresAt) {
			const error = new Error(
				"Proposal expired while waiting for browser wallet",
			);
			finish(error);
			throw error;
		}
		if (terminal) throw terminal;
	}
	const reply = (status: number, reason: string) =>
		Response.json({ error: reason }, { status, headers });
	function start() {
		alive();
		if (server) return;
		server = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			maxRequestBodySize: 4096,
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
				if (used || terminal)
					return reply(409, "Proposal already used or closed");
				if (now() >= view.expiresAt) {
					finish(
						new Error("Proposal expired while waiting for browser wallet"),
					);
					return reply(410, "Proposal expired");
				}
				if (req.method === "GET" && url.pathname === `/sign/${view.id}`)
					// Bun's *.html declaration describes its default loader, not type: text.
					return new Response(
						(html as unknown as string).replaceAll("_MSTACK_NONCE_", nonce),
						{
							headers: {
								...headers,
								"Content-Type": "text/html; charset=utf-8",
							},
						},
					);
				if (req.method === "GET" && url.pathname === "/api/proposal")
					return Response.json(
						{
							...view,
							ready: requested,
							...(options.connectionOnly ? { connectionOnly: true } : {}),
						},
						{ headers },
					);
				if (req.method !== "POST") return reply(404, "Unknown route");
				if (req.headers.get("origin") !== origin)
					return reply(403, "Invalid Origin");
				if (
					req.headers.get("content-type")?.split(";")[0] !== "application/json"
				)
					return reply(415, "Expected JSON");
				if (url.pathname === "/api/reject") {
					finish(new Error("Browser wallet rejected the Proposal"), true);
					return Response.json({ ok: true }, { headers });
				}
				if (!["/api/account", "/api/signature"].includes(url.pathname))
					return reply(404, "Unknown route");
				if (accepting) return reply(409, "Signature verification in progress");
				const signatureAttempt = url.pathname === "/api/signature";
				if (signatureAttempt) {
					if (!requested || !account)
						return reply(409, "CLI is not ready to sign");
					used = true;
				}
				accepting = true;
				try {
					const body = await req.json();
					alive();
					if (!body || typeof body !== "object")
						return reply(400, "Invalid body");
					if (
						typeof body.address !== "string" ||
						getAddress(body.address) !== getAddress(view.owner)
					)
						return reply(403, "Wallet account does not match owner");
					if (url.pathname === "/api/account") {
						if (!Number.isSafeInteger(body.chainId) || body.chainId <= 0)
							return reply(400, "Invalid chainId");
						account = {
							address: getAddress(body.address),
							chainId: body.chainId,
						};
						if (options.connectionOnly) {
							const reported = account;
							setTimeout(() => connected.resolve(reported), 10);
						} else connected.resolve(account);
						return Response.json({ ok: true }, { headers });
					}
					if (!requested || !account)
						return reply(409, "CLI is not ready to sign");
					const chain = pinnedChain(view);
					if (chain !== undefined && account.chainId !== chain)
						return reply(409, "Wallet chain does not match Proposal");
					const signature = await verifySignature(
						view,
						body.address,
						body.signature,
					);
					alive();
					used = true;
					finish(undefined, true);
					void closing.then(() => signed.resolve(signature));
					return Response.json({ ok: true }, { headers });
				} catch (error) {
					return reply(
						400,
						error instanceof Error ? error.message : "Invalid signature",
					);
				} finally {
					accepting = false;
					if (signatureAttempt && !terminal)
						finish(
							new Error("Browser signature rejected; stage a new Proposal"),
							true,
						);
				}
			},
		});
		origin = `http://127.0.0.1:${server.port}`;
		timer = setTimeout(
			() =>
				finish(new Error("Proposal expired while waiting for browser wallet")),
			Math.max(0, view.expiresAt - now()),
		);
		const url = `${origin}/sign/${view.id}?t=${token}`;
		options.onUrl?.(url);
		void (options.openUrl ?? openUrl)(url).catch((error) =>
			finish(
				new Error(
					`Cannot open browser: ${error instanceof Error ? error.message : String(error)}`,
				),
			),
		);
	}
	async function sign(payload: SigningView["signing"]) {
		if (options.connectionOnly)
			throw new Error("Connection-only bridge cannot sign");
		alive();
		assertPayload(view, payload);
		if (requested) throw new Error("Proposal signing already requested");
		requested = true;
		start();
		return signed.promise;
	}
	return {
		async address() {
			start();
			return (await connected.promise).address;
		},
		async chainId() {
			start();
			await connected.promise;
			if (!account) throw new Error("Wallet has not reported its chain");
			return account.chainId;
		},
		signMessage: ({ message }) => {
			if (typeof message !== "string")
				return Promise.reject(
					new Error("Browser Proposal requires a UTF-8 text message"),
				);
			return sign({ type: "text", message });
		},
		signTypedData: (typedData) => sign({ type: "typed", typedData }),
		async close() {
			if (!terminal) finish(new Error("Browser signing cancelled"));
			await closing;
		},
	};
}
