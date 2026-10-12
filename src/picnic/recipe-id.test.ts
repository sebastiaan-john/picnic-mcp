import { describe, expect, it } from "bun:test";
import { recipeIdFromText, recipeUrl, resolveRecipeId } from "./recipe-id";

const ID = "0123456789abcdef01234567";
const OWN_ID = "fedcba9876543210fedcba9876543210";

describe("recipeIdFromText", () => {
	it("accepts bare ids, both lengths", () => {
		expect(recipeIdFromText(`  ${ID}  `)).toBe(ID);
		expect(recipeIdFromText(OWN_ID)).toBe(OWN_ID);
		expect(recipeIdFromText(ID.toUpperCase())).toBe(ID);
	});

	it("extracts ids from recipe URLs across markets and from deep links", () => {
		expect(recipeIdFromText(`https://picnic.app/de/rezepte/${ID}/gyros`)).toBe(
			ID,
		);
		expect(recipeIdFromText(`https://picnic.app/nl/recepten/${ID}`)).toBe(ID);
		expect(recipeIdFromText(`https://picnic.app/fr/recettes/${ID}?u=1`)).toBe(
			ID,
		);
		expect(
			recipeIdFromText(
				`app.picnic://store/page;id=selling-group-details-page,selling_group_id=${OWN_ID}`,
			),
		).toBe(OWN_ID);
	});

	it("returns null for text without an id", () => {
		expect(recipeIdFromText("pasta pesto")).toBeNull();
		expect(recipeIdFromText("https://picnic.app/de/go/abc123")).toBeNull();
	});
});

const neverResolve = () => Promise.reject(new Error("should not be called"));

describe("resolveRecipeId", () => {
	it("skips the resolver when the id is in the input", async () => {
		expect(await resolveRecipeId(ID, neverResolve)).toBe(ID);
	});

	it("resolves short picnic.app share links through the deeplink resolver", async () => {
		const calls: string[] = [];
		const resolve = async (url: string) => {
			calls.push(url);
			return { url: `https://picnic.app/de/rezepte/${ID}?path=x` };
		};
		expect(
			await resolveRecipeId("https://picnic.app/de/go/abc123", resolve),
		).toBe(ID);
		expect(calls).toEqual(["https://picnic.app/de/go/abc123"]);
	});

	it("never sends non-picnic or non-https URLs to the resolver", async () => {
		const calls: string[] = [];
		const resolve = async (url: string) => {
			calls.push(url);
			return { url };
		};
		await expect(
			resolveRecipeId("https://evil.example/x", resolve),
		).rejects.toThrow(/Cannot find/);
		await expect(
			resolveRecipeId("http://picnic.app/de/go/x", resolve),
		).rejects.toThrow();
		expect(calls).toEqual([]);
	});
});

describe("recipeUrl", () => {
	it("uses the localized path per market", () => {
		expect(recipeUrl("DE", ID)).toBe(`https://picnic.app/de/rezepte/${ID}`);
		expect(recipeUrl("NL", ID)).toBe(`https://picnic.app/nl/recepten/${ID}`);
		expect(recipeUrl("FR", ID)).toBe(`https://picnic.app/fr/recettes/${ID}`);
	});
});
