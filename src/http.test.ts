import { McpServer } from "@modelcontextprotocol/server";
import { afterEach, describe, expect, it } from "bun:test";
import { serveHttp } from "./http";

const token = "a-sufficiently-long-token";
const factory = () => new McpServer({ name: "t", version: "0" });
const initialize = {
	jsonrpc: "2.0",
	id: 1,
	method: "initialize",
	params: {
		protocolVersion: "2026-07-28",
		capabilities: {},
		clientInfo: { name: "test", version: "0" },
	},
};
const noop = async () => {};

describe("serveHttp", () => {
	let close: () => Promise<void> = noop;
	afterEach(() => close());

	it("requires the bearer token on every path and serves only /mcp", async () => {
		const http = serveHttp(factory, { port: 0, host: "127.0.0.1", token });
		close = http.close;
		const post = (path: string, headers: Record<string, string>) =>
			fetch(new URL(path, http.url), {
				method: "POST",
				headers: {
					"content-type": "application/json",
					accept: "application/json, text/event-stream",
					...headers,
				},
				body: JSON.stringify(initialize),
			});

		const anonymous = await post("/mcp", {});
		expect(anonymous.status).toBe(401);
		expect(anonymous.headers.get("www-authenticate")).toBe("Bearer");
		expect(
			(
				await post("/mcp", {
					authorization: `Bearer ${token.replace("a", "b")}`,
				})
			).status,
		).toBe(401);
		expect((await post("/mcp", { authorization: "Bearer short" })).status).toBe(
			401,
		);
		expect((await post("/mcp", { authorization: token })).status).toBe(401);
		expect((await post("/health", {})).status).toBe(401);
		expect(
			(await post("/other", { authorization: `Bearer ${token}` })).status,
		).toBe(404);

		const ok = await post("/mcp", { authorization: `bearer ${token}` });
		expect(ok.status).toBe(200);
		expect(await ok.text()).toContain('"serverInfo"');
	});
});
