import { privateKeyToAccount } from "viem/accounts";
import type {
	WorkerAnswer,
	WorkerCommand,
} from "../src/walletconnect-client.ts";
import { fakeWalletConnect } from "./fake-walletconnect-client.ts";

// Scripted sign-client, no relay. Deliberately retains a timer even after close.
setInterval(() => {}, 60_000);
const fake = fakeWalletConnect(privateKeyToAccount(`0x${"01".repeat(32)}`));
let mode = "";
const reply = (message: WorkerAnswer) => self.postMessage(message);
self.onmessage = async ({ data }: MessageEvent<WorkerCommand>) => {
	if (data.method === "init") mode = data.params.projectId[0];
	if (
		(data.method === "init" && mode === "a") ||
		(data.method === "approval" && mode === "d") ||
		(data.method === "request" && mode === "e") ||
		(data.method === "close" && mode === "f")
	)
		return;
	if (data.method === "init") reply({ id: data.id });
	else if (data.method === "close") reply({ id: data.id });
	else if (data.method === "connect") {
		const { uri } = await fake.client.connect(data.params);
		reply({ id: data.id, result: { uri } });
	} else if (data.method === "approval") {
		reply({ id: data.id, result: fake.session, session: fake.session });
	} else {
		const result = await fake.client.request(data.params);
		reply({ id: data.id, result, session: fake.session });
	}
};
