import { type Address, getAddress, type Hex, stringToHex } from "viem";
import {
	checkedView,
	pinnedChain,
	type SigningView,
	verifySignature,
} from "./interactive.ts";
import {
	createWalletConnectClient,
	type WalletConnectClient,
	type WalletConnectFactory,
} from "./walletconnect-client.ts";

export interface WalletConnectCeremonyOptions {
	projectId: string;
	onPairing: (uri: string) => void;
	createClient?: WalletConnectFactory;
	now?: () => number;
}

/** One WalletConnect pairing with one explicit request for each ceremony card. */
export function walletConnectCeremonySigner(
	id: string,
	ownerInput: Address,
	expiresAt: number,
	options: WalletConnectCeremonyOptions,
) {
	if (!/^c-[1-9]\d*$/.test(id)) throw new Error("Invalid ceremony id");
	if (!/^[a-f0-9]{32}$/i.test(options.projectId))
		throw new Error("Set walletconnect_project_id before using walletconnect");
	const owner = getAddress(ownerInput);
	const now = options.now ?? Date.now;
	const abort = new AbortController();
	let client: WalletConnectClient | undefined;
	let topic: string | undefined;
	let connection: Promise<Address> | undefined;
	let ended = false;
	const chains = ["eip155:1", "eip155:56", "eip155:42161"];
	const methods = ["personal_sign", "eth_signTypedData_v4"];
	function alive() {
		if (ended) throw new Error("WalletConnect ceremony session is closed");
		if (now() >= expiresAt)
			throw new Error(
				"Ceremony expired while waiting for WalletConnect wallet",
			);
	}
	function account(chain: number): Address {
		if (!client || !topic)
			throw new Error("WalletConnect session is not connected");
		const session = client.session.get(topic);
		if (!Number.isSafeInteger(session.expiry) || session.expiry * 1000 <= now())
			throw new Error("WalletConnect session expired");
		const namespace = session.namespaces.eip155;
		if (
			!namespace ||
			!methods.every((method) => namespace.methods.includes(method))
		)
			throw new Error(
				"WalletConnect session does not authorize ceremony methods",
			);
		const expected = `eip155:${chain}:${owner}`.toLowerCase();
		if (!namespace.accounts.some((item) => item.toLowerCase() === expected))
			throw new Error(
				"WalletConnect session does not authorize the signing chain",
			);
		if (
			namespace.accounts.some((item) => {
				const match = /^eip155:[1-9]\d*:(0x[\da-f]{40})$/i.exec(item);
				return !match || getAddress(match[1]) !== owner;
			})
		)
			throw new Error(
				"WalletConnect session account does not match ceremony owner",
			);
		return owner;
	}
	function connect() {
		alive();
		if (connection) return connection;
		connection = (async () => {
			client = await (options.createClient ?? createWalletConnectClient)(
				options.projectId,
				abort.signal,
			);
			const pairing = await client.connect({
				requiredNamespaces: {
					eip155: {
						chains,
						methods,
						events: ["accountsChanged", "chainChanged"],
					},
				},
			});
			if (!pairing.uri || !/^wc:[a-f0-9]+@2\?/.test(pairing.uri))
				throw new Error("WalletConnect did not return a v2 pairing URI");
			options.onPairing(pairing.uri);
			const session = await pairing.approval();
			topic = session.topic;
			return account(1);
		})();
		return connection;
	}
	async function sign(input: SigningView): Promise<Hex> {
		alive();
		if (!input.id.startsWith(`${id}:`))
			throw new Error("Signing step does not belong to ceremony");
		const compatible = { ...input, id: "p-1" };
		checkedView(compatible);
		await connect();
		if (!client || !topic)
			throw new Error("WalletConnect session is not connected");
		const chain = pinnedChain(input) ?? 1;
		const address = account(chain);
		const method =
			input.signing.type === "text" ? "personal_sign" : "eth_signTypedData_v4";
		const params =
			input.signing.type === "text"
				? [stringToHex(input.signing.message), address]
				: [address, JSON.stringify(input.signing.typedData)];
		const signature = await client.request({
			topic,
			chainId: `eip155:${chain}`,
			request: { method, params },
		});
		return verifySignature(input, address, signature);
	}
	return {
		address: connect,
		sign,
		async close() {
			if (ended) return;
			ended = true;
			abort.abort(new Error("WalletConnect ceremony closed"));
			await client?.close();
		},
	};
}
