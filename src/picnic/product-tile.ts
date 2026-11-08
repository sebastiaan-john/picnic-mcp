import type PicnicClient from "picnic-api";

export type ProductTile = PicnicClient.Types.catalog.ProductTile;

/**
 * Trims a product tile from search, favorites, or promotions to what a model
 * needs to pick a product. Prices are in cents. Optional fields appear only
 * when Picnic sets them, so a plain product stays short.
 */
export function tileView(tile: ProductTile) {
	const labels = tile.labels.flatMap((l) => (l.text ? [l.text] : []));
	return {
		id: tile.id,
		name: tile.namePrefix ? `${tile.namePrefix} ${tile.name}` : tile.name,
		...(tile.brand && { brand: tile.brand }),
		price: tile.displayPrice,
		...(tile.originalPrice !== null && { original_price: tile.originalPrice }),
		unit: tile.unitQuantity,
		...(tile.unitPrice && { unit_price: tile.unitPrice }),
		...(labels.length > 0 && { labels }),
		...(tile.isUnavailable && { unavailable: true }),
		...(tile.imageId && { image_id: tile.imageId }),
	};
}

/** Tiles in order with repeats dropped; Picnic lists a product in more than one section. */
export function uniqueTiles(tiles: Iterable<ProductTile>): ProductTile[] {
	const byId = new Map<string, ProductTile>();
	for (const tile of tiles) if (!byId.has(tile.id)) byId.set(tile.id, tile);
	return [...byId.values()];
}
