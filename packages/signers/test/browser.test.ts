import { expect, test } from "bun:test";
import {
	hashTypedData,
	keccak256,
	stringToHex,
	type TypedDataDefinition,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { browserSigner } from "../src/browser.ts";
import { deferred, type SigningView } from "../src/interactive.ts";
import { loopback } from "./loopback.ts";

const wallet = privateKeyToAccount(generatePrivateKey());
const stranger = privateKeyToAccount(generatePrivateKey());
const typedData: TypedDataDefinition = {
	domain: { name: "mstack test", version: "1", chainId: 97 },
	types: { Test: [{ name: "purpose", type: "string" }] },
	primaryType: "Test",
	message: { purpose: "Only a fixture" },
};
function view(typed = false): SigningView {
	const message = "Exact UTF-8 🦊 café 1e-7";
	return {
		id: "p-1",
		purpose: "Browser fixture",
		owner: wallet.address,
		expiresAt: Date.now() + 10_000,
		signing: typed ? { type: "typed", typedData } : { type: "text", message },
		digest: typed ? hashTypedData(typedData) : keccak256(stringToHex(message)),
	};
}
async function harness(proposal = view()) {
	const opened = deferred<string>();
	const signer = browserSigner(proposal, {
		openUrl: async (url) => {
			opened.resolve(url);
		},
	});
	const account = signer.address();
	void account.catch(() => {});
	const url = new URL(await opened.promise);
	const api = (
		path: string,
		body?: unknown,
		overrides: { token?: string; origin?: string } = {},
	) =>
		loopback(
			`${url.origin}${path}?t=${overrides.token ?? url.searchParams.get("t")}`,
			body === undefined
				? {}
				: {
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							Origin: overrides.origin ?? url.origin,
						},
						body: JSON.stringify(body),
					},
		);
	return { signer, account, url, api, proposal };
}
test.each([false, true])(
	"browser accepts exact bytes and recovers owner (typed=%s)",
	async (typed) => {
		const h = await harness(view(typed));
		try {
			expect(
				(await h.api("/api/account", { address: wallet.address, chainId: 97 }))
					.status,
			).toBe(200);
			expect(await h.account).toBe(wallet.address);
			expect(await h.signer.chainId?.()).toBe(97);
			const signature = typed
				? await wallet.signTypedData(typedData)
				: await wallet.signMessage({
						message: (h.proposal.signing as { message: string }).message,
					});
			expect(
				(await h.api("/api/signature", { address: wallet.address, signature }))
					.status,
			).toBe(409);
			const pending = typed
				? h.signer.signTypedData(typedData)
				: h.signer.signMessage({
						message: (h.proposal.signing as { message: string }).message,
					});
			expect((await (await h.api("/api/proposal")).json()).ready).toBe(true);
			const posts = await Promise.allSettled([
				h.api("/api/signature", { address: wallet.address, signature }),
				h.api("/api/signature", { address: wallet.address, signature }),
			]);
			expect(
				posts.filter((p) => p.status === "fulfilled" && p.value.status === 200),
			).toHaveLength(1);
			expect(
				posts.some((p) => p.status === "rejected" || p.value.status === 409),
			).toBe(true);
			expect(await pending).toBe(signature);
			await expect(h.signer.signMessage({ message: "again" })).rejects.toThrow(
				"completed",
			);
			await expect(loopback(h.url)).rejects.toThrow();
		} finally {
			await h.signer.close();
		}
	},
);
test("browser rejects wrong token, Origin, account, recovered signer, and malformed input without consuming token", async () => {
	const h = await harness();
	try {
		expect((await loopback(`${h.url.origin}/api/proposal`)).status).toBe(403);
		expect(
			(await h.api("/api/proposal", undefined, { token: "a".repeat(64) }))
				.status,
		).toBe(403);
		expect(
			(await h.api("/api/proposal", undefined, { token: "é".repeat(64) }))
				.status,
		).toBe(403);
		const body = { address: wallet.address, chainId: 1 };
		expect(
			(
				await h.api("/api/account", body, {
					origin: "https://untrusted.invalid",
				})
			).status,
		).toBe(403);
		expect(
			(
				await loopback(
					`${h.url.origin}/api/account?t=${h.url.searchParams.get("t")}`,
					{
						method: "POST",
						body: JSON.stringify(body),
						headers: { "Content-Type": "application/json" },
					},
				)
			).status,
		).toBe(403);
		expect(
			(await h.api("/api/account", { ...body, address: stranger.address }))
				.status,
		).toBe(403);
		expect((await h.api("/api/account", body)).status).toBe(200);
		await h.account;
		const message = (h.proposal.signing as { message: string }).message;
		const pending = h.signer.signMessage({ message });
		const signature = await wallet.signMessage({ message });
		expect(
			(await h.api("/api/signature", { address: stranger.address, signature }))
				.status,
		).toBe(403);
		expect(
			(
				await h.api("/api/signature", {
					address: wallet.address,
					signature: await stranger.signMessage({ message }),
				})
			).status,
		).toBe(400);
		expect(
			(
				await h.api(
					"/api/signature",
					{ address: wallet.address, signature },
					{ token: "bad" },
				)
			).status,
		).toBe(403);
		expect(
			(
				await h.api(
					"/api/signature",
					{ address: wallet.address, signature },
					{ origin: "null" },
				)
			).status,
		).toBe(403);
		expect(
			(
				await h.api("/api/signature", {
					address: wallet.address,
					signature: "0x00",
				})
			).status,
		).toBe(400);
		expect(
			(await h.api("/api/signature", { address: wallet.address, signature }))
				.status,
		).toBe(200);
		expect(await pending).toBe(signature);
	} finally {
		await h.signer.close();
	}
});
test("browser refuses changed payload and pinned-chain mismatch", async () => {
	const h = await harness(view(true));
	try {
		await h.api("/api/account", { address: wallet.address, chainId: 1 });
		await h.account;
		await expect(
			h.signer.signTypedData({ ...typedData, message: { purpose: "changed" } }),
		).rejects.toThrow("differs");
		const pending = h.signer.signTypedData(typedData);
		const body = {
			address: wallet.address,
			signature: await wallet.signTypedData(typedData),
		};
		expect((await h.api("/api/signature", body)).status).toBe(409);
		await h.api("/api/account", { address: wallet.address, chainId: 97 });
		expect((await h.api("/api/signature", body)).status).toBe(200);
		expect(await pending).toBe(body.signature);
	} finally {
		await h.signer.close();
	}
});
test("browser expires, closes listener, and fails pending sign", async () => {
	const h = await harness({ ...view(), expiresAt: Date.now() + 200 });
	await h.api("/api/account", { address: wallet.address, chainId: 1 });
	await h.account;
	const pending = h.signer.signMessage({
		message: (h.proposal.signing as { message: string }).message,
	});
	await expect(pending).rejects.toThrow("Proposal expired");
	await expect(loopback(h.url)).rejects.toThrow();
	await h.signer.close();
});
test("browser rejection and opener errors close pending handshakes", async () => {
	const h = await harness();
	expect((await h.api("/api/reject", {})).status).toBe(200);
	await expect(h.account).rejects.toThrow("rejected");
	await expect(loopback(h.url)).rejects.toThrow();
	const signer = browserSigner(view(), {
		openUrl: async () => {
			throw new Error("not installed");
		},
	});
	await expect(signer.address()).rejects.toThrow(
		"Cannot open browser: not installed",
	);
	await signer.close();
});
test("browser serves only authenticated self-contained HTML with nonce CSP", async () => {
	const h = await harness();
	try {
		const response = await loopback(h.url);
		const html = await response.text();
		const csp = response.headers.get("Content-Security-Policy") ?? "";
		expect(csp).toContain("default-src 'none'");
		expect(csp).toContain("connect-src 'self'");
		expect(csp).toContain("img-src data:;");
		expect(csp).not.toMatch(/https?:|unsafe-inline|unsafe-eval/);
		const nonce = csp.match(/script-src 'nonce-([^']+)'/)?.[1];
		expect(nonce).toBeTruthy();
		expect(csp).toContain(`style-src 'nonce-${nonce}'`);
		expect(html).toContain(`<script nonce="${nonce}">`);
		expect(html).not.toMatch(/https?:\/\//i);
		expect(html).not.toContain("wallet_addEthereumChain");
		expect(html).toContain("eip6963:requestProvider");
		expect(html).toContain("eip6963:announceProvider");
		expect(html).toContain("compare with your terminal");
		expect(response.headers.get("Cache-Control")).toBe("no-store");
		expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
	} finally {
		await h.signer.close();
	}
});
