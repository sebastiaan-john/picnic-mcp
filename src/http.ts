import {
	createMcpHandler,
	type McpServerFactory,
} from "@modelcontextprotocol/server";
import { timingSafeEqual } from "node:crypto";
import type { HttpConfig } from "./config";

function bearerMatches(header: string | null, token: string): boolean {
	const provided = /^bearer\s+(.+)$/i.exec(header ?? "")?.[1] ?? "";
	const a = Buffer.from(provided);
	const b = Buffer.from(token);
	return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Serves /mcp over Streamable HTTP. Every request must carry the bearer
 * token, which also covers DNS rebinding and other cross-site attacks: a page
 * in a browser cannot attach it.
 */
export function serveHttp(factory: McpServerFactory, http: HttpConfig) {
	const handler = createMcpHandler(factory, {
		onerror: (error) => console.error("[picnic-mcp] http:", error.message),
	});
	const server = Bun.serve({
		hostname: http.host,
		port: http.port,
		fetch(request) {
			if (!bearerMatches(request.headers.get("authorization"), http.token)) {
				return new Response(null, {
					status: 401,
					headers: { "www-authenticate": "Bearer" },
				});
			}
			if (new URL(request.url).pathname !== "/mcp") {
				return new Response(null, { status: 404 });
			}
			return handler.fetch(request);
		},
	});
	return {
		url: new URL("/mcp", server.url),
		async close() {
			await handler.close();
			await server.stop(true);
		},
	};
}
