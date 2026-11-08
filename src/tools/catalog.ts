import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { tileView, uniqueTiles } from "../picnic/product-tile";
import type { Session } from "../session";
import { idArg, json, paginate, paginationArgs, READ_ONLY } from "./common";

/** The search section of products the account bought before ("Opnieuw bestellen"). */
const BOUGHT_BEFORE_SECTION = "RFY";

const productId = idArg("Product id such as 's1001524'");

export function registerCatalogTools(server: McpServer, session: Session) {
	server.registerTool(
		"picnic_search_products",
		{
			title: "Search products",
			description:
				"Products in the Picnic catalog matching keywords, in Picnic's order: id, name, brand, price in cents (original_price when discounted), unit, promotion labels, and image id. `bought_before` marks products this account ordered before. Use the id with picnic_add_to_cart or picnic_get_product.",
			inputSchema: z.object({
				query: z
					.string()
					.min(1)
					.describe("Search terms, e.g. 'halfvolle melk'"),
				...paginationArgs(50, 10),
			}),
			annotations: READ_ONLY,
		},
		({ query, limit, offset }) =>
			session.call(async (client) => {
				const results = await client.catalog.getSearchResults(query);
				const sections = results.products?.sections ?? [];
				const boughtBefore = new Set(
					sections
						.filter((s) => s.type === BOUGHT_BEFORE_SECTION)
						.flatMap((s) => s.products.map((p) => p.id)),
				);
				const page = paginate(
					uniqueTiles(sections.flatMap((s) => s.products)),
					offset,
					limit,
				);
				return json({
					query,
					...(results.correctedQuery && {
						corrected_query: results.correctedQuery,
					}),
					results: page.items.map((tile) => ({
						...tileView(tile),
						...(boughtBefore.has(tile.id) && { bought_before: true }),
					})),
					pagination: page.pagination,
				});
			}),
	);

	server.registerTool(
		"picnic_get_product",
		{
			title: "Get product details",
			description:
				"One product: name, brand, unit, price in cents, description, labels, highlights, allergens, current promotion, and cart limit (maxCount). Set `full` for ingredient and nutrition sections, similar products, and price tiers.",
			inputSchema: z.object({
				product_id: productId,
				full: z
					.boolean()
					.default(false)
					.describe(
						"Also return info sections (ingredients, nutrition), similar products, and price tiers",
					),
			}),
			annotations: READ_ONLY,
		},
		({ product_id, full }) =>
			session.call(async (client) => {
				const product = await client.catalog.getProduct(product_id);
				if (full) return json(product);
				const {
					infoSections,
					nutritionRows,
					similarProducts,
					priceRanges,
					...summary
				} = product;
				return json(summary);
			}),
	);

	server.registerTool(
		"picnic_get_favorites",
		{
			title: "Get favorites",
			description:
				"The products this account buys, per aisle, from the Favorieten tab: id, name, brand, price in cents, unit, and labels.",
			annotations: READ_ONLY,
		},
		() =>
			session.call(async (client) => {
				const { aisles } = await client.catalog.getFavorites();
				const products = await Promise.all(
					aisles.map((aisle) =>
						aisle.complete
							? aisle.products
							: client.catalog.getFavoritesInAisle(aisle.id),
					),
				);
				return json({
					aisles: aisles
						.map((aisle, i) => ({
							aisle: aisle.title,
							products: (products[i] ?? []).map(tileView),
						}))
						.filter((aisle) => aisle.products.length > 0),
				});
			}),
	);

	server.registerTool(
		"picnic_get_product_image",
		{
			title: "Get product image",
			description:
				"A product image as PNG. `image_id` comes from search, cart, promotion, or recipe results, or `imageIds` in product details.",
			inputSchema: z.object({
				image_id: z
					.string()
					.regex(
						/^[\w-]+(?:\/[\w-]+)*$/,
						"Image ids contain only letters, digits, _, - and /",
					)
					.describe(
						"Image id from search, cart, promotions, recipes, or product details",
					),
				size: z
					.enum(["tiny", "small", "medium", "large", "extra-large"])
					.default("medium")
					.describe("Resolution; medium suits a preview"),
			}),
			annotations: READ_ONLY,
		},
		({ image_id, size }) =>
			session.call(async (client) => {
				const dataUri = await client.catalog.getImageAsDataUri(image_id, size);
				return {
					content: [
						{
							type: "image",
							data: dataUri.slice(dataUri.indexOf(",") + 1),
							mimeType: "image/png",
						},
					],
				};
			}),
	);

	server.registerTool(
		"picnic_get_promotions",
		{
			title: "Get current promotions",
			description:
				"This week's promoted products from the Picnic deals page: id, name, promotional price in cents, original price, label such as '1+1 gratis', and the deals-page section it appears in.",
			inputSchema: z.object(paginationArgs(100, 25)),
			annotations: READ_ONLY,
		},
		({ limit, offset }) =>
			session.call(async (client) => {
				const { sections } = await client.catalog.getPromotions();
				const seen = new Set<string>();
				const promotions = sections.flatMap((section) =>
					section.products
						.filter((tile) => !seen.has(tile.id) && seen.add(tile.id))
						.map((tile) => ({ ...tileView(tile), section: section.title })),
				);
				const result = paginate(promotions, offset, limit);
				return json({
					promotions: result.items,
					pagination: result.pagination,
				});
			}),
	);
}
