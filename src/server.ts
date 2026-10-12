import { McpServer } from "@modelcontextprotocol/server";
import pkg from "../package.json" with { type: "json" };
import type { Session } from "./session";
import { registerAccountTools } from "./tools/account";
import { registerCartTools } from "./tools/cart";
import { registerCatalogTools } from "./tools/catalog";
import { registerDeliveryTools } from "./tools/deliveries";
import { registerRecipeTools } from "./tools/recipes";

const INSTRUCTIONS = [
	"Prices are integers in euro cents. Product ids look like 's1001524'.",
	"Tools that change cart contents are not idempotent: after an error, call picnic_get_cart before retrying.",
	"Checkout and payment happen in the Picnic app, not here.",
].join(" ");

/** Builds a server instance; the transport layer calls this per connection or request. */
export function createServer(session: Session): McpServer {
	const server = new McpServer(
		{ name: pkg.name, version: pkg.version },
		{ instructions: INSTRUCTIONS },
	);
	registerCatalogTools(server, session);
	registerCartTools(server, session);
	registerDeliveryTools(server, session);
	registerRecipeTools(server, session);
	registerAccountTools(server, session);
	return server;
}
