import { expect, test } from "bun:test";
import {
	ApiRateLimited,
	bindingMessage,
	preparePayload,
	readPayload,
	StrategyApiClient,
} from "../src/index.ts";
import { fakeStrategyApi, loopbackFetch } from "./fake-api.ts";

test("fake Strategy API models task idempotency, rate limiting, and binding recovery", async () => {
	const fake = fakeStrategyApi();
	try {
		const client = new StrategyApiClient({
			base: fake.base,
			key: fake.key,
			version: "0.3.0",
			fetch: loopbackFetch,
		});
		const create = {
			longVenue: "hl" as const,
			shortVenue: "lighter" as const,
			longMarket: "ETH",
			shortMarket: "ETH",
			sizeUsd: 1000,
		};
		const first = await client.createTask(create, { idempotencyKey: "p-1" });
		const replay = await client.createTask(create, { idempotencyKey: "p-1" });
		expect(replay.taskId).toBe(first.taskId);
		expect((await client.getTask(first.taskId)).status).toBe("running");

		fake.rateLimitNext();
		try {
			await client.listTasks();
			throw new Error("expected 429");
		} catch (error) {
			expect(error).toBeInstanceOf(ApiRateLimited);
			expect((error as ApiRateLimited).retryAfterSeconds).toBe(3);
		}

		const expiresAt = Math.floor(Date.now() / 1000) + 240;
		const payload = preparePayload({
			owner: fake.owner.address,
			venues: [{ venue: "hl" as const }],
			nonce: "abcdefghijklmnop",
			expiresAt,
		});
		const signature = await fake.owner.signMessage({
			message: bindingMessage("prepare", payload),
		});
		const prepared = await client.prepareVenueBindings(
			{
				owner: payload.owner,
				venues: payload.venues,
				authorization: { nonce: payload.nonce, expiresAt, signature },
			},
			{ idempotencyKey: "c-1-prepare" },
		);
		const signatures = await Promise.all(
			prepared.signRequests.map(async (request) => ({
				requestId: request.requestId,
				signature:
					request.method === "personal_sign"
						? await fake.owner.signMessage({
								message: (request.payload as { message: string }).message,
							})
						: await fake.owner.signTypedData(
								request.payload as Parameters<
									typeof fake.owner.signTypedData
								>[0],
							),
			})),
		);
		await client.submitVenueBindings(
			prepared.bindingId,
			{ signatures },
			{ idempotencyKey: "c-1" },
		);
		const read = readPayload({
			owner: fake.owner.address,
			bindingId: prepared.bindingId,
			expiresAt,
		});
		const readSignature = await fake.owner.signMessage({
			message: bindingMessage("read", read),
		});
		const confirming = await client.getVenueBinding(prepared.bindingId, {
			owner: read.owner,
			expiresAt,
			signature: readSignature,
		});
		expect(confirming.results[0]?.status).toBe("confirming");
		const bound = await client.getVenueBinding(prepared.bindingId, {
			owner: read.owner,
			expiresAt,
			signature: readSignature,
		});
		expect(bound.status).toBe("bound");
	} finally {
		fake.stop();
	}
});
