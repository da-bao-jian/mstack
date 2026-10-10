import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { stringToHex, type TypedDataDefinition } from "viem";
import html from "../src/browser.html" with { type: "text" };

const owner = "0x0000000000000000000000000000000000000001";
class Element {
	textContent = "";
	className = "";
	value = "0";
	disabled = false;
	onclick: (() => Promise<void>) | undefined;
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
	const address = options.mismatch
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
			if (["eth_requestAccounts", "eth_accounts"].includes(req.method))
				return [address];
			if (req.method === "eth_chainId") return `0x${chain.toString(16)}`;
			if (req.method === "wallet_switchEthereumChain") {
				if (options.refuseChain) throw new Error("User refused chain switch");
				chain = 97;
				return null;
			}
			if (["personal_sign", "eth_signTypedData_v4"].includes(req.method))
				return "0xfixture";
			throw new Error(`Unexpected method ${req.method}`);
		},
	};
	const listeners = new Map<string, (event: unknown) => void>();
	const timers: { fn: () => void; delay: number }[] = [];
	const script = (html as unknown as string).match(
		/<script[^>]*>([\s\S]*?)<\/script>/,
	)?.[1];
	if (!script) throw new Error("Missing bundled script");
	runInNewContext(script, {
		document: { getElementById: el, createElement: () => new Element() },
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
				if (event.type === "eip6963:requestProvider" && !options.fallback)
					listeners.get("eip6963:announceProvider")?.({
						detail: { info: { name: "Fake wallet" }, provider },
					});
			},
		},
		setTimeout: (fn: () => void, delay: number) => {
			timers.push({ fn, delay });
		},
		setInterval: () => {},
		fetch: async (path: string, init?: RequestInit) => {
			const post = init?.method === "POST";
			if (post)
				posts.push({
					path: path.split("?")[0],
					body: JSON.parse(String(init.body)),
				});
			return {
				ok: true,
				json: async () =>
					post
						? { ok: true }
						: {
								id: "p-1",
								purpose: "Review exactly",
								owner,
								signing,
								digest: "0xdigest",
								expiresAt: Date.now() + 10_000,
								ready: true,
							},
			};
		},
	});
	await Bun.sleep(0);
	if (options.fallback) timers.find((timer) => timer.delay === 300)?.fn();
	return { el, calls, posts, signing, typedData };
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
	expect(p.el("status").textContent).toBe("User refused chain switch");
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
