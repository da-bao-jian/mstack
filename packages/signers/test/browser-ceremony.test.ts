import { expect, test } from "bun:test";
import { Script } from "node:vm";
import {
	hashTypedData,
	keccak256,
	stringToHex,
	type TypedDataDefinition,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { browserCeremonySigner } from "../src/browser-ceremony.ts";
import { deferred, pinnedChain, type SigningView } from "../src/interactive.ts";
import { loopback } from "./loopback.ts";

const wallet = privateKeyToAccount(`0x${"04".repeat(32)}`);
const expiresAt = Date.now() + 30_000;

function text(id: string, message: string): SigningView {
	return {
		id,
		owner: wallet.address,
		purpose: message,
		expiresAt,
		signing: { type: "text", message },
		digest: keccak256(stringToHex(message)),
	};
}

function typed(id: string, purpose: string, chainId: number): SigningView {
	const typedData: TypedDataDefinition = {
		domain: { name: "mstack ceremony", version: "1", chainId },
		types: { Bind: [{ name: "purpose", type: "string" }] },
		primaryType: "Bind",
		message: { purpose },
	};
	return {
		id,
		owner: wallet.address,
		purpose,
		expiresAt,
		signing: { type: "typed", typedData },
		digest: hashTypedData(typedData),
	};
}

function apiFor(url: string) {
	const target = new URL(url);
	return (path: string, body?: unknown) =>
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
}

test("browser ceremony signs five displayed steps in one wallet session with chain switches", async () => {
	const steps = [
		text("c-1:prepare", "prepare"),
		typed("c-1:hl-agent", "HL agent", 42161),
		typed("c-1:hl-fee", "HL fee", 42161),
		typed("c-1:aster", "Aster", 56),
		text("c-1:read", "read"),
	];
	const opened = deferred<string>();
	const session = browserCeremonySigner("c-1", wallet.address, expiresAt, {
		openUrl: async (url) => opened.resolve(url),
	});
	session.addSteps(steps);
	const address = session.address();
	const url = await opened.promise;
	const page = await loopback(url);
	expect(page.status).toBe(200);
	expect(page.headers.get("content-security-policy")).toContain("nonce-");
	const html = await page.text();
	expect(html).toContain("Ceremony steps");
	expect(html).toContain("stepId: proposal.id");
	expect(html).toContain("wallet_switchEthereumChain");
	const source = html.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1];
	expect(source).toBeDefined();
	expect(() => new Script(source as string)).not.toThrow();
	const api = apiFor(url);
	const chains: number[] = [];
	for (const step of steps) {
		const pending = session.sign(step);
		const view = (await (await api("/api/proposal")).json()) as SigningView & {
			steps: { id: string; digest: string; status: string }[];
		};
		expect(view.id).toBe(step.id);
		expect(view.digest).toBe(step.digest);
		expect(view.steps.find((item) => item.id === step.id)?.digest).toBe(
			step.digest,
		);
		const chainId = pinnedChain(step) ?? 1;
		chains.push(chainId);
		expect(
			(
				await api("/api/account", {
					address: wallet.address,
					chainId,
				})
			).status,
		).toBe(200);
		const signature =
			step.signing.type === "text"
				? await wallet.signMessage({ message: step.signing.message })
				: await wallet.signTypedData(step.signing.typedData);
		expect(
			(
				await api("/api/signature", {
					stepId: step.id,
					address: wallet.address,
					signature,
				})
			).status,
		).toBe(200);
		expect(await pending).toBe(signature);
	}
	expect(await address).toBe(wallet.address);
	expect(chains).toEqual([1, 42161, 42161, 56, 1]);
	const final = (await (await api("/api/proposal")).json()) as {
		steps: { status: string }[];
	};
	expect(final.steps.every((step) => step.status === "signed")).toBe(true);
	await session.close();
});

test("browser ceremony rejection ends the session and leaves later steps unsigned", async () => {
	const steps = [
		text("c-2:one", "one"),
		text("c-2:two", "two"),
		text("c-2:three", "three"),
	];
	const opened = deferred<string>();
	const session = browserCeremonySigner("c-2", wallet.address, expiresAt, {
		openUrl: async (url) => opened.resolve(url),
	});
	session.addSteps(steps);
	void session.address().catch(() => {});
	const api = apiFor(await opened.promise);
	const first = session.sign(steps[0]);
	await api("/api/account", { address: wallet.address, chainId: 1 });
	await api("/api/signature", {
		stepId: steps[0].id,
		address: wallet.address,
		signature: await wallet.signMessage({ message: "one" }),
	});
	await first;
	const middle = session.sign(steps[1]);
	const rejected = middle.catch((error) => error as Error);
	expect((await api("/api/reject", { stepId: steps[1].id })).status).toBe(200);
	const rejection = await rejected;
	expect(rejection).toBeInstanceOf(Error);
	expect((rejection as Error).message).toContain("rejected");
	await expect(session.sign(steps[2])).rejects.toThrow("rejected");
	await session.close();
});
