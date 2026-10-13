import type { McpServer } from "@modelcontextprotocol/server";
import PicnicClient from "picnic-api";
import { extractProductDetails } from "picnic-api/lib/domains/catalog/helpers";
import * as z from "zod";
import { promotionsFromPage } from "../picnic/promotions";
import type { Session } from "../session";
import { idArg, json, paginate, paginationArgs, READ_ONLY } from "./common";

const PROMOTIONS_PAGE = "promo-page-all-promos-redirect";

/**
 * picnic-api 4.10 reads the product name from a HEADER1 node among the main
 * container's direct children, but Picnic now wraps that header in an
 * accessibility container, so the name comes back empty. Find it at any depth.
 */
function headerText(node: unknown): string | null {
	if (Array.isArray(node)) {
		for (const child of node) {
			const found = headerText(child);
			if (found) return found;
		}
		return null;
	}
	if (typeof node !== "object" || node === null) return null;
	const record = node as Record<string, unknown>;
	if (record.textType === "HEADER1" && typeof record.markdown === "string") {
		return record.markdown.replace(/#\(#[0-9a-fA-F]{6}\)/g, "").trim();
	}
	for (const value of Object.values(record)) {
		const found = headerText(value);
		if (found) return found;
	}
	return null;
}
const productId = idArg("Product id such as 's1001524'");

export function registerCatalogTools(server: McpServer, session: Session) {
	server.registerTool(
		"picnic_search_products",
		{
			title: "Search products",
			description:
				"Products in the Picnic catalog matching keywords: id, name, price in cents, unit, cart limit (max_count), and image id. Use the id with picnic_add_to_cart or picnic_get_product.",
			inputSchema: z.object({
				query: z
					.string()
					.min(1)
					.describe("Search terms, e.g. 'halfvolle melk'"),
				...paginationArgs(20, 10),
			}),
			annotations: READ_ONLY,
		},
		({ query, limit, offset }) =>
			session.call(async (client) => {
				const page = paginate(
					await client.catalog.search(query),
					offset,
					limit,
				);
				return json({
					query,
					results: page.items.map((p) => ({
						id: p.id,
						name: p.name,
						price: p.display_price,
						unit: p.unit_quantity,
						max_count: p.max_count,
						...(p.image_id && { image_id: p.image_id }),
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
				"One product: name, brand, unit, price in cents, description, highlights, allergens, current promotion, and bundle prices. Set `full` for ingredient and nutrition sections, similar products, and price tiers.",
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
				const page = await client.catalog.getProductDetailsPage(product_id);
				const details = extractProductDetails(product_id, page);
				if (!details.name) details.name = headerText(page) ?? "";
				if (full) return json(details);
				const { infoSections, similarProducts, priceRanges, ...summary } =
					details;
				return json(summary);
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
				"This week's promotions from the Picnic deals page: product id, name, promotional price in cents, label such as '1+1 gratis', and the original price when shown.",
			inputSchema: z.object(paginationArgs(100, 25)),
			annotations: READ_ONLY,
		},
		({ limit, offset }) =>
			session.call(async (client) => {
				const page = await client.app
					.getPage(PROMOTIONS_PAGE)
					.catch((error: unknown) => {
						if (PicnicClient.isUnexpectedPageFormatError(error)) {
							throw new Error(
								"Picnic changed the promotions page format and this server cannot read it. Tell the user to set PICNIC_AGENT to an older app version, such as '30100;1.236.1-15553;', and restart the server.",
								{ cause: error },
							);
						}
						throw error;
					});
				const result = paginate(promotionsFromPage(page), offset, limit);
				return json({
					promotions: result.items,
					pagination: result.pagination,
				});
			}),
	);
}
