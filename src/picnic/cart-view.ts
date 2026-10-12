import type { PicnicApi } from "../session";

export type Cart = Awaited<ReturnType<PicnicApi["cart"]["getCart"]>>;

/**
 * Trims a Picnic cart to what a model needs to reason about it. All prices
 * are in cents; article `price` is per unit. Quantity comes from the QUANTITY
 * decorator because Picnic carries it there rather than as a field, and is
 * null when the decorator is absent rather than guessed.
 */
export function cartView(cart: Cart) {
	const slot = cart.delivery_slots.find(
		(s) => s.slot_id === cart.selected_slot.slot_id,
	);
	return {
		id: cart.id,
		total_count: cart.total_count,
		total_price: cart.total_price,
		checkout_total_price: cart.checkout_total_price,
		...(cart.total_savings !== undefined && {
			total_savings: cart.total_savings,
		}),
		selected_slot: slot
			? {
					slot_id: slot.slot_id,
					window_start: slot.window_start,
					window_end: slot.window_end,
				}
			: null,
		items: cart.items.map((line) => ({
			order_line_id: line.id,
			price: line.display_price,
			articles: line.items.map((article) => ({
				product_id: article.id,
				name: article.name,
				unit: article.unit_quantity,
				price: article.price,
				quantity:
					article.decorators.find((d) => d.type === "QUANTITY")?.quantity ??
					null,
				...(article.image_ids[0] && { image_id: article.image_ids[0] }),
			})),
		})),
	};
}
