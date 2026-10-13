interface FavoriteProduct {
	product_id: string;
	name: string;
	/** Price in cents. */
	price: number;
	unit?: string;
}

export interface FavoriteSection {
	category: string;
	products: FavoriteProduct[];
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function productFromTile(node: UnknownRecord): FavoriteProduct | null {
	const unit = node.sellingUnit;
	if (
		!isRecord(unit) ||
		typeof unit.id !== "string" ||
		typeof unit.name !== "string" ||
		typeof unit.display_price !== "number"
	) {
		return null;
	}
	return {
		product_id: unit.id,
		name: unit.name,
		price: unit.display_price,
		...(typeof unit.unit_quantity === "string" && {
			unit: unit.unit_quantity,
		}),
	};
}

/**
 * The Favorieten tab (page reference `purchases_page_no_products_root`) lists
 * products the account bought before as shelves: a HEADER4 title followed by
 * up to twelve product tiles. Tiles before the first header belong to the
 * cart, not to a shelf, and are skipped. Image ids are left out to keep the
 * list small; picnic_get_product has them.
 */
export function favoritesFromPage(page: unknown): FavoriteSection[] {
	const sections: FavoriteSection[] = [];
	let current: FavoriteSection | null = null;

	const visit = (node: unknown): void => {
		if (Array.isArray(node)) {
			for (const child of node) visit(child);
			return;
		}
		if (!isRecord(node)) return;
		if (node.textType === "HEADER4" && typeof node.markdown === "string") {
			current = {
				category: node.markdown.replace(/#\(#?[A-Za-z0-9]+\)/g, "").trim(),
				products: [],
			};
			sections.push(current);
		}
		const product = productFromTile(node);
		if (product && current) current.products.push(product);
		for (const value of Object.values(node)) visit(value);
	};

	visit(page);
	return sections.filter((section) => section.products.length > 0);
}
