import { describe, expect, it } from "bun:test";
import { recipeTextFromPage } from "./recipe-page";

function page(lines: string[]) {
	return {
		body: {
			type: "STATE_BOUNDARY",
			child: {
				type: "BLOCK",
				children: [
					{
						type: "SUSPENSE",
						analytics: { contexts: [{ data: { markdown: "ignored" } }] },
					},
					{
						type: "PML",
						pml: {
							component: {
								type: "STACK",
								children: lines.map((markdown) => ({
									type: "RICH_TEXT",
									markdown,
								})),
							},
						},
					},
				],
			},
		},
	};
}

describe("recipeTextFromPage", () => {
	it("parses a German recipe despite product cards with their own tabs", () => {
		const text = recipeTextFromPage(
			page([
				"Gyros-Reispfanne mit Feta",
				"Vorbereitung",
				"10 min",
				"20 min",
				"Gesamtzeit",
				"Zutaten",
				"Paprika Mix",
				"2.24",
				"Zubereitung",
				"1 Portion des Originalrezepts enthält ungefähr:",
				"Zutaten",
				"**Paprika** 1 Stk.",
				"**Basmatireis** 100 g",
				"**Eigene Zutaten:** 0.5 Stk. Knoblauch, Olivenöl, Salz und Pfeffer",
				"**Du benötigst:** Bratpfanne",
				"So wird's gemacht",
				"2 Portionen",
				"Schritt 1",
				"Paprika waschen und würfeln.",
				"Schritt 2",
				"Gyros anbraten. [Zurück zum Original](action://open-undo)",
				"Tipp",
				"Dazu passt ein Salat.",
			]),
		);
		expect(text).toEqual({
			prepTime: "10 min",
			totalTime: "20 min",
			ingredients: ["Paprika 1 Stk.", "Basmatireis 100 g"],
			pantryIngredients: ["0.5 Stk. Knoblauch", "Olivenöl", "Salz und Pfeffer"],
			tools: ["Bratpfanne"],
			instructions: [
				"Paprika waschen und würfeln.",
				"Gyros anbraten. Zurück zum Original",
			],
			tips: ["Dazu passt ein Salat."],
		});
	});

	it("handles Dutch and French headers, step labels, and time words", () => {
		const nl = recipeTextFromPage(
			page([
				"Totaal 30 minuten",
				"Ingrediënten",
				"**Rijst** 200 g",
				"Bereiding",
				"4 porties",
				"Stap 1",
				"Kook de rijst.",
			]),
		);
		expect(nl.totalTime).toBe("Totaal 30 minuten");
		expect(nl.ingredients).toEqual(["Rijst 200 g"]);
		expect(nl.instructions).toEqual(["Kook de rijst."]);

		const fr = recipeTextFromPage(
			page([
				"Ingrédients",
				"**Riz** 200 g",
				"Préparation",
				"4 personnes",
				"Étape 1",
				"Cuire le riz.",
			]),
		);
		expect(fr.ingredients).toEqual(["Riz 200 g"]);
		expect(fr.instructions).toEqual(["Cuire le riz."]);
	});

	it("keeps steps that mention portions and ends ingredients at the first step", () => {
		const text = recipeTextFromPage(
			page([
				"Zutaten",
				"Reis 1 Portion",
				"Schritt 1",
				"Den Teig in 4 Portionen teilen.",
				"Schritt 2",
				"Backen.",
			]),
		);
		expect(text.ingredients).toEqual(["Reis 1 Portion"]);
		expect(text.instructions).toEqual([
			"Den Teig in 4 Portionen teilen.",
			"Backen.",
		]);
	});

	it("falls back to the text after the instruction header when steps are unlabeled", () => {
		const text = recipeTextFromPage(
			page([
				"Zutaten",
				"Nudeln 500 g",
				"Zubereitung",
				"Nudeln kochen.",
				"Abgießen.",
				"Tipp",
				"Parmesan dazu.",
			]),
		);
		expect(text.instructions).toEqual(["Nudeln kochen.", "Abgießen."]);
		expect(text.tips).toEqual(["Parmesan dazu."]);
	});

	it("ignores a tip header that precedes the recipe body", () => {
		const text = recipeTextFromPage(
			page([
				"Tipp",
				"Kaufe frisch.",
				"Zutaten",
				"Mehl 1 kg",
				"Schritt 1",
				"Kneten.",
			]),
		);
		expect(text.tips).toEqual([]);
		expect(text.ingredients).toEqual(["Mehl 1 kg"]);
	});

	it("returns empty text for pages without recipe sections", () => {
		const empty = recipeTextFromPage(page(["My Recipe"]));
		expect(empty.ingredients).toEqual([]);
		expect(empty.instructions).toEqual([]);
		expect(recipeTextFromPage(null).instructions).toEqual([]);
	});
});
