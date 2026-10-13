import { describe, expect, it } from "bun:test";
import { type Cart, cartView } from "./cart-view";

function cart(overrides: Partial<Cart>): Cart {
	return {
		type: "ORDER",
		id: "shopping_cart",
		items: [],
		delivery_slots: [],
		selected_slot: { slot_id: "", state: "IMPLICIT" },
		slot_selector_message: null,
		total_count: 0,
		total_price: 0,
		checkout_total_price: 0,
		membership_savings: 0,
		mts: 0,
		deposit_breakdown: [],
		decorator_overrides: {},
		state_token: "",
		fees: [],
		basket_sections: [],
		analytics_context_data: { items_list: [] },
		show_create_sellable_banner: false,
		...overrides,
	};
}

const article = (
	overrides: Partial<Cart["items"][number]["items"][number]>,
) => ({
	type: "ORDER_ARTICLE" as const,
	id: "s2",
	name: "Melk",
	unit_quantity: "1 l",
	price: 129,
	decorators: [],
	max_count: 50,
	image_ids: [],
	perishable: true,
	analytics_contexts: [],
	selling_unit_contexts_for_mutations: [],
	...overrides,
});

describe("cartView", () => {
	it("maps lines, reads quantity from the QUANTITY decorator, and leaves it null when absent", () => {
		const view = cartView(
			cart({
				total_count: 3,
				total_price: 639,
				checkout_total_price: 639,
				total_savings: 50,
				items: [
					{
						type: "ORDER_LINE",
						id: "1871",
						display_price: 639,
						price: 689,
						items: [
							article({
								id: "s1032332",
								name: "Frosch Cremeseife",
								unit_quantity: "500ml",
								price: 255,
								decorators: [{ type: "QUANTITY", quantity: 2 }],
								image_ids: ["img-1", "img-2"],
							}),
							article({}),
						],
					},
				],
			}),
		);
		expect(view).toEqual({
			id: "shopping_cart",
			total_count: 3,
			total_price: 639,
			checkout_total_price: 639,
			total_savings: 50,
			selected_slot: null,
			items: [
				{
					order_line_id: "1871",
					price: 639,
					articles: [
						{
							product_id: "s1032332",
							name: "Frosch Cremeseife",
							unit: "500ml",
							price: 255,
							quantity: 2,
							image_id: "img-1",
						},
						{
							product_id: "s2",
							name: "Melk",
							unit: "1 l",
							price: 129,
							quantity: null,
						},
					],
				},
			],
		});
	});

	it("resolves the selected slot window and omits absent savings", () => {
		const view = cartView(
			cart({
				selected_slot: { slot_id: "slot-2", state: "EXPLICIT" },
				delivery_slots: [
					{
						slot_id: "slot-2",
						hub_id: "h",
						fc_id: "f",
						window_start: "2026-10-13T16:00:00+02:00",
						window_end: "2026-10-13T17:00:00+02:00",
						cut_off_time: "2026-10-13T12:00:00+02:00",
						is_available: true,
						selected: true,
						reserved: false,
						slot_characteristics: [],
					},
				],
			}),
		);
		expect(view.selected_slot).toEqual({
			slot_id: "slot-2",
			window_start: "2026-10-13T16:00:00+02:00",
			window_end: "2026-10-13T17:00:00+02:00",
		});
		expect("total_savings" in view).toBe(false);
	});
});
