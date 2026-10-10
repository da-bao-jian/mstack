import type { Address, Hex, SignableMessage, TypedDataDefinition } from "viem";
export interface Signer {
	address(): Promise<Address>;
	signMessage(args: { message: SignableMessage }): Promise<Hex>;
	signTypedData(args: TypedDataDefinition): Promise<Hex>;
}
export {
	createKeystore,
	importKeystore,
	listKeystores,
	unlockKeystore,
} from "./keystore.ts";
export { readSecretFromTty, type SecretReader } from "./tty.ts";
