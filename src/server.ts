import { McpServer } from "@modelcontextprotocol/server";
import pkg from "../package.json" with { type: "json" };
import type { Session } from "./session";
import { registerAccountTools } from "./tools/account";
import { registerCartTools } from "./tools/cart";
import { registerCatalogTools } from "./tools/catalog";
import { registerCheckoutTools } from "./tools/checkout";
import { registerDeliveryTools } from "./tools/deliveries";
import { registerRecipeTools } from "./tools/recipes";

const INSTRUCTIONS = [
	"Prices are integers in euro cents. Product ids look like 's1001524'.",
	"Adding or removing products and adding recipes is not idempotent: after an error, call picnic_get_cart before retrying.",
	"Placing an order is picnic_start_checkout, the user paying at the returned payment URL, then picnic_confirm_order. Ask the user before starting a checkout.",
].join(" ");

/** Builds a server instance; the transport layer calls this per connection or request. */
export function createServer(session: Session): McpServer {
	const server = new McpServer(
		{ name: pkg.name, version: pkg.version },
		{ instructions: INSTRUCTIONS },
	);
	registerCatalogTools(server, session);
	registerCartTools(server, session);
	registerCheckoutTools(server, session);
	registerDeliveryTools(server, session);
	registerRecipeTools(server, session);
	registerAccountTools(server, session);
	return server;
}
