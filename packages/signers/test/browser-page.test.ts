import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { stringToHex, type TypedDataDefinition } from "viem";
import logo from "../../../assets/logo.json";
import html from "../src/browser.html" with { type: "text" };

const owner = "0x0000000000000000000000000000000000000001";
class Element {
	textContent = "";
	className = "";
	value: string | number = "0";
	hidden = false;
	src = "";
	alt = "";
	type = "";
	attributes = new Map<string, string>();
	setAttribute(key: string, value: string) {
		this.attributes.set(key, value);
	}
	getAttribute(key: string) {
		return this.attributes.get(key);
	}
	disabled = false;
	onclick: (() => Promise<void> | void) | undefined;
	onchange: (() => void) | undefined;
	children: Element[] = [];
	append(child: Element) {
		this.children.push(child);
	}
}
async function page(
	options: {
		typed?: boolean;
		mismatch?: boolean;
		refuseChain?: boolean;
		fallback?: boolean;
		connectionOnly?: boolean;
		ready?: boolean;
		icon?: string;
		noWallet?: boolean;
		signError?: Error;
		apiError?: string;
		copyError?: boolean;
		pause?: string;
		pauseApi?: string;
	} = {},
) {
	const elements = new Map<string, Element>();
	const el = (id: string) => {
		let element = elements.get(id);
		if (!element) {
			element = new Element();
			elements.set(id, element);
		}
		return element;
	};
	const calls: { method: string; params?: unknown[] }[] = [];
	const posts: { path: string; body: unknown }[] = [];
	let chain = 1;
	let now = 1_000;
	let ready = options.ready ?? true;
	let release: (() => void) | undefined;
	const clipboard: string[] = [];
	const states: string[] = [];
	const providerListeners = new Map<string, (value: unknown) => void>();
	let address = options.mismatch
		? "0x0000000000000000000000000000000000000002"
		: owner;
	const typedData: TypedDataDefinition = {
		domain: { name: "Test", chainId: 97 },
		primaryType: "Test",
		types: { Test: [{ name: "n", type: "uint256" }] },
		message: { n: "123" },
	};
	const signing = options.typed
		? { type: "typed", typedData }
		: { type: "text", message: "café 🦊 <script> never HTML" };
	const provider = {
		async request(req: { method: string; params?: unknown[] }) {
			calls.push(req);
			states.push(el("status").textContent);
			if (options.pause === req.method)
				await new Promise<void>((resolve) => {
					release = resolve;
				});
			if (["eth_requestAccounts", "eth_accounts"].includes(req.method))
				return [address];
			if (req.method === "eth_chainId") return `0x${chain.toString(16)}`;
			if (req.method === "wallet_switchEthereumChain") {
				if (options.refuseChain) throw new Error("User refused chain switch");
				chain = 97;
				return null;
			}
			if (["personal_sign", "eth_signTypedData_v4"].includes(req.method)) {
				if (options.signError) throw options.signError;
				return "0xfixture";
			}
			throw new Error(`Unexpected method ${req.method}`);
		},
		on: (event: string, fn: (value: unknown) => void) =>
			providerListeners.set(event, fn),
	};
	const listeners = new Map<string, (event: unknown) => void>();
	const intervals: (() => void)[] = [];
	const timers: { fn: () => void; delay: number }[] = [];
	const script = (html as unknown as string).match(
		/<script[^>]*>([\s\S]*?)<\/script>/,
	)?.[1];
	if (!script) throw new Error("Missing bundled script");
	runInNewContext(script, {
		document: {
			getElementById: el,
			createElement: () => new Element(),
			createElementNS: () => new Element(),
		},
		Date: { now: () => now },
		navigator: {
			clipboard: {
				writeText: async (text: string) => {
					if (options.copyError) throw new Error("denied");
					clipboard.push(text);
				},
			},
		},
		location: { href: "http://127.0.0.1:1234/sign/p-1?t=fixture" },
		URL,
		TextEncoder,
		Event,
		console,
		window: {
			ethereum: options.fallback ? provider : undefined,
			addEventListener: (event: string, fn: (event: unknown) => void) =>
				listeners.set(event, fn),
			dispatchEvent: (event: Event) => {
				if (
					event.type === "eip6963:requestProvider" &&
					!options.fallback &&
					!options.noWallet
				)
					listeners.get("eip6963:announceProvider")?.({
						detail: {
							info: {
								name: "Fake wallet",
								icon: options.icon ?? "data:image/png;base64,fixture",
							},
							provider,
						},
					});
			},
		},
		setTimeout: (fn: () => void, delay: number) => {
			timers.push({ fn, delay });
		},
		setInterval: (fn: () => void) => intervals.push(fn),
		fetch: async (path: string, init?: RequestInit) => {
			const post = init?.method === "POST";
			if (post)
				posts.push({
					path: path.split("?")[0],
					body: JSON.parse(String(init.body)),
				});
			if (path.split("?")[0] === options.pauseApi)
				await new Promise<void>((resolve) => {
					release = resolve;
				});
			return {
				ok: !options.apiError,
				json: async () =>
					options.apiError
						? { error: options.apiError }
						: post
							? { ok: true }
							: {
									id: "p-1",
									purpose: "Review exactly",
									owner,
									signing,
									digest: "0xdigest",
									expiresAt: 11_000,
									ready,
									connectionOnly: options.connectionOnly,
								},
			};
		},
	});
	await Bun.sleep(0);
	if (options.fallback) timers.find((timer) => timer.delay === 300)?.fn();
	return {
		el,
		calls,
		posts,
		signing,
		typedData,
		clipboard,
		states,
		release: () => release?.(),
		advance: (ms: number) => {
			now += ms;
			for (const fn of intervals) fn();
		},
		changeAccount: (value: string) => {
			address = value;
			providerListeners.get("accountsChanged")?.([value]);
		},
		changeChain: (value: number) => {
			chain = value;
			providerListeners.get("chainChanged")?.(value);
		},
		makeReady: async () => {
			ready = true;
			timers.find((timer) => timer.delay === 350)?.fn();
			await Bun.sleep(0);
		},
	};
}
test.each([false, true])(
	"bundled page discovers wallet, preserves personal_sign UTF-8 and parameter order (fallback=%s)",
	async (fallback) => {
		const p = await page({ fallback });
		expect(p.el("wallet").children).toHaveLength(1);
		if (p.signing.message === undefined)
			throw new Error("Expected text fixture");
		expect(p.el("message").textContent).toBe(p.signing.message);
		await p.el("connect").onclick?.();
		expect(p.el("sign").disabled).toBe(false);
		await p.el("sign").onclick?.();
		expect(
			p.calls.find((call) => call.method === "personal_sign")?.params,
		).toEqual([stringToHex(p.signing.message), owner]);
		expect(p.posts.at(-1)).toEqual({
			path: "/api/signature",
			body: { address: owner, signature: "0xfixture" },
		});
	},
);
test("bundled page switches pinned chain before typed-data signing", async () => {
	const p = await page({ typed: true });
	await p.el("connect").onclick?.();
	await p.el("sign").onclick?.();
	expect(
		p.calls.find((call) => call.method === "wallet_switchEthereumChain")
			?.params,
	).toEqual([{ chainId: "0x61" }]);
	expect(
		p.calls.find((call) => call.method === "eth_signTypedData_v4")?.params,
	).toEqual([owner, JSON.stringify(p.typedData)]);
	expect(
		p.calls.findIndex((call) => call.method === "wallet_switchEthereumChain"),
	).toBeLessThan(
		p.calls.findIndex((call) => call.method === "eth_signTypedData_v4"),
	);
});
test("bundled page displays chain refusal and disables signing", async () => {
	const p = await page({ typed: true, refuseChain: true });
	await p.el("connect").onclick?.();
	expect(p.el("status").textContent).toContain(
		"BNB Smart Chain Testnet in your wallet. User refused chain switch",
	);
	expect(p.el("sign").disabled).toBe(true);
	expect(
		p.calls.some((call) => call.method === "wallet_addEthereumChain"),
	).toBe(false);
	expect(p.posts).toHaveLength(0);
});
test("bundled page renders wrong account in red and refuses signing", async () => {
	const p = await page({ mismatch: true });
	await p.el("connect").onclick?.();
	expect(p.el("account").className).toContain("error");
	expect(p.el("sign").disabled).toBe(true);
	expect(p.el("status").textContent).toContain("does not match");
	expect(p.posts).toHaveLength(0);
});

test("page draws every opaque logo pixel and keeps the review order, dark theme and focus styles", async () => {
	const p = await page();
	const grid = logo.sizes["44"];
	const pixels: {
		x: string;
		y: string;
		width: string;
		height: string;
		fill: string;
	}[] = [];
	grid.rows.forEach((row, y) => {
		Array.from(row).forEach((pixel, x) => {
			if (pixel !== "0")
				pixels.push({
					x: String(x * 4),
					y: String(y * 4),
					width: "4",
					height: "4",
					fill: logo.palette[
						logo.index[pixel as "1" | "2" | "3"] as "sky" | "orange" | "navy"
					],
				});
		});
	});
	expect(
		p.el("logo").children.map((child) => Object.fromEntries(child.attributes)),
	).toEqual(pixels);
	const source = html as unknown as string;
	const ids = [
		"purpose",
		"owner",
		"account",
		"wallet",
		"message",
		"digest",
		"countdown",
		"sign",
		"reject",
	];
	const indexes = ids.map((id) => source.indexOf(`id="${id}"`));
	expect(indexes).toEqual([...indexes].sort((a, b) => a - b));
	for (const text of [
		"It cannot move funds.",
		"This signature authorizes:",
		"prefers-color-scheme: dark",
		":focus-visible",
		"max-width: 420px",
	])
		expect(source).toContain(text);
	expect(source).not.toMatch(/https?:/);
});

test.each([false, true])(
	"copy preserves exact displayed text or typed JSON (typed=%s)",
	async (typed) => {
		const p = await page({ typed });
		await p.el("copy").onclick?.();
		if (!typed && p.signing.message === undefined)
			throw new Error("Expected text fixture");
		expect(p.clipboard).toEqual([
			typed
				? JSON.stringify(p.typedData, null, 2)
				: (p.signing.message as string),
		]);
		expect(p.el("copy-status").textContent).toBe("Copied exact message.");
	},
);
test("copy refusal gives a manual instruction without changing the signing state", async () => {
	const p = await page({ copyError: true });
	await p.el("copy").onclick?.();
	expect(p.el("copy-status").textContent).toContain("Copy failed.");
	expect(p.el("status").getAttribute("data-state")).toBe("ready");
});
test("wallet picker displays data icons and names as nodes, rejects remote icon URLs", async () => {
	const p = await page();
	expect(p.el("wallet").children[0].children[0].src).toBe(
		"data:image/png;base64,fixture",
	);
	expect(p.el("wallet").children[0].children[1].textContent).toBe(
		"Fake wallet",
	);
	expect(p.el("wallet").children[0].getAttribute("aria-pressed")).toBe("true");
	const remote = await page({ icon: "https://attacker.example/track.svg" });
	expect(remote.el("wallet").children[0].children).toHaveLength(1);
});
test("connecting, waiting and accepted states are distinct and terminal state survives expiry", async () => {
	const p = await page({ pause: "personal_sign" });
	await p.el("connect").onclick?.();
	expect(p.states[0]).toBe(
		"Connecting. Choose the expected owner in your wallet.",
	);
	expect(p.el("account").className).toContain("match");
	const signing = p.el("sign").onclick?.();
	await Bun.sleep(0);
	expect(p.el("status").getAttribute("data-state")).toBe("waiting");
	expect(p.el("sign").disabled).toBe(true);
	p.release();
	await signing;
	expect(p.el("status").textContent).toBe("Done. You can close this tab.");
	expect(p.el("sign").disabled).toBe(true);
	expect(p.el("reject").disabled).toBe(true);
	p.advance(20_000);
	p.changeAccount("0x2");
	expect(p.el("status").getAttribute("data-state")).toBe("accepted");
});
test("chain switch names the chain while awaiting wallet approval", async () => {
	const p = await page({ typed: true, pause: "wallet_switchEthereumChain" });
	const connecting = p.el("connect").onclick?.();
	await Bun.sleep(0);
	expect(p.el("status").textContent).toBe(
		"Chain switch needed. Switch to BNB Smart Chain Testnet in your wallet.",
	);
	expect(p.el("sign").disabled).toBe(true);
	p.release();
	await connecting;
});
test("countdown progresses and expiry blocks a late wallet signature", async () => {
	const p = await page({ pause: "personal_sign" });
	expect(p.el("countdown").textContent).toBe("Expires in 0:10");
	p.advance(5_000);
	expect(p.el("expiry").value).toBe(50);
	await p.el("connect").onclick?.();
	const signing = p.el("sign").onclick?.();
	await Bun.sleep(0);
	p.advance(5_000);
	expect(p.el("status").getAttribute("data-state")).toBe("expired");
	expect(p.el("expiry").value).toBe(0);
	p.release();
	await signing;
	expect(p.posts.some((post) => post.path === "/api/signature")).toBe(false);
	expect(p.el("sign").disabled).toBe(true);
});
test.each(["eth_requestAccounts", "personal_sign"])(
	"reject cancels an outstanding %s request",
	async (pause) => {
		const p = await page({ pause });
		let pending = p.el("connect").onclick?.();
		if (pause === "personal_sign") {
			await pending;
			pending = p.el("sign").onclick?.();
		}
		await Bun.sleep(0);
		await p.el("reject").onclick?.();
		p.release();
		await pending;
		expect(p.el("status").getAttribute("data-state")).toBe("rejected");
		expect(p.posts.map((post) => post.path)).not.toContain("/api/signature");
		expect(p.posts.at(-1)?.path).toBe("/api/reject");
	},
);
test("wallet rejection has its own copy and closes the bridge", async () => {
	const p = await page({
		signError: Object.assign(new Error("User refused"), { code: 4001 }),
	});
	await p.el("connect").onclick?.();
	await p.el("sign").onclick?.();
	expect(p.el("status").textContent).toBe(
		"Rejected in wallet. No signature was submitted.",
	);
	expect(p.posts.at(-1)?.path).toBe("/api/reject");
});
test("wallet and bridge errors have explicit copy", async () => {
	const p = await page({ signError: new Error("Wallet disconnected") });
	await p.el("connect").onclick?.();
	await p.el("sign").onclick?.();
	expect(p.el("status").textContent).toBe("Error. Wallet disconnected");
	const broken = await page({ apiError: "Invalid token" });
	expect(broken.el("status").textContent).toBe("Error. Invalid token");
	expect(broken.el("sign").disabled).toBe(true);
	const absent = await page({ noWallet: true });
	await absent.el("connect").onclick?.();
	expect(absent.el("status").textContent).toContain("No wallet found");
});
test("CLI readiness, account and chain changes gate signing", async () => {
	const p = await page({ typed: true, ready: false });
	await p.el("connect").onclick?.();
	expect(p.el("sign").disabled).toBe(true);
	await p.makeReady();
	expect(p.el("sign").disabled).toBe(false);
	p.changeAccount("0x0000000000000000000000000000000000000002");
	expect(p.el("sign").disabled).toBe(true);
	p.changeAccount(owner);
	await Bun.sleep(0);
	expect(p.el("sign").disabled).toBe(false);
	p.changeChain(1);
	expect(p.el("sign").disabled).toBe(true);
	expect(p.el("status").textContent).toContain("BNB Smart Chain Testnet");
});
test("connection-only flow hides signing and never requests a signature", async () => {
	const p = await page({ connectionOnly: true });
	await p.el("connect").onclick?.();
	expect(p.el("sign").hidden).toBe(true);
	expect(p.el("sign").disabled).toBe(true);
	expect(p.el("status").textContent).toContain("No signature requested.");
	expect(p.calls.map((call) => call.method)).toEqual([
		"eth_requestAccounts",
		"eth_chainId",
	]);
});

test("reject is disabled once a signature is sent for verification", async () => {
	const p = await page({ pauseApi: "/api/signature" });
	await p.el("connect").onclick?.();
	const signing = p.el("sign").onclick?.();
	await Bun.sleep(0);
	expect(p.el("reject").disabled).toBe(true);
	await p.el("reject").onclick?.();
	expect(p.posts.map((post) => post.path)).toEqual([
		"/api/account",
		"/api/account",
		"/api/signature",
	]);
	p.release();
	await signing;
	expect(p.el("status").textContent).toBe("Done. You can close this tab.");
});
