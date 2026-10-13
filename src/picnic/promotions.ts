interface Promotion {
	product_id: string;
	promotion_id: string;
	name: string;
	/** Promotional price in cents. */
	price: number;
	unit?: string;
	promotion_label?: string;
	/** Pre-promotion price in cents, when Picnic shows it struck through. */
	original_price?: number;
	image_id?: string;
	max_count?: number;
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(parent: UnknownRecord, key: string): UnknownRecord | null {
	const value = parent[key];
	return isRecord(value) ? value : null;
}

/** The analytics context on a promo tile carries the promotion id, label and prices. */
function promotionContext(tile: UnknownRecord): UnknownRecord | null {
	const contexts = record(tile, "analytics")?.contexts;
	if (!Array.isArray(contexts)) return null;
	for (const context of contexts) {
		if (!isRecord(context)) continue;
		const data = record(context, "data");
		if (typeof data?.promotion_id === "string") return data;
	}
	return null;
}

function promotionFromTile(tile: UnknownRecord): Promotion | null {
	const content = record(tile, "content");
	const sellingUnit = content ? record(content, "sellingUnit") : null;
	const promotion = promotionContext(tile);
	if (!sellingUnit || !promotion) return null;
	if (
		typeof sellingUnit.id !== "string" ||
		typeof sellingUnit.name !== "string"
	) {
		return null;
	}
	if (typeof promotion.promotion_id !== "string") return null;

	const price =
		typeof promotion.price === "number"
			? promotion.price
			: typeof sellingUnit.display_price === "number"
				? sellingUnit.display_price
				: null;
	if (price === null) return null;

	return {
		product_id: sellingUnit.id,
		promotion_id: promotion.promotion_id,
		name: sellingUnit.name,
		price,
		...(typeof sellingUnit.unit_quantity === "string" && {
			unit: sellingUnit.unit_quantity,
		}),
		...(typeof promotion.promotion_label === "string" && {
			promotion_label: promotion.promotion_label,
		}),
		...(typeof promotion.strikethrough_price === "number" &&
			promotion.show_strikethrough_price !== false && {
				original_price: promotion.strikethrough_price,
			}),
		...(typeof sellingUnit.image_id === "string" && {
			image_id: sellingUnit.image_id,
		}),
		...(typeof sellingUnit.max_count === "number" && {
			max_count: sellingUnit.max_count,
		}),
	};
}

/**
 * Walks a Picnic promotions page (a rendered UI tree, not a data API) and
 * collects every product tile that carries a promotion context, deduplicated
 * on product and promotion id since the page repeats tiles across shelves.
 */
export function promotionsFromPage(page: unknown): Promotion[] {
	const promotions: Promotion[] = [];
	const seen = new Set<string>();

	const visit = (node: unknown): void => {
		if (Array.isArray(node)) {
			for (const child of node) visit(child);
			return;
		}
		if (!isRecord(node)) return;
		const promotion = promotionFromTile(node);
		if (promotion) {
			const key = `${promotion.product_id}:${promotion.promotion_id}`;
			if (!seen.has(key)) {
				seen.add(key);
				promotions.push(promotion);
			}
		}
		for (const value of Object.values(node)) visit(value);
	};

	visit(page);
	return promotions;
}
