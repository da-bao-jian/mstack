import assert from "node:assert/strict";
import { keccak256, stringToHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { walletConnectSigner } from "../src/walletconnect.ts";

// Built by the test with a mocked SDK adapter inside the real worker entrypoint.
const wallet = privateKeyToAccount(`0x${"01".repeat(32)}`);
const message = "Compiled WalletConnect worker fixture, no relay";
const signer = walletConnectSigner(
	{
		id: "p-1",
		owner: wallet.address,
		purpose: message,
		expiresAt: Date.now() + 2000,
		digest: keccak256(stringToHex(message)),
		signing: { type: "text", message },
	},
	{ projectId: "c".repeat(32), onPairing: () => {} },
);
try {
	assert.equal(await signer.address(), wallet.address);
	assert.equal(
		await signer.signMessage({ message }),
		await wallet.signMessage({ message }),
	);
} finally {
	await signer.close();
}
console.log("Compiled worker: exact signature recovered, closed, no relay");
