import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { recipeUrl, resolveRecipeId } from "../picnic/recipe-id";
import type { PicnicApi, Session } from "../session";
import {
	CART_MUTATION,
	DESTRUCTIVE,
	IDEMPOTENT_WRITE,
	json,
	mutateCart,
	NOT_IDEMPOTENT,
	READ_ONLY,
} from "./common";

const recipeRef = z
	.string()
	.min(1)
	.describe(
		"A picnic.app recipe URL, a share link, or a recipe id from picnic_get_recipes",
	);
const portionsArg = z
	.number()
	.int()
	.min(1)
	.optional()
	.describe("Number of portions; defaults to the recipe's own");

function resolve(client: PicnicApi, ref: string) {
	return resolveRecipeId(ref, (url) => client.app.resolveDeeplink(url));
}

/**
 * picnic-api refetches the page once when Picnic renders another portion
 * count than asked; some counts are still rejected, so check the result.
 */
async function loadRecipe(client: PicnicApi, id: string, portions?: number) {
	const recipe = await client.recipe.getRecipe(id, { portions });
	if (portions !== undefined && recipe.portions !== portions) {
		throw new Error(
			`Picnic rendered recipe ${id} at ${recipe.portions} portions instead of ${portions}; try another portion count.`,
		);
	}
	return recipe;
}

export function registerRecipeTools(server: McpServer, session: Session) {
	server.registerTool(
		"picnic_get_recipe",
		{
			title: "Get recipe",
			description:
				"A Picnic recipe: name, portions, times, ingredient products with ids, unit counts, the amount the recipe needs, and price in cents (type CUPBOARD is a pantry staple the user likely has; CORE_STOCKABLE keeps, such as stock cubes), steps, and allergens. Pass `portions` to scale.",
			inputSchema: z.object({ recipe: recipeRef, portions: portionsArg }),
			annotations: READ_ONLY,
		},
		({ recipe, portions }) =>
			session.call(async (client) => {
				const id = await resolve(client, recipe);
				const details = await loadRecipe(client, id, portions);
				return json({
					id: details.id,
					name: details.name,
					url: recipeUrl(client.countryCode, details.id),
					portions: details.portions,
					default_portions: details.defaultPortions,
					is_saved: details.isSaved,
					image_id: details.imageId,
					description: details.description,
					times: details.times,
					ingredients: details.ingredients.map((i) => ({
						product_id: i.sellingUnitId,
						name: i.name,
						quantity: i.quantity,
						needed: i.neededText,
						type: i.type,
						selected_by_default: i.checked,
						price: i.price,
						...(!i.isAvailable && {
							unavailable: i.unavailableReason ?? true,
						}),
					})),
					steps: details.steps,
					...(details.stepsWarning && { steps_warning: details.stepsWarning }),
					allergens: details.allergens,
					note: details.note,
				});
			}),
	);

	server.registerTool(
		"picnic_get_recipes",
		{
			title: "Get saved or own recipes",
			description:
				"Recipes in the user's cookbook: `saved` for bookmarked recipes, `own` for recipes the user created. Returns id, name, and URL; use picnic_get_recipe for details.",
			inputSchema: z.object({
				kind: z
					.enum(["saved", "own"])
					.describe("Which cookbook section to list"),
			}),
			annotations: READ_ONLY,
		},
		({ kind }) =>
			session.call(async (client) => {
				const list = {
					saved: () => client.recipe.getSavedRecipes(),
					own: () => client.recipe.getUserDefinedRecipes(),
				};
				const recipes = await list[kind]();
				return json({
					kind,
					recipes: recipes.map((r) => ({
						id: r.id,
						name: r.name,
						url: recipeUrl(client.countryCode, r.id),
					})),
				});
			}),
	);

	server.registerTool(
		"picnic_save_recipe",
		{
			title: "Save recipe",
			description: "Bookmarks a recipe in the user's cookbook.",
			inputSchema: z.object({ recipe: recipeRef }),
			annotations: IDEMPOTENT_WRITE,
		},
		({ recipe }) =>
			session.call(async (client) => {
				const id = await resolve(client, recipe);
				await client.recipe.saveRecipe(id);
				return json({ id, saved: true });
			}),
	);

	server.registerTool(
		"picnic_unsave_recipe",
		{
			title: "Unsave recipe",
			description: "Removes a recipe bookmark from the user's cookbook.",
			inputSchema: z.object({ recipe: recipeRef }),
			annotations: IDEMPOTENT_WRITE,
		},
		({ recipe }) =>
			session.call(async (client) => {
				const id = await resolve(client, recipe);
				await client.recipe.unsaveRecipe(id);
				return json({ id, saved: false });
			}),
	);

	server.registerTool(
		"picnic_add_recipe_to_cart",
		{
			title: "Add recipe to cart",
			description: `Adds a recipe's ingredients to the cart as one bundle, scaled to \`portions\`. Returns the assigned portions and whether any ingredient is unavailable; call picnic_get_cart to see the items. ${NOT_IDEMPOTENT}`,
			inputSchema: z.object({ recipe: recipeRef, portions: portionsArg }),
			annotations: CART_MUTATION,
		},
		({ recipe, portions }) =>
			session.call(async (client) => {
				const id = await resolve(client, recipe);
				return mutateCart(`Adding recipe ${id} to the cart`, async () => {
					const result = await client.recipe.addRecipeToCart(id, {
						portions,
					});
					return json({
						id,
						portions: result.assignedNumberOfPortions,
						any_unavailable_ingredient: result.anyUnavailableIngredient,
					});
				});
			}),
	);

	server.registerTool(
		"picnic_remove_recipe_from_cart",
		{
			title: "Remove recipe from cart",
			description:
				"Removes a recipe bundle added with picnic_add_recipe_to_cart and returns the removed products; other cart items stay.",
			inputSchema: z.object({ recipe: recipeRef }),
			annotations: DESTRUCTIVE,
		},
		({ recipe }) =>
			session.call(async (client) => {
				const id = await resolve(client, recipe);
				const result = await client.recipe.removeRecipeFromCart(id);
				return json({
					id,
					removed: result.SURemoved.map((u) => ({
						product_id: u.selling_unit_id,
						quantity: u.quantity,
					})),
				});
			}),
	);
}
