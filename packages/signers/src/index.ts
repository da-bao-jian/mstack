import type { Address, Hex, SignableMessage, TypedDataDefinition } from "viem";
export interface Signer {
	close?(): Promise<void>;
	address(): Promise<Address>;
	chainId?(): Promise<number>;
	signMessage(args: { message: SignableMessage }): Promise<Hex>;
	signTypedData(args: TypedDataDefinition): Promise<Hex>;
}
export { type BrowserOptions, browserSigner } from "./browser.ts";
export type { InteractiveSigner, SigningView } from "./interactive.ts";
export {
	createKeystore,
	importKeystore,
	listKeystores,
	unlockKeystore,
} from "./keystore.ts";
export { openUrl } from "./open-url.ts";
export { readSecretFromTty, type SecretReader } from "./tty.ts";
export { walletConnectSigner } from "./walletconnect.ts";
export type { WalletConnectFactory } from "./walletconnect-client.ts";
export { pairingQr } from "./walletconnect-qr.ts";
