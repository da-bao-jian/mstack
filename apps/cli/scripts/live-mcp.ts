import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
	getDefaultEnvironment,
	StdioClientTransport,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import pkg from "../package.json";
import type { scan } from "../src/commands/scan.ts";
import { footer, renderScan } from "../src/render.ts";

if (process.env.MOB_LIVE !== "1")
	throw new Error("Live MCP requests require MOB_LIVE=1");

const home = await mkdtemp(join(tmpdir(), "mob-live-mcp-"));
const transport = new StdioClientTransport({
	command: fileURLToPath(new URL("../dist/mob", import.meta.url)),
	args: ["mcp"],
	cwd: home,
	env: { ...getDefaultEnvironment(), MOB_HOME: home },
	stderr: "pipe",
});
const client = new Client({
	name: "mobstack-live-smoke",
	version: pkg.version,
});
let stderr = "";
transport.stderr?.on("data", (chunk) => {
	stderr += String(chunk);
});

async function call(name: string, args: Record<string, unknown>) {
	console.log(`$ ${name} ${JSON.stringify(args)}`);
	const start = performance.now();
	const result = (await client.callTool({ name, arguments: args }, undefined, {
		timeout: 65_000,
	})) as CallToolResult;
	if (result.content.length !== 1 || result.content[0].type !== "text")
		throw new Error("Expected one text result");
	const text = result.content[0].text;
	if (result.isError) throw new Error(text);
	return { text, wall: ((performance.now() - start) / 1000).toFixed(2) };
}

try {
	await client.connect(transport);
	console.log("$ tools/list");
	console.log((await client.listTools()).tools.map((t) => t.name).join("\n"));
	const scanResult = await call("funding_scan", { sizeUsd: 1000, top: 3 });
	const data = JSON.parse(scanResult.text) as Awaited<ReturnType<typeof scan>>;
	console.log(
		`Bounded result: ${data.counts.rates} rates, ${data.counts.opportunities} opportunities, ${data.counts.qualifying} qualifying; ${scanResult.text.length} JSON characters, ${Buffer.byteLength(scanResult.text)} UTF-8 bytes. Views rendered below.`,
	);
	console.log(renderScan(data.view, false, data.holdDays));
	console.log(
		`${footer(data, data.unmatched.length, Date.now())} | thin hidden: ${data.counts.thinHidden}`,
	);
	console.log(`isError=false wall=${scanResult.wall}s\n`);
	if (Object.hasOwn(data, "opportunities"))
		throw new Error("Default scan leaked the full opportunities array");
	if (Buffer.byteLength(scanResult.text) >= 100_000)
		throw new Error("Default scan payload exceeds 100 KB");
	if (!data.counts.opportunities || data.failed.length)
		throw new Error("Live scan is empty or returned venue failures");
	const explanation = await call("explain", { topic: "funding", simple: true });
	console.log(explanation.text);
	console.log(`isError=false wall=${explanation.wall}s`);
	if (stderr) throw new Error(`Unexpected server stderr: ${stderr}`);
	console.log(
		"server stderr: empty; stdout contains only MCP protocol messages",
	);
} finally {
	await client.close();
	await rm(home, { recursive: true, force: true });
}
