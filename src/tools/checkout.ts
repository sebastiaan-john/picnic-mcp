import type { McpServer } from "@modelcontextprotocol/server";
import PicnicClient from "picnic-api";
import * as z from "zod";
import type { Session } from "../session";
import { idArg, json, READ_ONLY } from "./common";

/**
 * Where the bank sends the browser after payment. Picnic's own site; the
 * order is confirmed from here, not from that page, so it only needs to exist.
 */
const RETURN_URL = "https://picnic.app/";

const orderId = idArg("Order id from picnic_start_checkout");
const transactionId = idArg("Transaction id from picnic_start_checkout");

/**
 * Which order each transaction pays for, so a FINISHED transaction from an
 * earlier checkout cannot vouch for a different, unpaid order. Per process;
 * after a restart the pair is accepted as given.
 */
const orderByTransaction = new Map<string, string>();

function slotView(slot: {
	slot_id: string;
	window_start: string;
	window_end: string;
}) {
	return {
		slot_id: slot.slot_id,
		window_start: slot.window_start,
		window_end: slot.window_end,
	};
}

/**
 * Placing an order is three Picnic calls spread over two tools, in the order
 * the other unofficial Picnic clients use: start the checkout and initiate
 * payment, let the user pay at the bank URL, then confirm. Confirmation
 * checks the payment status first so an unpaid order is never confirmed.
 */
export function registerCheckoutTools(server: McpServer, session: Session) {
	server.registerTool(
		"picnic_start_checkout",
		{
			title: "Start checkout",
			description:
				"Starts checkout for the current cart and selected delivery slot and initiates payment. Returns the order id, totals in cents, the transaction id, the expiry, and a payment URL for the user to open when Picnic needs a bank payment; `payment_url` is null when no bank payment is needed, in which case go straight to picnic_confirm_order. Ask the user before calling. Picnic may refuse with a blocking issue such as an alcohol age check; the error carries a resolve_key to pass back once the user has confirmed. After the user has paid, call picnic_confirm_order.",
			inputSchema: z.object({
				resolve_key: z
					.string()
					.min(1)
					.optional()
					.describe(
						"The resolve_key from a previous checkout issue, after the user confirmed it",
					),
			}),
			annotations: {
				readOnlyHint: false,
				destructiveHint: false,
				idempotentHint: false,
				openWorldHint: true,
			},
		},
		({ resolve_key }) =>
			session.call(async (client) => {
				const cart = await client.cart.getCart();
				if (cart.total_count === 0) throw new Error("The cart is empty.");
				if (!cart.selected_slot?.slot_id) {
					throw new Error(
						"No delivery slot is selected; call picnic_set_delivery_slot first.",
					);
				}
				const checkout = await client.cart
					.startCheckout({ mts: cart.mts, resolve_key })
					.catch((error: unknown) => {
						if (PicnicClient.isCheckoutIssueError(error)) {
							throw new Error(
								`Picnic reports a checkout issue (${error.issueType}): ${error.title}. ${error.issueMessage}` +
									(error.blocking && error.resolveKey
										? ` Ask the user; if they confirm, call picnic_start_checkout again with resolve_key "${error.resolveKey}".`
										: ""),
								{ cause: error },
							);
						}
						throw error;
					});
				const payment = await client.cart
					.initiatePayment(checkout.order_id, RETURN_URL)
					.catch((error: unknown) => {
						const message =
							error instanceof Error ? error.message : String(error);
						throw new Error(
							`Checkout started as order ${checkout.order_id} but initiating payment failed: ${message}. Calling picnic_start_checkout again starts a second checkout.`,
							{ cause: error },
						);
					});
				orderByTransaction.set(payment.transaction_id, checkout.order_id);
				const slot = checkout.delivery_slots?.find((s) => s.selected);
				return json({
					order_id: checkout.order_id,
					transaction_id: payment.transaction_id,
					payment_url:
						payment.issuer_authentication_url ??
						payment.action?.redirect_url ??
						null,
					total_price: checkout.total_price,
					total_count: checkout.total_count,
					total_deposit: checkout.total_deposit,
					total_savings: checkout.total_savings,
					transaction_expiry: checkout.transaction_expiry,
					delivery_slot: slot ? slotView(slot) : null,
				});
			}),
	);

	server.registerTool(
		"picnic_confirm_order",
		{
			title: "Confirm order",
			description:
				"Places the order started by picnic_start_checkout once its payment has finished. Fails without placing anything while the payment is still pending, so it is safe to call again after the user has paid. Returns the order id and delivery slot.",
			inputSchema: z.object({
				order_id: orderId,
				transaction_id: transactionId,
			}),
			annotations: {
				readOnlyHint: false,
				destructiveHint: true,
				idempotentHint: true,
				openWorldHint: true,
			},
		},
		({ order_id, transaction_id }) =>
			session.call(async (client) => {
				const paidOrder = orderByTransaction.get(transaction_id);
				if (paidOrder !== undefined && paidOrder !== order_id) {
					throw new Error(
						`Transaction ${transaction_id} pays for order ${paidOrder}, not ${order_id}. The order is not placed.`,
					);
				}
				const { checkout_status } =
					await client.cart.getCheckoutStatus(transaction_id);
				if (checkout_status !== "FINISHED") {
					throw new Error(
						`Payment status is ${checkout_status}, not FINISHED. The order is not placed. If the payment is still pending, ask the user to complete it at the payment URL and call picnic_confirm_order again; if it failed or expired, start a new checkout.`,
					);
				}
				try {
					const confirmation = await client.cart.confirmOrder(order_id);
					return json({
						order_id: confirmation.order_id,
						delivery_slot: confirmation.delivery_slot
							? slotView(confirmation.delivery_slot)
							: null,
					});
				} catch (error) {
					const message =
						error instanceof Error ? error.message : String(error);
					throw new Error(
						`Confirming order ${order_id} failed: ${message}. The order may still have been placed; check picnic_get_deliveries before confirming again.`,
						{ cause: error },
					);
				}
			}),
	);

	server.registerTool(
		"picnic_cancel_checkout",
		{
			title: "Cancel checkout",
			description:
				"Cancels a checkout transaction from picnic_start_checkout before it is paid, for example when the user changes their mind. Refuses once the payment has finished; confirm the order then, and use picnic_cancel_delivery to undo it. The cart is kept.",
			inputSchema: z.object({ transaction_id: transactionId }),
			annotations: {
				readOnlyHint: false,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: true,
			},
		},
		({ transaction_id }) =>
			session.call(async (client) => {
				const { checkout_status } =
					await client.cart.getCheckoutStatus(transaction_id);
				if (checkout_status === "FINISHED") {
					throw new Error(
						"The payment has finished, so cancelling would leave it without an order. Call picnic_confirm_order, then picnic_cancel_delivery if the user wants to undo it.",
					);
				}
				await client.cart.cancelCheckout(transaction_id);
				return json({ cancelled: true });
			}),
	);

	server.registerTool(
		"picnic_get_checkout_status",
		{
			title: "Get checkout status",
			description:
				"Payment status of a checkout transaction: FINISHED once the user has paid, otherwise Picnic's in-progress status.",
			inputSchema: z.object({ transaction_id: transactionId }),
			annotations: READ_ONLY,
		},
		({ transaction_id }) =>
			session.call(async (client) =>
				json(await client.cart.getCheckoutStatus(transaction_id)),
			),
	);
}
