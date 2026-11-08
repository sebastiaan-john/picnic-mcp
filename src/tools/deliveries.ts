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

/** Picnic answers the position request with an empty body when the delivery is not on its way; picnic-api fails to parse it. */
const EMPTY_BODY_RE = /unexpected (eof|end of (json|input))/i;

function settled<T>(result: PromiseSettledResult<T>) {
	if (result.status === "fulfilled") return { value: result.value };
	const message =
		result.reason instanceof Error
			? result.reason.message
			: String(result.reason);
	return {
		error: EMPTY_BODY_RE.test(message)
			? "Picnic returned no data; the delivery is not on its way."
			: message,
	};
}

export function registerDeliveryTools(server: McpServer, session: Session) {
	server.registerTool(
		"picnic_get_deliveries",
		{
			title: "Get deliveries",
			description:
				"Past and upcoming deliveries, newest first: delivery id, status, delivery window, number of orders, and total price in cents. Use picnic_get_delivery for the items of one delivery.",
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
				// picnic-api reports 0 items when the summary endpoint omits the count.
				const summaries = (
					await client.delivery.getDeliverySummaries(status)
				).map(({ itemCount, ...summary }) => summary);
				const page = paginate(summaries, offset, limit);
				return json({ deliveries: page.items, pagination: page.pagination });
			}),
	);

	server.registerTool(
		"picnic_get_delivery",
		{
			title: "Get delivery",
			description:
				"One delivery in full: orders with their products and prices in cents (a line's displayPrice covers its whole quantity after discounts), returned containers, deposits, delivery window, and status.",
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
				"Where a delivery that is out for delivery is. `position` has the ETA (epoch ms), whether the driver is on the way, and `routeTime`, the driver's point in time on the route; `route` has timestamped coordinates, driver, vehicle, and destination. Each holds `value` or `error`, since either can be unavailable.",
			inputSchema: z.object({ delivery_id: deliveryId }),
			annotations: READ_ONLY,
		},
		({ delivery_id }) =>
			session.call(async (client) => {
				const [position, route] = await Promise.allSettled([
					client.delivery.getDeliveryPosition(delivery_id),
					client.delivery
						.getDeliveryRoute(delivery_id)
						.then(({ vehicleImageDataUrl, ...rest }) => rest),
				]);
				return json({
					position: settled(position),
					route: settled(route),
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
				await client.delivery.cancelDelivery(delivery_id);
				return json({ delivery_id, cancelled: true });
			}),
	);
}
