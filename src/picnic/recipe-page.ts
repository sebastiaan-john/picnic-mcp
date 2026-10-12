/**
 * Picnic serves a recipe as a rendered UI tree ("Fusion" page). picnic-api
 * extracts the structured part (name, portions, ingredient products). The
 * human-readable part lives only in RICH_TEXT markdown: ingredient lines with
 * amounts, pantry items, equipment, cooking steps, tips, timing. This module
 * reads those lines, delimited by the localized section headers and
 * "Schritt/Stap/Étape N" step labels. Product cards on the same page carry
 * their own "Zutaten" and "Zubereitung" tabs, so the recipe's headers are the
 * ones that sit next to its step labels.
 */

export interface RecipeText {
	prepTime: string | null;
	totalTime: string | null;
	/** Ingredient lines with amounts, e.g. "Paprika 1 Stk.". */
	ingredients: string[];
	/** Items the user supplies themselves (the "Eigene Zutaten" line). */
	pantryIngredients: string[];
	/** Equipment (the "Du benötigst" line). */
	tools: string[];
	instructions: string[];
	tips: string[];
}

const INGREDIENT_HEADER_RE = /^(zutaten|ingredi[eë]nten|ingr[eé]dients?)$/i;
const INSTRUCTION_HEADER_RE =
	/^(zubereitung(sschritte)?|anleitung|so wird.?s gemacht|bereiding(swijze)?|zo maak je het|pr[eé]paration|instructions?)$/i;
const STEP_LABEL_RE = /^(schritt|stap|[ée]tape|step)\s*\d+$/i;
const TIP_HEADER_RE = /^(tipps?|tips?|astuces?)$/i;
const TIME_RE = /\b\d+\s*(?:min(?:uten|utes)?|std|uur|h)\b/i;
const TOTAL_TIME_RE = /\b(gesamt\w*|insgesamt|total\w*|totaal)\b/i;
/** A standalone portion count such as "2 Portionen", shown as UI chrome, not content. */
const SERVINGS_VALUE_RE =
	/^\d+\s*(portion(en|s)?|porties|personen|personnes?|pers\.?)$/i;
const NUMBER_ONLY_RE = /^\d+[.)]?$/;
const PANTRY_LINE_RE =
	/^(eigene zutaten|eigen recept|own ingredients|propres ingr[ée]dients?)\s*:\s*(.+)$/i;
const TOOLS_LINE_RE =
	/^(du ben[öo]tigst|je hebt nodig|you.?ll need|tu auras besoin)\s*:\s*(.+)$/i;
const BUTTON_WORDS = new Set([
	"ansehen",
	"hinzufügen",
	"view",
	"add",
	"bekijken",
	"toevoegen",
	"voir",
	"ajouter",
]);
/** Subtrees that hold actions, analytics, or fallback UI rather than content. */
const SKIP_KEYS = new Set([
	"analytics",
	"tracking_attributes",
	"loadingConfig",
	"errorConfig",
	"placeholder",
	"fallbackSource",
	"presets",
	"viewabilityListeners",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Strips Picnic colour markup, action links, headings, bullets, and emphasis. */
function cleanLine(line: string): string {
	return line
		.replace(/#\(#[0-9a-fA-F]{6}\)/g, "")
		.replace(/\[([^\]]+)\]\((?:action|app|https?):\/\/[^)]*\)/g, "$1")
		.replace(/^\s*#{1,6}\s+/, "")
		.replace(/^\s*[-*+]\s+/, "")
		.replace(/\*\*([^*]+)\*\*/g, "$1")
		.replace(/__([^_]+)__/g, "$1")
		.replace(/\s+/g, " ")
		.trim();
}

function textLines(page: unknown): string[] {
	const lines: string[] = [];
	const visit = (node: unknown): void => {
		if (Array.isArray(node)) {
			for (const child of node) visit(child);
			return;
		}
		if (!isRecord(node)) return;
		if (node.type === "RICH_TEXT" && typeof node.markdown === "string") {
			for (const raw of node.markdown.split("\n")) {
				const line = cleanLine(raw);
				if (line) lines.push(line);
			}
		}
		for (const [key, value] of Object.entries(node)) {
			if (!SKIP_KEYS.has(key)) visit(value);
		}
	};
	visit(page);
	return lines;
}

function splitList(value: string): string[] {
	return value
		.split(",")
		.map((part) => part.trim())
		.filter(Boolean);
}

/** UI chrome that sits between content lines: counters, buttons, portion pickers, step labels. */
function isNoise(line: string): boolean {
	return (
		NUMBER_ONLY_RE.test(line) ||
		line.length < 2 ||
		BUTTON_WORDS.has(line.toLowerCase()) ||
		SERVINGS_VALUE_RE.test(line) ||
		STEP_LABEL_RE.test(line)
	);
}

/** Smallest non-negative candidate; callers always include `lines.length`. */
function firstEnd(candidates: number[]): number {
	return Math.min(...candidates.filter((c) => c >= 0));
}

function firstIndex(lines: string[], re: RegExp, from: number): number {
	const i = lines.slice(from).findIndex((line) => re.test(line));
	return i < 0 ? -1 : from + i;
}

export function recipeTextFromPage(page: unknown): RecipeText {
	const result: RecipeText = {
		prepTime: null,
		totalTime: null,
		ingredients: [],
		pantryIngredients: [],
		tools: [],
		instructions: [],
		tips: [],
	};
	const lines = textLines(page);
	const stepStarts = lines.flatMap((line, i) =>
		STEP_LABEL_RE.test(line) ? [i] : [],
	);
	const firstStep = stepStarts[0] ?? -1;

	// The recipe's ingredient header is the last one before its steps; earlier
	// ones belong to product cards. Without steps, the first header has to do.
	let ingredientStart = -1;
	for (const [i, line] of lines.entries()) {
		if (!INGREDIENT_HEADER_RE.test(line)) continue;
		if (firstStep >= 0 && i > firstStep) break;
		ingredientStart = i;
		if (firstStep < 0) break;
	}
	const instructionStart = firstIndex(
		lines,
		INSTRUCTION_HEADER_RE,
		ingredientStart + 1,
	);
	const bodyStart = Math.max(ingredientStart, instructionStart, firstStep);
	const tipStart =
		bodyStart >= 0 ? firstIndex(lines, TIP_HEADER_RE, bodyStart + 1) : -1;

	// Timing sits above the ingredients; a step that mentions minutes is not the recipe time.
	const metaEnd = firstEnd([
		ingredientStart,
		instructionStart,
		firstStep,
		lines.length,
	]);
	for (let i = 0; i < metaEnd; i++) {
		const line = lines[i] ?? "";
		if (!TIME_RE.test(line)) continue;
		const isTotal = [lines[i - 1], line, lines[i + 1]].some(
			(l) => l !== undefined && TOTAL_TIME_RE.test(l),
		);
		if (isTotal) result.totalTime ??= line;
		else result.prepTime ??= line;
	}

	if (ingredientStart >= 0) {
		const ingredientEnd = firstEnd([
			instructionStart,
			firstIndex(lines, STEP_LABEL_RE, ingredientStart + 1),
			tipStart,
			lines.length,
		]);
		for (const line of lines.slice(ingredientStart + 1, ingredientEnd)) {
			if (isNoise(line)) continue;
			const pantry = PANTRY_LINE_RE.exec(line);
			if (pantry?.[2]) {
				result.pantryIngredients.push(...splitList(pantry[2]));
				continue;
			}
			const tools = TOOLS_LINE_RE.exec(line);
			if (tools?.[2]) {
				result.tools.push(...splitList(tools[2]));
				continue;
			}
			result.ingredients.push(line);
		}
	}

	const instructionsEnd = tipStart >= 0 ? tipStart : lines.length;
	if (stepStarts.length > 0) {
		for (const [n, start] of stepStarts.entries()) {
			const stepEnd = Math.min(
				stepStarts[n + 1] ?? instructionsEnd,
				instructionsEnd,
			);
			const body = lines
				.slice(start + 1, stepEnd)
				.filter((line) => !isNoise(line));
			if (body.length > 0) result.instructions.push(body.join(" "));
		}
	} else if (instructionStart >= 0) {
		result.instructions = lines
			.slice(instructionStart + 1, instructionsEnd)
			.filter((line) => !isNoise(line));
	}

	if (tipStart >= 0) {
		result.tips = lines.slice(tipStart + 1).filter((line) => !isNoise(line));
	}

	return result;
}
