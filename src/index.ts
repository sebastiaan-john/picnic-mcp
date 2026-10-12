import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { loadConfig } from "./config";
import { serveHttp } from "./http";
import { createServer } from "./server";
import { PicnicSession } from "./session";

const config = loadConfig(process.env);
const session = new PicnicSession(config);
const factory = () => createServer(session);

// stdout is the MCP channel on stdio, so logs go to stderr.
if (config.http) {
	const http = serveHttp(factory, config.http);
	console.error(`picnic-mcp listening on ${http.url}`);
	const shutdown = () => {
		http.close().then(
			() => process.exit(0),
			(error: unknown) => {
				console.error("[picnic-mcp] shutdown failed:", error);
				process.exit(1);
			},
		);
	};
	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);
} else {
	serveStdio(factory);
	console.error("picnic-mcp listening on stdio");
}
