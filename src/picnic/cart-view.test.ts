import { describe, expect, it } from "bun:test";
import { type Cart, cartView } from "./cart-view";

type Line = Cart["items"][number];

function cart(overrides: Partial<Cart>): Cart {
	return {
		id: "shopping_cart",
		mts: 0,
		items: [],
		totalCount: 0,
		totalPrice: 0,
		discount: 0,
		promotionSavings: 0,
		membershipSavings: 0,
		deposits: [],
		depositTotal: 0,
		fees: [],
		minimumOrderValue: null,
		selectedSlot: null,
		recipes: [],
		...overrides,
	};
}

function line(overrides: Partial<Line>): Line {
	return {
		id: "1",
		productId: "s2",
		name: "Melk",
		unitQuantity: "1 l",
		imageId: null,
		quantity: 1,
		maxCount: 50,
		displayPrice: 129,
		originalPrice: null,
		priceColor: null,
		priceRanges: null,
		labels: [],
		basePrice: null,
		freshness: null,
		characteristics: [],
		isUnavailable: false,
		unavailableReason: null,
		replacements: [],
		bundlesLink: null,
		recipeId: null,
		...overrides,
	};
}

describe("cartView", () => {
	it("keeps optional fields only when Picnic sets them", () => {
		const view = cartView(
			cart({
				totalCount: 3,
				totalPrice: 984,
				promotionSavings: 12,
				selectedSlot: {
					slotId: "slot-2",
					state: "EXPLICIT",
					windowStart: "2026-11-09T07:00:00.000+01:00",
					windowEnd: "2026-11-09T08:00:00.000+01:00",
					isExplicitSelection: true,
				},
				items: [
					line({
						productId: "s1014487",
						name: "Picnic skyr",
						unitQuantity: "1 kilo",
						quantity: 3,
						displayPrice: 855,
						originalPrice: 867,
						labels: [
							{ text: "BundelBonus", textColor: null, backgroundColor: null },
						],
						imageId: "img",
						recipeId: "r1",
					}),
					line({ isUnavailable: true, unavailableReason: "Uitverkocht" }),
				],
				recipes: [
					{
						id: "r1",
						title: "Bowl",
						preTitle: null,
						subtitle: null,
						imageId: null,
					},
				],
			}),
		);
		expect(view).toEqual({
			total_count: 3,
			total_price: 984,
			promotion_savings: 12,
			selected_slot: {
				slot_id: "slot-2",
				window_start: "2026-11-09T07:00:00.000+01:00",
				window_end: "2026-11-09T08:00:00.000+01:00",
				chosen_by_user: true,
			},
			items: [
				{
					product_id: "s1014487",
					name: "Picnic skyr",
					unit: "1 kilo",
					quantity: 3,
					price: 855,
					original_price: 867,
					labels: ["BundelBonus"],
					recipe_id: "r1",
					image_id: "img",
				},
				{
					product_id: "s2",
					name: "Melk",
					unit: "1 l",
					quantity: 1,
					price: 129,
					unavailable: "Uitverkocht",
				},
			],
			recipes: [{ id: "r1", name: "Bowl" }],
		});
	});
});
