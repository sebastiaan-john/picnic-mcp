import {
	Client,
	StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { afterEach, describe, expect, it } from "bun:test";
import PicnicClient from "picnic-api";
import { createServer } from "./server";
import {
	type PicnicApi,
	type Session,
	TwoFactorRequiredError,
} from "./session";

const RECIPE_ID = "0123456789abcdef01234567";

interface Calls {
	addProductToCart: Array<[string, number]>;
	startCheckout: unknown[];
	initiatePayment: unknown[];
	confirmOrder: string[];
	sent: number;
	verified: string[];
	recipe: unknown[][];
}

function fakeSession(
	opts: {
		twoFactorPending?: boolean;
		addFails?: boolean;
		promoError?: Error;
		cartCount?: number;
		checkoutIssue?: boolean;
		checkoutStatus?: string;
	} = {},
) {
	const calls: Calls = {
		addProductToCart: [],
		startCheckout: [],
		initiatePayment: [],
		confirmOrder: [],
		sent: 0,
		verified: [],
		recipe: [],
	};
	let pending = opts.twoFactorPending ?? false;
	const api = {
		countryCode: "NL",
		catalog: {
			search: async (query: string) => [
				{
					id: "s1",
					name: `Result for ${query}`,
					display_price: 199,
					unit_quantity: "1 l",
					max_count: 50,
					image_id: "img",
					decorators: [],
					price_ranges: null,
				},
			],
			getImageAsDataUri: async () => "data:image/png;base64,AQID",
			getProductDetailsPage: async () => ({
				layout: {
					body: {
						id: "product-details-page-root-main-container",
						pml: {
							component: {
								children: [
									{
										type: "CONTAINER",
										child: {
											type: "RICH_TEXT",
											textType: "HEADER1",
											markdown: "#(#333333)Skyr#(#333333)",
										},
									},
									{
										type: "RICH_TEXT",
										markdown: "Picnic",
										textAttributes: { weight: "REGULAR" },
									},
								],
							},
						},
					},
				},
			}),
		},
		app: {
			getPage: async () => {
				if (opts.promoError) throw opts.promoError;
				return {};
			},
		},
		cart: {
			getDeliverySlots: async () => ({
				selected_slot: { slot_id: "b" },
				delivery_slots: [
					"2026-10-14",
					"2026-10-14",
					"2026-10-15",
					"2026-10-16",
				].map((day, i) => ({
					slot_id: String.fromCharCode(97 + i),
					window_start: `${day}T08:00:00.000+02:00`,
					window_end: `${day}T09:00:00.000+02:00`,
					cut_off_time: `${day}T13:00:00.000+02:00`,
					is_available: true,
					selected: i === 1,
				})),
			}),
			getCart: async () => ({
				mts: 1700000000000,
				total_count: opts.cartCount ?? 3,
				selected_slot: { slot_id: "slot-1", state: "EXPLICIT" },
			}),
			startCheckout: async (input: unknown) => {
				calls.startCheckout.push(input);
				if (opts.checkoutIssue) {
					throw new PicnicClient.CheckoutIssueError({
						code: "CART_HAS_ISSUES",
						title: "Age check",
						issueMessage: "Confirm you are 18 or older.",
						resolveKey: "age_verified",
						blocking: true,
						issueType: "LEGACY_ALCOHOL_AGE_VERIFICATION_REQUIRED",
					});
				}
				return {
					order_id: "order-1",
					total_price: 2599,
					total_count: 3,
					total_deposit: 25,
					total_savings: 0,
					transaction_expiry: "2026-10-13T10:00:00Z",
					delivery_slots: [
						{
							slot_id: "slot-1",
							window_start: "2026-10-14T08:00:00Z",
							window_end: "2026-10-14T10:00:00Z",
							selected: true,
						},
					],
				};
			},
			initiatePayment: async (...args: unknown[]) => {
				calls.initiatePayment.push(args);
				return {
					payment_id: "pay-1",
					transaction_id: "tx-1",
					issuer_authentication_url: "https://bank.test/pay",
					action: { type: "REDIRECT", redirect_url: "https://bank.test/pay" },
				};
			},
			getCheckoutStatus: async () => ({
				checkout_status: opts.checkoutStatus ?? "FINISHED",
			}),
			confirmOrder: async (id: string) => {
				calls.confirmOrder.push(id);
				return {
					order_id: id,
					delivery_slot: {
						slot_id: "slot-1",
						window_start: "2026-10-14T08:00:00Z",
						window_end: "2026-10-14T10:00:00Z",
					},
					analytics: null,
				};
			},
			addProductToCart: async (id: string, count: number) => {
				calls.addProductToCart.push([id, count]);
				if (opts.addFails) throw new Error("Client version is required");
				return {
					id: "cart",
					items: [],
					delivery_slots: [],
					selected_slot: { slot_id: "", state: "IMPLICIT" },
					total_count: count,
					total_price: 199 * count,
					checkout_total_price: 199 * count,
				};
			},
		},
		delivery: {
			getDeliveryPosition: async () => {
				throw new Error("404 Not Found");
			},
			getDeliveryScenario: async () => ({ eta: "x" }),
		},
		recipe: {
			getRecipe: async (id: string, portions?: number) => {
				calls.recipe.push(["getRecipe", id, portions]);
				return {
					id: RECIPE_ID,
					name: "Pasta",
					portions: portions ?? 2,
					defaultPortions: 2,
					isSaved: false,
					imageId: "recipes/abc",
					ingredients: [
						{
							sellingUnitId: "s9",
							name: null,
							quantity: 2,
							status: "ACTIVE",
							checked: true,
						},
					],
					note: null,
				};
			},
			getRecipeDetailsPage: async (...args: unknown[]) => {
				calls.recipe.push(["getRecipeDetailsPage", ...args]);
				return {
					type: "RICH_TEXT",
					markdown: "Zutaten\nNudeln 500 g\nSchritt 1\nKochen.",
				};
			},
		},
	} as unknown as PicnicApi;
	const session: Session = {
		call: (fn) =>
			pending ? Promise.reject(new TwoFactorRequiredError()) : fn(api),
		sendTwoFactorCode: async () => {
			calls.sent++;
			return pending;
		},
		verifyTwoFactorCode: async (code) => {
			calls.verified.push(code);
			pending = false;
		},
	};
	return { session, calls };
}

type ToolResult = Awaited<ReturnType<Client["callTool"]>>;
const text = (result: ToolResult) =>
	result.content.map((c) => (c.type === "text" ? c.text : "")).join("");
const payload = (result: ToolResult) => JSON.parse(text(result));
const noop = async () => {};

describe("picnic-mcp server", () => {
	let client: Client;
	let close: () => Promise<void> = noop;

	async function connect(session: Session) {
		const handler = createMcpHandler(() => createServer(session));
		const transport = new StreamableHTTPClientTransport(
			new URL("http://test.local/mcp"),
			{
				fetch: (url, init) => handler.fetch(new Request(url, init)),
			},
		);
		client = new Client({ name: "test", version: "0.0.0" });
		await client.connect(transport);
		close = async () => {
			await client.close();
			await handler.close();
		};
		return client;
	}

	afterEach(() => close());

	it("lists every tool with annotations, a description, and a description per argument", async () => {
		await connect(fakeSession().session);
		const { tools } = await client.listTools();
		expect(tools.map((t) => t.name).toSorted()).toEqual([
			"picnic_add_recipe_to_cart",
			"picnic_add_to_cart",
			"picnic_cancel_checkout",
			"picnic_cancel_delivery",
			"picnic_clear_cart",
			"picnic_confirm_order",
			"picnic_get_account",
			"picnic_get_cart",
			"picnic_get_checkout_status",
			"picnic_get_deliveries",
			"picnic_get_delivery",
			"picnic_get_delivery_slots",
			"picnic_get_product",
			"picnic_get_product_image",
			"picnic_get_promotions",
			"picnic_get_recipe",
			"picnic_get_recipes",
			"picnic_remove_from_cart",
			"picnic_remove_recipe_from_cart",
			"picnic_save_recipe",
			"picnic_search_products",
			"picnic_send_2fa_code",
			"picnic_set_delivery_slot",
			"picnic_start_checkout",
			"picnic_track_delivery",
			"picnic_unsave_recipe",
			"picnic_verify_2fa_code",
		]);
		for (const tool of tools) {
			expect(tool.description, tool.name).toBeTruthy();
			expect(tool.annotations?.readOnlyHint, tool.name).toBeBoolean();
			for (const [name, schema] of Object.entries(
				tool.inputSchema.properties ?? {},
			)) {
				const described =
					typeof schema === "object" &&
					schema !== null &&
					"description" in schema;
				expect(described, `${tool.name}.${name}`).toBe(true);
			}
		}
		const byName = new Map(tools.map((t) => [t.name, t]));
		expect(byName.get("picnic_add_to_cart")?.annotations).toMatchObject({
			destructiveHint: true,
			idempotentHint: false,
		});
		expect(byName.get("picnic_clear_cart")?.annotations?.idempotentHint).toBe(
			true,
		);
		expect(byName.get("picnic_get_cart")?.annotations?.readOnlyHint).toBe(true);
		expect(
			byName.get("picnic_send_2fa_code")?.annotations?.idempotentHint,
		).toBe(false);
	});

	it("returns trimmed search results as JSON text", async () => {
		await connect(fakeSession().session);
		const result = await client.callTool({
			name: "picnic_search_products",
			arguments: { query: "melk" },
		});
		expect(result.isError).toBeFalsy();
		expect(payload(result)).toEqual({
			query: "melk",
			results: [
				{
					id: "s1",
					name: "Result for melk",
					price: 199,
					unit: "1 l",
					max_count: 50,
					image_id: "img",
				},
			],
			pagination: {
				offset: 0,
				limit: 10,
				returned: 1,
				total: 1,
				has_more: false,
			},
		});
	});

	it("rejects invalid arguments and path-like ids before the handler runs", async () => {
		const { session, calls } = fakeSession();
		await connect(session);
		const zero = await client.callTool({
			name: "picnic_add_to_cart",
			arguments: { product_id: "s1", count: 0 },
		});
		expect(zero.isError).toBe(true);
		const traversal = await client.callTool({
			name: "picnic_get_delivery",
			arguments: { delivery_id: "../../cart/clear?" },
		});
		expect(traversal.isError).toBe(true);
		expect(text(traversal)).toMatch(/Ids contain only/);
		expect(calls.addProductToCart).toEqual([]);
	});

	it("reports a failed cart mutation as ambiguous and does not retry", async () => {
		const { session, calls } = fakeSession({ addFails: true });
		await connect(session);
		const result = await client.callTool({
			name: "picnic_add_to_cart",
			arguments: { product_id: "s1", count: 2 },
		});
		expect(result.isError).toBe(true);
		expect(text(result)).toMatch(/Client version is required/);
		expect(text(result)).toMatch(/picnic_get_cart/);
		expect(calls.addProductToCart).toEqual([["s1", 2]]);
	});

	it("finds the product name when Picnic wraps the header", async () => {
		await connect(fakeSession().session);
		const result = await client.callTool({
			name: "picnic_get_product",
			arguments: { product_id: "s1014487" },
		});
		expect(result.isError).toBeFalsy();
		expect(payload(result)).toMatchObject({ name: "Skyr", brand: "Picnic" });
	});

	it("limits delivery slots to the first offered days", async () => {
		await connect(fakeSession().session);
		const twoDays = await client.callTool({
			name: "picnic_get_delivery_slots",
			arguments: { days: 2 },
		});
		expect(payload(twoDays)).toMatchObject({
			selected_slot_id: "b",
			days: ["2026-10-14", "2026-10-15"],
		});
		expect(
			payload(twoDays).slots.map((s: { slot_id: string }) => s.slot_id),
		).toEqual(["a", "b", "c"]);
	});

	it("starts checkout with the cart's mts and returns the payment URL", async () => {
		const { session, calls } = fakeSession();
		await connect(session);
		const result = await client.callTool({
			name: "picnic_start_checkout",
			arguments: {},
		});
		expect(result.isError).toBeFalsy();
		expect(payload(result)).toMatchObject({
			order_id: "order-1",
			transaction_id: "tx-1",
			payment_url: "https://bank.test/pay",
			total_price: 2599,
			delivery_slot: { slot_id: "slot-1" },
		});
		expect(calls.startCheckout).toEqual([
			{ mts: 1700000000000, resolve_key: undefined },
		]);
		expect(calls.initiatePayment).toEqual([["order-1", "https://picnic.app/"]]);
	});

	it("refuses to start checkout on an empty cart", async () => {
		const { session, calls } = fakeSession({ cartCount: 0 });
		await connect(session);
		const result = await client.callTool({
			name: "picnic_start_checkout",
			arguments: {},
		});
		expect(result.isError).toBe(true);
		expect(text(result)).toMatch(/empty/);
		expect(calls.startCheckout).toEqual([]);
	});

	it("surfaces a checkout issue with its resolve_key and passes it back", async () => {
		const { session, calls } = fakeSession({ checkoutIssue: true });
		await connect(session);
		const result = await client.callTool({
			name: "picnic_start_checkout",
			arguments: {},
		});
		expect(result.isError).toBe(true);
		expect(text(result)).toMatch(/Age check/);
		expect(text(result)).toMatch(/resolve_key "age_verified"/);
		expect(calls.initiatePayment).toEqual([]);

		await client.callTool({
			name: "picnic_start_checkout",
			arguments: { resolve_key: "age_verified" },
		});
		expect(calls.startCheckout[1]).toEqual({
			mts: 1700000000000,
			resolve_key: "age_verified",
		});
	});

	it("confirms an order only once its payment has finished", async () => {
		const pendingFixture = fakeSession({ checkoutStatus: "PENDING" });
		await connect(pendingFixture.session);
		const pending = await client.callTool({
			name: "picnic_confirm_order",
			arguments: { order_id: "order-1", transaction_id: "tx-1" },
		});
		expect(pending.isError).toBe(true);
		expect(text(pending)).toMatch(/PENDING/);
		expect(pendingFixture.calls.confirmOrder).toEqual([]);
		await close();

		const { session, calls } = fakeSession();
		await connect(session);
		const placed = await client.callTool({
			name: "picnic_confirm_order",
			arguments: { order_id: "order-1", transaction_id: "tx-1" },
		});
		expect(payload(placed)).toEqual({
			order_id: "order-1",
			delivery_slot: {
				slot_id: "slot-1",
				window_start: "2026-10-14T08:00:00Z",
				window_end: "2026-10-14T10:00:00Z",
			},
		});
		expect(calls.confirmOrder).toEqual(["order-1"]);
	});

	it("steers the model to the 2FA tools while verification is pending", async () => {
		const { session, calls } = fakeSession({ twoFactorPending: true });
		await connect(session);
		const blocked = await client.callTool({
			name: "picnic_get_cart",
			arguments: {},
		});
		expect(blocked.isError).toBe(true);
		expect(text(blocked)).toMatch(/picnic_send_2fa_code/);

		const sent = await client.callTool({
			name: "picnic_send_2fa_code",
			arguments: {},
		});
		expect(payload(sent)).toEqual({ sent: true });
		expect(calls.sent).toBe(1);

		const verified = await client.callTool({
			name: "picnic_verify_2fa_code",
			arguments: { code: "123456" },
		});
		expect(payload(verified)).toEqual({ verified: true });
		expect(calls.verified).toEqual(["123456"]);
	});

	it("reports tracking parts independently", async () => {
		await connect(fakeSession().session);
		const result = await client.callTool({
			name: "picnic_track_delivery",
			arguments: { delivery_id: "d1" },
		});
		expect(payload(result)).toEqual({
			position: { error: "404 Not Found" },
			scenario: { value: { eta: "x" } },
		});
	});

	it("returns product images as image content", async () => {
		await connect(fakeSession().session);
		const result = await client.callTool({
			name: "picnic_get_product_image",
			arguments: { image_id: "recipes/abc" },
		});
		expect(result.content).toEqual([
			{ type: "image", data: "AQID", mimeType: "image/png" },
		]);
	});

	it("explains the PICNIC_AGENT workaround when the promotions page changes format", async () => {
		const rsc = new PicnicClient.UnexpectedPageFormatError(
			"promo-page-all-promos-redirect",
			"rsc",
		);
		await connect(fakeSession({ promoError: rsc }).session);
		const result = await client.callTool({
			name: "picnic_get_promotions",
			arguments: {},
		});
		expect(result.isError).toBe(true);
		expect(text(result)).toMatch(/PICNIC_AGENT/);

		await close();
		await connect(
			fakeSession({ promoError: new Error("500 Internal Server Error") })
				.session,
		);
		const other = await client.callTool({
			name: "picnic_get_promotions",
			arguments: {},
		});
		expect(text(other)).toMatch(/500/);
		expect(text(other)).not.toMatch(/PICNIC_AGENT/);
	});

	it("composes structured recipe details with the page text at the settled portion count", async () => {
		const { session, calls } = fakeSession();
		await connect(session);
		const result = await client.callTool({
			name: "picnic_get_recipe",
			arguments: {
				recipe: `https://picnic.app/nl/recepten/${RECIPE_ID}/pasta`,
			},
		});
		expect(calls.recipe).toEqual([
			["getRecipe", RECIPE_ID, undefined],
			["getRecipeDetailsPage", RECIPE_ID, 2],
		]);
		expect(payload(result)).toMatchObject({
			id: RECIPE_ID,
			url: `https://picnic.app/nl/recepten/${RECIPE_ID}`,
			portions: 2,
			default_portions: 2,
			ingredients: [
				{
					product_id: "s9",
					name: null,
					quantity: 2,
					selected_by_default: true,
				},
			],
			ingredient_lines: ["Nudeln 500 g"],
			instructions: ["Kochen."],
		});

		calls.recipe.length = 0;
		await client.callTool({
			name: "picnic_get_recipe",
			arguments: { recipe: RECIPE_ID, portions: 4 },
		});
		expect(calls.recipe).toEqual([
			["getRecipe", RECIPE_ID, 4],
			["getRecipeDetailsPage", RECIPE_ID, 4],
		]);
	});
});
