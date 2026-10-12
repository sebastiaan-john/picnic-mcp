import type {
	CallToolResult,
	ToolAnnotations,
} from "@modelcontextprotocol/server";
import * as z from "zod";

export function json(value: unknown): CallToolResult {
	return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

/**
 * picnic-api splices ids into request paths unencoded, so an id like
 * `../../cart/clear?` would reach a different endpoint under this tool's
 * annotations. Ids are therefore limited to word characters and dashes.
 */
export function idArg(description: string) {
	return z
		.string()
		.regex(/^[\w-]+$/, "Ids contain only letters, digits, _ and -")
		.describe(description);
}

export const READ_ONLY: ToolAnnotations = {
	readOnlyHint: true,
	openWorldHint: true,
};

/** A write that can be repeated without changing the outcome, such as saving a recipe. */
export const IDEMPOTENT_WRITE: ToolAnnotations = {
	readOnlyHint: false,
	destructiveHint: false,
	idempotentHint: true,
	openWorldHint: true,
};

export const NOT_IDEMPOTENT =
	"Not idempotent; each call applies again. If it fails, call picnic_get_cart before retrying.";

/** Cart writes Picnic does not deduplicate; a retried add or remove applies again. */
export const CART_MUTATION: ToolAnnotations = {
	readOnlyHint: false,
	destructiveHint: true,
	idempotentHint: false,
	openWorldHint: true,
};

/** Destructive but safe to repeat, such as clearing the cart or cancelling a delivery. */
export const DESTRUCTIVE: ToolAnnotations = {
	readOnlyHint: false,
	destructiveHint: true,
	idempotentHint: true,
	openWorldHint: true,
};

export function paginationArgs(maxLimit: number, defaultLimit: number) {
	return {
		limit: z
			.number()
			.int()
			.min(1)
			.max(maxLimit)
			.default(defaultLimit)
			.describe(`Maximum number of results (1-${maxLimit})`),
		offset: z
			.number()
			.int()
			.min(0)
			.default(0)
			.describe("Number of results to skip, for paging"),
	};
}

export function paginate<T>(all: T[], offset: number, limit: number) {
	const items = all.slice(offset, offset + limit);
	return {
		items,
		pagination: {
			offset,
			limit,
			returned: items.length,
			total: all.length,
			has_more: offset + limit < all.length,
		},
	};
}

/**
 * Picnic applies a cart mutation and renders the updated cart in one request,
 * so a failed response does not mean the write was rejected. Say so in the
 * error, and point the caller at a read instead of a retry that would apply
 * the change twice. Response mapping belongs inside `mutation` so a mapping
 * failure after a successful write carries the same warning.
 */
export async function mutateCart<T>(
	action: string,
	mutation: () => Promise<T>,
): Promise<T> {
	try {
		return await mutation();
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(
			`${action} failed: ${message}. The cart may still have changed; call picnic_get_cart before retrying, because a retry can apply the change a second time.`,
			{ cause: error },
		);
	}
}
