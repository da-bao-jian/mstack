import {
	type Address,
	getAddress,
	type Hex,
	hashTypedData,
	keccak256,
	recoverMessageAddress,
	recoverTypedDataAddress,
	stringToHex,
	type TypedDataDefinition,
} from "viem";
import type { Signer } from "./index.ts";

/** The immutable, public subset of a Proposal. No private key or submit capability. */
export interface SigningView {
	id: string;
	purpose: string;
	owner: Address;
	expiresAt: number;
	digest: Hex;
	signing:
		| { type: "text"; message: string }
		| { type: "typed"; typedData: TypedDataDefinition };
}
export interface InteractiveSigner extends Signer {
	close(): Promise<void>;
}
export function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	// A terminal event can occur before a consumer asks for this part of the handshake.
	void promise.catch(() => {});
	return { promise, resolve, reject };
}
export function pinnedChain(view: SigningView): number | undefined {
	const value =
		view.signing.type === "typed"
			? view.signing.typedData.domain?.chainId
			: undefined;
	if (value === undefined) return undefined;
	const chain = Number(value);
	if (!Number.isSafeInteger(chain) || chain <= 0)
		throw new Error("Invalid signing chainId");
	return chain;
}
export function checkedView(
	input: SigningView,
	connectionOnly = false,
): SigningView {
	const view = structuredClone({
		id: input.id,
		purpose: input.purpose,
		owner: input.owner,
		expiresAt: input.expiresAt,
		digest: input.digest,
		signing: input.signing,
	});
	getAddress(view.owner);
	if (
		!(connectionOnly
			? view.id === "wallet-connection"
			: /^p-[1-9]\d*$/.test(view.id)) ||
		!Number.isSafeInteger(view.expiresAt)
	)
		throw new Error("Invalid signing Proposal");
	const digest =
		view.signing.type === "text"
			? keccak256(stringToHex(view.signing.message))
			: hashTypedData(view.signing.typedData);
	if (digest !== view.digest) throw new Error("Proposal digest mismatch");
	pinnedChain(view);
	return view;
}
export function assertPayload(
	view: SigningView,
	payload: SigningView["signing"],
) {
	if (
		payload.type !== view.signing.type ||
		(payload.type === "text"
			? payload.message !== (view.signing as { message: string }).message
			: hashTypedData(payload.typedData) !== view.digest)
	)
		throw new Error("Signing payload differs from displayed Proposal");
}
export async function verifySignature(
	view: SigningView,
	address: unknown,
	signature: unknown,
): Promise<Hex> {
	if (
		typeof address !== "string" ||
		getAddress(address) !== getAddress(view.owner)
	)
		throw new Error("Wallet account does not match owner");
	if (typeof signature !== "string" || !/^0x[\da-f]{130}$/i.test(signature))
		throw new Error("Invalid signature");
	const sig = signature as Hex;
	const recovered =
		view.signing.type === "text"
			? await recoverMessageAddress({
					message: view.signing.message,
					signature: sig,
				})
			: await recoverTypedDataAddress({
					...view.signing.typedData,
					signature: sig,
				});
	if (getAddress(recovered) !== getAddress(view.owner))
		throw new Error("Signature does not recover Proposal owner");
	return sig;
}
