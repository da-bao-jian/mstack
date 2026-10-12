import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { strategyRoutes } from "../src/index.ts";
import spec from "../src/openapi-1.2.0.json";

test("pins the upstream OpenAPI 1.2.0 document", async () => {
	const bytes = await Bun.file(
		new URL("../src/openapi-1.2.0.json", import.meta.url),
	).arrayBuffer();
	expect(createHash("sha256").update(new Uint8Array(bytes)).digest("hex")).toBe(
		"70d93aa94a4def1843b4ecf638097db333c036639d66101cc7894738d548aa0e",
	);
});

test("typed route table matches OpenAPI methods, headers, body fields and response codes", () => {
	type Parameter = {
		$ref?: string;
		in?: string;
		name?: string;
		required?: boolean;
	};
	for (const route of strategyRoutes) {
		const pathItem = (spec.paths as Record<string, Record<string, unknown>>)[
			route.path
		];
		const operation = pathItem?.[route.method.toLowerCase()] as
			| {
					parameters?: Parameter[];
					requestBody?: {
						content: {
							"application/json": {
								schema: { $ref?: string; properties?: Record<string, unknown> };
							};
						};
					};
					responses: Record<string, unknown>;
					security?: unknown[];
			  }
			| undefined;
		expect(operation, `${route.method} ${route.path}`).toBeDefined();
		const parameters = [
			...((pathItem?.parameters as Parameter[] | undefined) ?? []),
			...(operation?.parameters ?? []),
		];
		const headers = parameters
			.filter((item) => item.in === "header" && item.required)
			.map((item) => item.name);
		for (const item of parameters.filter((item) => item.$ref)) {
			const name = item.$ref?.split("/").at(-1);
			const parameter = (
				spec.components.parameters as Record<
					string,
					{ in: string; name: string; required?: boolean }
				>
			)[String(name)];
			if (parameter.in === "header" && parameter.required)
				headers.push(parameter.name);
		}
		if ((operation?.security ?? spec.security).length)
			headers.push("Authorization");
		expect(headers.sort()).toEqual([...route.requiredHeaders].sort());
		let schema = operation?.requestBody?.content["application/json"].schema;
		if (schema?.$ref)
			schema = (spec.components.schemas as Record<string, typeof schema>)[
				schema.$ref.split("/").at(-1) as string
			];
		expect(Object.keys(schema?.properties ?? {}).sort()).toEqual(
			[...route.bodyProperties].sort(),
		);
		expect(
			Object.keys(operation?.responses ?? {})
				.map(Number)
				.sort((a, b) => a - b),
		).toEqual([...route.responses]);
	}
});
