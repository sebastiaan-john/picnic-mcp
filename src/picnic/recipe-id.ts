import type { CountryCode } from "../config";

// A recipe id is a selling_group_id: 24 hex chars for Picnic's own recipes,
// 32 for recipes the user created.
// Longest first, so a 32-char id is not cut to its first 24 chars.
const HEX_ID = "[a-f0-9]{32}|[a-f0-9]{24}";
const RECIPE_ID_RE = new RegExp(`^(?:${HEX_ID})$`, "i");
const RECIPE_ID_IN_PATH_RE = new RegExp(`/(${HEX_ID})(?:[/?#]|$)`, "i");
const RECIPE_ID_PARAM_RE = new RegExp(
	`(?:selling_group_id|sellable_id|recipe_id)=(${HEX_ID})(?![a-f0-9])`,
	"i",
);

const RECIPE_PATH: Record<CountryCode, string> = {
	NL: "recepten",
	DE: "rezepte",
	FR: "recettes",
};

export function recipeUrl(countryCode: CountryCode, recipeId: string): string {
	return `https://picnic.app/${countryCode.toLowerCase()}/${RECIPE_PATH[countryCode]}/${recipeId}`;
}

/** Finds a recipe id in a bare id, a picnic.app URL, or an app.picnic:// deep link. */
export function recipeIdFromText(input: string): string | null {
	const text = input.trim();
	if (RECIPE_ID_RE.test(text)) return text.toLowerCase();
	const match =
		text.match(RECIPE_ID_IN_PATH_RE) ?? text.match(RECIPE_ID_PARAM_RE);
	return match?.[1]?.toLowerCase() ?? null;
}

function isPicnicUrl(input: string): boolean {
	try {
		const url = new URL(input);
		const host = url.hostname.toLowerCase();
		return (
			url.protocol === "https:" &&
			(host === "picnic.app" || host.endsWith(".picnic.app"))
		);
	} catch {
		return false;
	}
}

/**
 * Resolves a recipe reference to its id. Short share links such as
 * `https://picnic.app/de/go/abc123` carry no id, so they go through Picnic's
 * own deeplink resolver; only picnic.app URLs are sent there.
 */
export async function resolveRecipeId(
	input: string,
	resolveDeeplink: (url: string) => Promise<{ url: string }>,
): Promise<string> {
	const direct = recipeIdFromText(input);
	if (direct) return direct;

	const text = input.trim();
	if (isPicnicUrl(text)) {
		const id = recipeIdFromText((await resolveDeeplink(text)).url);
		if (id) return id;
	}
	throw new Error(
		`Cannot find a Picnic recipe id in "${input}". Pass a picnic.app recipe URL or a recipe id from picnic_get_recipes.`,
	);
}
