import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { cartView } from "../picnic/cart-view";
import type { Session } from "../session";
import {
	CART_MUTATION,
	DESTRUCTIVE,
	IDEMPOTENT_WRITE,
	idArg,
	json,
	mutateCart,
	NOT_IDEMPOTENT,
	READ_ONLY,
} from "./common";

const productId = idArg("Product id such as 's1001524'");
const countArg = z.number().int().min(1).default(1).describe("Number of units");

export function registerCartTools(server: McpServer, session: Session) {
	server.registerTool(
		"picnic_get_cart",
		{
			title: "Get cart",
			description:
				"The current shopping cart: products with quantities and prices in cents, totals, and the selected delivery slot. Call this to verify the cart after a mutation reported an error.",
			annotations: READ_ONLY,
		},
		() =>
			session.call(async (client) =>
				json(cartView(await client.cart.getCart())),
			),
	);

	server.registerTool(
		"picnic_add_to_cart",
		{
			title: "Add to cart",
			description: `Adds \`count\` units of a product and returns the updated cart. ${NOT_IDEMPOTENT}`,
			inputSchema: z.object({ product_id: productId, count: countArg }),
			annotations: CART_MUTATION,
		},
		({ product_id, count }) =>
			session.call((client) =>
				mutateCart(`Adding ${count} x ${product_id}`, async () =>
					json(cartView(await client.cart.addProductToCart(product_id, count))),
				),
			),
	);

	server.registerTool(
		"picnic_remove_from_cart",
		{
			title: "Remove from cart",
			description: `Removes \`count\` units of a product and returns the updated cart. ${NOT_IDEMPOTENT}`,
			inputSchema: z.object({ product_id: productId, count: countArg }),
			annotations: CART_MUTATION,
		},
		({ product_id, count }) =>
			session.call((client) =>
				mutateCart(`Removing ${count} x ${product_id}`, async () =>
					json(
						cartView(
							await client.cart.removeProductFromCart(product_id, count),
						),
					),
				),
			),
	);

	server.registerTool(
		"picnic_clear_cart",
		{
			title: "Clear cart",
			description:
				"Removes every product from the cart and returns the empty cart. Ask the user first.",
			annotations: DESTRUCTIVE,
		},
		() =>
			session.call(async (client) =>
				json(cartView(await client.cart.clearCart())),
			),
	);

	server.registerTool(
		"picnic_get_delivery_slots",
		{
			title: "Get delivery slots",
			description:
				"Delivery windows for the next `days` calendar days (Picnic offers about 15 a day for two weeks): slot id, start and end, order cut-off, minimum order in cents, availability with reason, and which is selected. Pass a slot id to picnic_set_delivery_slot.",
			inputSchema: z.object({
				days: z
					.number()
					.int()
					.min(1)
					.max(31)
					.default(3)
					.describe(
						"How many calendar days of slots to return, from the first offered day",
					),
			}),
			annotations: READ_ONLY,
		},
		({ days }) =>
			session.call(async (client) => {
				const result = await client.cart.getDeliverySlots();
				const dates = [
					...new Set(
						result.delivery_slots.map((s) => s.window_start.slice(0, 10)),
					),
				].slice(0, days);
				const slots = result.delivery_slots.filter((s) =>
					dates.includes(s.window_start.slice(0, 10)),
				);
				return json({
					selected_slot_id: result.selected_slot?.slot_id ?? null,
					days: dates,
					slots: slots.map((slot) => ({
						slot_id: slot.slot_id,
						window_start: slot.window_start,
						window_end: slot.window_end,
						cut_off_time: slot.cut_off_time,
						is_available: slot.is_available,
						selected: slot.selected,
						...(slot.minimum_order_value !== undefined && {
							minimum_order_value: slot.minimum_order_value,
						}),
						...(slot.unavailability_reason && {
							unavailability_reason: slot.unavailability_reason,
						}),
					})),
				});
			}),
	);

	server.registerTool(
		"picnic_set_delivery_slot",
		{
			title: "Select delivery slot",
			description:
				"Selects the delivery window for the current cart and returns the updated cart. This does not place the order; see picnic_start_checkout.",
			inputSchema: z.object({
				slot_id: z
					.string()
					.min(1)
					.describe("Slot id from picnic_get_delivery_slots"),
			}),
			annotations: IDEMPOTENT_WRITE,
		},
		({ slot_id }) =>
			session.call(async (client) =>
				json(cartView(await client.cart.setDeliverySlot(slot_id))),
			),
	);
}
