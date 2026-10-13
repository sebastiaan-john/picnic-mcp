export interface FavoriteProduct {
	product_id: string;
	name: string;
	/** Price in cents. */
	price: number;
	unit?: string;
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

const FAVORITES_SECTION = "vertical-selling-unit-tiles-section";

/**
 * The Favorieten tab's page reference, from the app's navigation tabs, so
 * the lookup follows Picnic if the reference changes with the account's
 * purchase history. Null when no tab is the usuals tab.
 */
export function favoritesPageReference(bootstrap: unknown): string | null {
	if (!isRecord(bootstrap) || !Array.isArray(bootstrap.tabs)) return null;
	for (const tab of bootstrap.tabs) {
		if (!isRecord(tab) || tab.analytics_id !== "usuals") continue;
		const target = tab.target;
		if (isRecord(target) && typeof target.reference === "string") {
			return target.reference;
		}
	}
	return null;
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
 * The Favorieten tab lists the account's own favorites as a vertical tile
 * section under the page header. The horizontal shelves below it ("Mix van
 * alle favorieten" and per-category shelves) are Picnic's suggestions, not
 * the user's, and are left out.
 */
export function favoritesFromPage(page: unknown): FavoriteProduct[] {
	const products: FavoriteProduct[] = [];

	const collect = (node: unknown): void => {
		if (Array.isArray(node)) {
			for (const child of node) collect(child);
			return;
		}
		if (!isRecord(node)) return;
		const product = productFromTile(node);
		if (product) products.push(product);
		for (const value of Object.values(node)) collect(value);
	};
	const find = (node: unknown): void => {
		if (Array.isArray(node)) {
			for (const child of node) find(child);
			return;
		}
		if (!isRecord(node)) return;
		if (node.id === FAVORITES_SECTION) {
			collect(node);
			return;
		}
		for (const value of Object.values(node)) find(value);
	};

	find(page);
	return products;
}
