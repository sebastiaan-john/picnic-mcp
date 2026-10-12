import { describe, expect, it } from "bun:test";
import { promotionsFromPage } from "./promotions";

function promoTile(opts: {
	productId: string;
	promotionId: string;
	name: string;
	label: string;
	price: number;
	originalPrice?: number;
}) {
	return {
		type: "PML",
		id: `selling-unit-${opts.productId}-tile`,
		analytics: {
			contexts: [
				{ data: { product_id: opts.productId } },
				{
					data: {
						promotion_id: opts.promotionId,
						promotion_label: opts.label,
						price: opts.price,
						...(opts.originalPrice !== undefined && {
							strikethrough_price: opts.originalPrice,
							show_strikethrough_price: true,
						}),
					},
				},
			],
		},
		content: {
			type: "SELLING_UNIT_TILE",
			sellingUnit: {
				id: opts.productId,
				display_price: opts.price,
				image_id: `image-${opts.productId}`,
				max_count: 12,
				name: opts.name,
				unit_quantity: "1 stuk",
			},
		},
	};
}

const regularTile = {
	type: "PML",
	analytics: { contexts: [{ data: { product_id: "s999" } }] },
	content: {
		type: "SELLING_UNIT_TILE",
		sellingUnit: { id: "s999", display_price: 399, name: "Regular" },
	},
};

describe("promotionsFromPage", () => {
	it("collects promo tiles anywhere in the tree, skips regular tiles, dedupes", () => {
		const tomatoes = promoTile({
			productId: "s100",
			promotionId: "promo-1",
			name: "Discount tomatoes",
			label: "nu €1.99",
			price: 199,
			originalPrice: 249,
		});
		const page = {
			layout: {
				body: {
					children: [
						tomatoes,
						regularTile,
						[
							promoTile({
								productId: "s200",
								promotionId: "promo-2",
								name: "Bonus pasta",
								label: "1+1 gratis",
								price: 239,
							}),
							tomatoes,
						],
					],
				},
			},
		};
		expect(promotionsFromPage(page)).toEqual([
			{
				product_id: "s100",
				promotion_id: "promo-1",
				name: "Discount tomatoes",
				price: 199,
				unit: "1 stuk",
				promotion_label: "nu €1.99",
				original_price: 249,
				image_id: "image-s100",
				max_count: 12,
			},
			{
				product_id: "s200",
				promotion_id: "promo-2",
				name: "Bonus pasta",
				price: 239,
				unit: "1 stuk",
				promotion_label: "1+1 gratis",
				image_id: "image-s200",
				max_count: 12,
			},
		]);
	});

	it("returns nothing for pages without promo tiles", () => {
		expect(promotionsFromPage({ layout: { body: [regularTile] } })).toEqual([]);
		expect(promotionsFromPage(null)).toEqual([]);
		expect(promotionsFromPage("rsc payload")).toEqual([]);
	});
});
