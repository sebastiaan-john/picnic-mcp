import { describe, expect, it } from "bun:test";
import { favoritesFromPage, favoritesPageReference } from "./favorites";

function tile(id: string, name: string) {
	return {
		content: {
			type: "SELLING_UNIT_TILE",
			sellingUnit: { id, name, display_price: 199, unit_quantity: "1 stuk" },
		},
	};
}

describe("favoritesFromPage", () => {
	it("returns the vertical section's tiles and ignores the suggestion shelves", () => {
		const favorites = favoritesFromPage({
			layout: {
				body: {
					children: [
						{ id: "pml-header", markdown: "Favorieten" },
						{
							id: "vertical-selling-unit-tiles-section",
							children: [tile("s1", "Skyr"), tile("s2", "Melk")],
						},
						{
							id: "core-horizontal-selling-unit-section-localized",
							children: [
								{ textType: "HEADER4", markdown: "Mix van alle favorieten" },
								tile("s3", "Croissants"),
							],
						},
					],
				},
			},
		});
		expect(favorites).toEqual([
			{ product_id: "s1", name: "Skyr", price: 199, unit: "1 stuk" },
			{ product_id: "s2", name: "Melk", price: 199, unit: "1 stuk" },
		]);
	});

	it("returns nothing without the section", () => {
		expect(favoritesFromPage({ layout: { body: {} } })).toEqual([]);
	});
});

describe("favoritesPageReference", () => {
	it("reads the usuals tab's page reference", () => {
		expect(
			favoritesPageReference({
				tabs: [
					{ analytics_id: "home", target: { reference: "home_page_root" } },
					{
						analytics_id: "usuals",
						target: {
							type: "PICNIC_PAGE_REFERENCE",
							reference: "purchases_page_root",
						},
					},
				],
			}),
		).toBe("purchases_page_root");
		expect(favoritesPageReference({ tabs: [] })).toBeNull();
	});
});
