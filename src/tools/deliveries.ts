import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import type { Session } from "../session";
import {
	DESTRUCTIVE,
	idArg,
	json,
	paginate,
	paginationArgs,
	READ_ONLY,
} from "./common";

const deliveryId = idArg("Delivery id from picnic_get_deliveries");

function settled(result: PromiseSettledResult<unknown>) {
	return result.status === "fulfilled"
		? { value: result.value }
		: {
				error:
					result.reason instanceof Error
						? result.reason.message
						: String(result.reason),
			};
}

export function registerDeliveryTools(server: McpServer, session: Session) {
	server.registerTool(
		"picnic_get_deliveries",
		{
			title: "Get deliveries",
			description:
				"Past and upcoming deliveries in Picnic's order: delivery id, status, delivery window, ETA, and order totals in cents. Use picnic_get_delivery for the items of one delivery.",
			inputSchema: z.object({
				status: z
					.array(z.enum(["CURRENT", "COMPLETED", "CANCELLED"]))
					.default([])
					.describe(
						"Filter by status (CURRENT is upcoming or in progress); empty returns all",
					),
				...paginationArgs(50, 10),
			}),
			annotations: READ_ONLY,
		},
		({ status, limit, offset }) =>
			session.call(async (client) => {
				const page = paginate(
					await client.delivery.getDeliveries(status),
					offset,
					limit,
				);
				return json({ deliveries: page.items, pagination: page.pagination });
			}),
	);

	server.registerTool(
		"picnic_get_delivery",
		{
			title: "Get delivery",
			description:
				"One delivery in full: orders with their items and prices, returned containers, slot, and status.",
			inputSchema: z.object({ delivery_id: deliveryId }),
			annotations: READ_ONLY,
		},
		({ delivery_id }) =>
			session.call(async (client) =>
				json(await client.delivery.getDelivery(delivery_id)),
			),
	);

	server.registerTool(
		"picnic_track_delivery",
		{
			title: "Track delivery",
			description:
				"ETA and route (timestamped coordinates, driver, vehicle) for a delivery that is out for delivery. `position` and `scenario` each hold `value` or `error`, since either can be unavailable.",
			inputSchema: z.object({ delivery_id: deliveryId }),
			annotations: READ_ONLY,
		},
		({ delivery_id }) =>
			session.call(async (client) => {
				const [position, scenario] = await Promise.allSettled([
					client.delivery.getDeliveryPosition(delivery_id),
					client.delivery.getDeliveryScenario(delivery_id),
				]);
				return json({
					position: settled(position),
					scenario: settled(scenario),
				});
			}),
	);

	server.registerTool(
		"picnic_cancel_delivery",
		{
			title: "Cancel delivery",
			description:
				"Cancels an upcoming delivery. Irreversible; confirm with the user first.",
			inputSchema: z.object({ delivery_id: deliveryId }),
			annotations: DESTRUCTIVE,
		},
		({ delivery_id }) =>
			session.call(async (client) => {
				const result: unknown =
					await client.delivery.cancelDelivery(delivery_id);
				return json({ delivery_id, cancelled: true, result });
			}),
	);
}
