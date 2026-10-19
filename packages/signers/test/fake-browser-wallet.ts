import assert from "node:assert/strict";
import type { PrivateKeyAccount } from "viem";
import { pinnedChain, type SigningView } from "../src/interactive.ts";
import { openBridge } from "./loopback.ts";

/** Scripted wallet over the real bridge HTTP API; no browser or extension. */
export async function fakeBrowserWallet(
	url: string,
	wallet: PrivateKeyAccount,
	beforeSign?: () => Promise<void>,
) {
	const { page, api } = await openBridge(url);
	assert.equal(page.status, 200);
	assert.ok(page.headers.get("Content-Security-Policy"));
	let view = (await (await api("/api/proposal")).json()) as SigningView & {
		ready: boolean;
		connectionOnly?: boolean;
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
	if (view.connectionOnly) return;
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
