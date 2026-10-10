import assert from "node:assert/strict";
import type { PrivateKeyAccount } from "viem";
import { pinnedChain, type SigningView } from "../src/interactive.ts";
import { loopback } from "./loopback.ts";

/** Scripted wallet over the real bridge HTTP API; no browser or extension. */
export async function fakeBrowserWallet(
	url: string,
	wallet: PrivateKeyAccount,
	beforeSign?: () => Promise<void>,
) {
	const target = new URL(url);
	const api = (path: string, body?: unknown) =>
		loopback(
			`${target.origin}${path}?${target.searchParams}`,
			body === undefined
				? {}
				: {
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							Origin: target.origin,
						},
						body: JSON.stringify(body),
					},
		);
	const page = await loopback(url);
	assert.equal(page.status, 200);
	assert.ok(page.headers.get("Content-Security-Policy"));
	let view = (await (await api("/api/proposal")).json()) as SigningView & {
		ready: boolean;
	};
	assert.equal(
		(
			await api("/api/account", {
				address: wallet.address,
				chainId: pinnedChain(view) ?? 1,
			})
		).status,
		200,
	);
	while (!view.ready) {
		if (Date.now() >= view.expiresAt) throw new Error("Fake wallet expired");
		await Bun.sleep(10);
		view = (await (await api("/api/proposal")).json()) as typeof view;
	}
	await beforeSign?.();
	const signature =
		view.signing.type === "text"
			? await wallet.signMessage({ message: view.signing.message })
			: await wallet.signTypedData(view.signing.typedData);
	const accepted = await api("/api/signature", {
		address: wallet.address,
		signature,
	});
	assert.equal(accepted.status, 200, await accepted.text());
}
