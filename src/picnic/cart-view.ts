import type { PicnicApi } from "../session";

export type Cart = Awaited<ReturnType<PicnicApi["cart"]["getCart"]>>;

/**
 * Trims a Picnic cart to what a model needs to reason about it. All prices
 * are in cents; a line's `price` is for its whole quantity after discounts.
 * Optional fields appear only when Picnic sets them.
 */
export function cartView(cart: Cart) {
	const slot = cart.selectedSlot;
	return {
		total_count: cart.totalCount,
		total_price: cart.totalPrice,
		...(cart.promotionSavings > 0 && {
			promotion_savings: cart.promotionSavings,
		}),
		...(cart.depositTotal > 0 && { deposit_total: cart.depositTotal }),
		...(cart.minimumOrderValue !== null && {
			minimum_order_value: cart.minimumOrderValue,
		}),
		selected_slot: slot
			? {
					slot_id: slot.slotId,
					window_start: slot.windowStart,
					window_end: slot.windowEnd,
					chosen_by_user: slot.isExplicitSelection,
				}
			: null,
		items: cart.items.map((line) => ({
			product_id: line.productId,
			name: line.name,
			unit: line.unitQuantity,
			quantity: line.quantity,
			price: line.displayPrice,
			...(line.originalPrice !== null && {
				original_price: line.originalPrice,
			}),
			...(line.labels.length > 0 && {
				labels: line.labels.map((l) => l.text),
			}),
			...(line.isUnavailable && {
				unavailable: line.unavailableReason ?? true,
			}),
			...(line.recipeId && { recipe_id: line.recipeId }),
			...(line.imageId && { image_id: line.imageId }),
		})),
		...(cart.recipes.length > 0 && {
			recipes: cart.recipes.map((r) => ({ id: r.id, name: r.title })),
		}),
	};
}
