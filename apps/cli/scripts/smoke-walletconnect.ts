import { pairingQr, walletConnectSigner } from "@mstack/signers";
import { getAddress, keccak256, stringToHex } from "viem";
import { readConfig } from "../src/config.ts";

if (process.env.MOB_LIVE !== "1")
	throw new Error(
		"Live WalletConnect smoke requires MOB_LIVE=1 and a mobile wallet. No relay contacted.",
	);
const config = await readConfig();
if (!config.owner || !config.walletconnect_project_id)
	throw new Error(
		"Set owner and walletconnect_project_id with mob config before the live smoke.",
	);
const message = `mstack WalletConnect connection test: owner=${config.owner} nonce=${crypto.randomUUID()}. This is a test message, not a trade.`;
const view = {
	id: "p-1",
	purpose: "Live WalletConnect smoke; no Mobius or venue submission",
	owner: getAddress(config.owner),
	expiresAt: Date.now() + 60_000,
	digest: keccak256(stringToHex(message)),
	signing: { type: "text" as const, message },
};
console.log(
	`${view.purpose}\nOwner: ${view.owner}\nMessage: ${message}\nDigest: ${view.digest}\nExpires: ${new Date(view.expiresAt).toISOString()}`,
);
const signer = walletConnectSigner(view, {
	projectId: config.walletconnect_project_id,
	onPairing: (uri) =>
		console.log(
			`${pairingQr(uri)}\n${uri}\nScan and approve the test message within 60 seconds.`,
		),
});
try {
	console.log(
		`Connected owner: ${await signer.address()}; chain: ${await signer.chainId?.()}`,
	);
	await signer.signMessage({ message });
	console.log(
		"Signature recovered to the expected owner. No mutation was submitted.",
	);
} finally {
	await signer.close();
}
