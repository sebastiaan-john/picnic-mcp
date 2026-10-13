import { describe, expect, it } from "bun:test";
import { favoritesFromPage } from "./favorites";

function tile(id: string, name: string) {
	return {
		type: "SELLING_UNIT_TILE",
		sellingUnit: {
			id,
			name,
			display_price: 199,
			unit_quantity: "1 stuk",
			image_id: `img-${id}`,
		},
	};
}

function header(title: string) {
	return {
		type: "RICH_TEXT",
		textType: "HEADER4",
		markdown: `#(#333333)${title}#(#333333)`,
	};
}

describe("favoritesFromPage", () => {
	it("groups tiles under the header that precedes them and skips tiles before any header", () => {
		const sections = favoritesFromPage({
			layout: {
				body: {
					children: [
						{ children: [{ content: tile("s0", "In cart") }] },
						{
							children: [
								{ pml: { component: { child: header("Fruit") } } },
								{ content: tile("s1", "Bananen") },
								{ content: tile("s2", "Appels") },
							],
						},
						{ children: [{ pml: { component: { child: header("Leeg") } } }] },
						{
							children: [
								{ pml: { component: { child: header("Drinken") } } },
								{ content: tile("s3", "Melk") },
							],
						},
					],
				},
			},
		});
		expect(sections).toEqual([
			{
				category: "Fruit",
				products: [
					{
						product_id: "s1",
						name: "Bananen",
						price: 199,
						unit: "1 stuk",
					},
					{
						product_id: "s2",
						name: "Appels",
						price: 199,
						unit: "1 stuk",
					},
				],
			},
			{
				category: "Drinken",
				products: [
					{
						product_id: "s3",
						name: "Melk",
						price: 199,
						unit: "1 stuk",
					},
				],
			},
		]);
	});

	it("returns nothing for a page without shelves", () => {
		expect(favoritesFromPage({ layout: { body: {} } })).toEqual([]);
	});
});
