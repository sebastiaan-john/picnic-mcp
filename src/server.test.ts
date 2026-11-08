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
	cancelCheckout: string[];
	sent: number;
	verified: string[];
	recipe: unknown[][];
}

type Tile = PicnicClient.Types.catalog.ProductTile;

function tile(id: string, overrides: Partial<Tile> = {}): Tile {
	return {
		id,
		name: `Product ${id}`,
		namePrefix: null,
		brand: null,
		qualityCue: null,
		imageId: null,
		displayPrice: 199,
		originalPrice: null,
		unitPrice: null,
		priceRanges: null,
		unitQuantity: "1 l",
		labels: [],
		isUnavailable: false,
		numberOfOrders: null,
		...overrides,
	};
}

function fakeSession(
	opts: {
		twoFactorPending?: boolean;
		cartCount?: number;
		noSlot?: boolean;
		checkoutIssue?: boolean;
		checkoutStatus?: string;
		paymentFails?: boolean;
		confirmFails?: boolean;
	} = {},
) {
	const calls: Calls = {
		addProductToCart: [],
		startCheckout: [],
		initiatePayment: [],
		confirmOrder: [],
		cancelCheckout: [],
		sent: 0,
		verified: [],
		recipe: [],
	};
	let pending = opts.twoFactorPending ?? false;
	const api = {
		countryCode: "NL",
		catalog: {
			getSearchResults: async (query: string) => ({
				query,
				correctedQuery: null,
				recipes: [],
				products: {
					sections: [
						{
							id: "rfy",
							type: "RFY",
							title: "Opnieuw bestellen",
							products: [
								tile("s1", { name: `Result for ${query}`, brand: "Campina" }),
							],
						},
						{
							id: "v",
							type: "VISUAL",
							title: "Zuivel",
							products: [
								tile("s1"),
								tile("s2", {
									originalPrice: 249,
									labels: [
										{
											position: "bottomLeft",
											type: "PROMO",
											text: "1+1 gratis",
										},
									],
								}),
							],
						},
					],
				},
			}),
			getFavorites: async () => ({
				aisles: [
					{
						id: "DAIRY",
						title: "Zuivel",
						products: [tile("s7")],
						complete: true,
					},
					{ id: "PANTRY", title: "Voorraad", products: [], complete: false },
					{ id: "PET", title: "Dier", products: [], complete: false },
				],
			}),
			getFavoritesInAisle: async (aisleId: string) =>
				aisleId === "PANTRY" ? [tile("s8")] : [],
			getPromotions: async () => ({
				sections: [
					{
						id: "a",
						title: "Uitgelicht",
						products: [tile("s3", { originalPrice: 299 })],
						groups: [
							{
								id: "g1",
								name: "Alpro vers",
								example: "Bv. sojayoghurt",
								label: "2 voor €3.99",
							},
						],
					},
					{
						id: "b",
						title: "Zuivel",
						products: [tile("s3"), tile("s4")],
						groups: [],
					},
				],
			}),
			getImageAsDataUri: async () => "data:image/png;base64,AQID",
		},
		cart: {
			getDeliverySlots: async () => ({
				selectedSlot: { slotId: "b" },
				slots: ["2026-10-14", "2026-10-14", "2026-10-15", "2026-10-16"].map(
					(day, i) => ({
						slotId: String.fromCharCode(97 + i),
						windowStart: `${day}T08:00:00.000+02:00`,
						windowEnd: `${day}T09:00:00.000+02:00`,
						cutOffTime: `${day}T13:00:00.000+02:00`,
						isAvailable: true,
						isSelected: i === 1,
						isGreenChoice: false,
						minimumOrderValue: null,
					}),
				),
			}),
			getCart: async () => ({
				mts: 1700000000000,
				totalCount: opts.cartCount ?? 3,
				selectedSlot: opts.noSlot ? null : { slotId: "slot-1" },
			}),
			addProductToCart: async (id: string, count: number) => {
				calls.addProductToCart.push([id, count]);
				throw new Error("Client version is required");
			},
		},
		checkout: {
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
				if (opts.paymentFails) throw new Error("502 Bad Gateway");
				return {
					payment_id: "pay-1",
					transaction_id: "tx-1",
					issuer_authentication_url: "https://bank.test/pay",
					action: { type: "REDIRECT", redirect_url: "https://bank.test/pay" },
				};
			},
			getCheckoutStatus: async (transactionId: string) => ({
				checkout_status:
					transactionId === "tx-1"
						? (opts.checkoutStatus ?? "FINISHED")
						: "UNKNOWN",
			}),
			cancelCheckout: async (transactionId: string) => {
				calls.cancelCheckout.push(transactionId);
			},
			confirmOrder: async (id: string) => {
				calls.confirmOrder.push(id);
				if (opts.confirmFails) throw new Error("socket hang up");
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
		},
		delivery: {
			getDeliveryPosition: async () => {
				throw new SyntaxError("Unexpected end of JSON input");
			},
			getDeliveryRoute: async () => ({
				version: 1,
				points: [{ lat: 52.4, lng: 4.9, ts: 1 }],
				driverName: "Sam",
				vehicleImageDataUrl: "data:image/png;base64,AAAA",
			}),
		},
		recipe: {
			// Without a count Picnic renders the app's last-used 3, not the stored default 2.
			getRecipe: async (id: string, options: { portions?: number }) => {
				calls.recipe.push([id, options.portions]);
				return {
					id,
					name: "Pasta",
					portions: options.portions ?? 3,
					defaultPortions: 2,
					isSaved: false,
					imageId: null,
					description: null,
					times: [{ label: "Totaal", value: "20 min" }],
					ingredients: [
						{
							sellingUnitId: "s9",
							name: null,
							quantity: options.portions ?? 3,
							neededText: "(500 g nodig)",
							type: "CORE",
							checked: true,
							price: 129,
							isAvailable: true,
							unavailableReason: null,
						},
					],
					steps: ["Kochen."],
					stepsWarning: null,
					allergens: { contains: [], mayContain: [] },
					note: null,
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
			"picnic_get_favorites",
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
		// Hosts ask for approval on every destructive call; adding must not need it.
		expect(byName.get("picnic_add_to_cart")?.annotations).toMatchObject({
			destructiveHint: false,
			idempotentHint: false,
		});
		expect(
			byName.get("picnic_remove_from_cart")?.annotations?.destructiveHint,
		).toBe(true);
		expect(byName.get("picnic_clear_cart")?.annotations?.idempotentHint).toBe(
			true,
		);
		expect(byName.get("picnic_get_cart")?.annotations?.readOnlyHint).toBe(true);
		expect(
			byName.get("picnic_send_2fa_code")?.annotations?.idempotentHint,
		).toBe(false);
	});

	it("returns each search result once, marking products bought before", async () => {
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
					brand: "Campina",
					price: 199,
					unit: "1 l",
					bought_before: true,
				},
				{
					id: "s2",
					name: "Product s2",
					price: 199,
					original_price: 249,
					unit: "1 l",
					labels: ["1+1 gratis"],
				},
			],
			pagination: {
				offset: 0,
				limit: 10,
				returned: 2,
				total: 2,
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
		const { session, calls } = fakeSession();
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

	it("loads the full list of favorites aisles the tab shows only in part", async () => {
		await connect(fakeSession().session);
		const result = await client.callTool({
			name: "picnic_get_favorites",
			arguments: {},
		});
		expect(payload(result)).toEqual({
			aisles: [
				{
					aisle: "Zuivel",
					products: [{ id: "s7", name: "Product s7", price: 199, unit: "1 l" }],
				},
				{
					aisle: "Voorraad",
					products: [{ id: "s8", name: "Product s8", price: 199, unit: "1 l" }],
				},
			],
		});
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
			{ mts: 1700000000000, resolveKey: undefined },
		]);
		expect(calls.initiatePayment).toEqual([["order-1", "https://picnic.app/"]]);
	});

	it("refuses to start checkout on an empty cart or without a slot", async () => {
		const empty = fakeSession({ cartCount: 0 });
		await connect(empty.session);
		const result = await client.callTool({
			name: "picnic_start_checkout",
			arguments: {},
		});
		expect(result.isError).toBe(true);
		expect(text(result)).toMatch(/empty/);
		expect(empty.calls.startCheckout).toEqual([]);
		await close();

		const unslotted = fakeSession({ noSlot: true });
		await connect(unslotted.session);
		const noSlot = await client.callTool({
			name: "picnic_start_checkout",
			arguments: {},
		});
		expect(text(noSlot)).toMatch(/picnic_set_delivery_slot/);
		expect(unslotted.calls.startCheckout).toEqual([]);
	});

	it("names the started order when initiating payment fails", async () => {
		await connect(fakeSession({ paymentFails: true }).session);
		const result = await client.callTool({
			name: "picnic_start_checkout",
			arguments: {},
		});
		expect(result.isError).toBe(true);
		expect(text(result)).toMatch(/order order-1/);
		expect(text(result)).toMatch(/502 Bad Gateway/);
	});

	it("warns that a failed confirmation may still have placed the order", async () => {
		const { session, calls } = fakeSession({ confirmFails: true });
		await connect(session);
		const result = await client.callTool({
			name: "picnic_confirm_order",
			arguments: { order_id: "order-1", transaction_id: "tx-1" },
		});
		expect(result.isError).toBe(true);
		expect(text(result)).toMatch(/may still have been placed/);
		expect(text(result)).toMatch(/picnic_get_deliveries/);
		expect(calls.confirmOrder).toEqual(["order-1"]);
	});

	it("rejects a transaction paired with an order it did not pay for", async () => {
		const { session, calls } = fakeSession();
		await connect(session);
		await client.callTool({ name: "picnic_start_checkout", arguments: {} });
		const result = await client.callTool({
			name: "picnic_confirm_order",
			arguments: { order_id: "order-2", transaction_id: "tx-1" },
		});
		expect(result.isError).toBe(true);
		expect(text(result)).toMatch(/pays for order order-1/);
		expect(calls.confirmOrder).toEqual([]);
	});

	it("cancels a pending checkout but not a paid one", async () => {
		const pendingFixture = fakeSession({ checkoutStatus: "PENDING" });
		await connect(pendingFixture.session);
		const cancelled = await client.callTool({
			name: "picnic_cancel_checkout",
			arguments: { transaction_id: "tx-1" },
		});
		expect(payload(cancelled)).toEqual({ cancelled: true });
		expect(pendingFixture.calls.cancelCheckout).toEqual(["tx-1"]);
		const status = await client.callTool({
			name: "picnic_get_checkout_status",
			arguments: { transaction_id: "tx-1" },
		});
		expect(payload(status)).toEqual({ checkout_status: "PENDING" });
		await close();

		const paid = fakeSession();
		await connect(paid.session);
		const refused = await client.callTool({
			name: "picnic_cancel_checkout",
			arguments: { transaction_id: "tx-1" },
		});
		expect(refused.isError).toBe(true);
		expect(text(refused)).toMatch(/picnic_confirm_order/);
		expect(paid.calls.cancelCheckout).toEqual([]);
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
			resolveKey: "age_verified",
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

	it("reports tracking parts independently and leaves out the vehicle image", async () => {
		await connect(fakeSession().session);
		const result = await client.callTool({
			name: "picnic_track_delivery",
			arguments: { delivery_id: "d1" },
		});
		expect(result.isError).toBeFalsy();
		expect(payload(result)).toEqual({
			position: {
				error:
					"Picnic returned no data, which for the position means the delivery is not on its way.",
			},
			route: {
				value: {
					version: 1,
					points: [{ lat: 52.4, lng: 4.9, ts: 1 }],
					driverName: "Sam",
				},
			},
		});
	});

	it("pages product and group deals section by section, each listed once", async () => {
		await connect(fakeSession().session);
		const result = await client.callTool({
			name: "picnic_get_promotions",
			arguments: { limit: 2, offset: 1 },
		});
		expect(payload(result)).toEqual({
			promotions: [
				{
					group: "Alpro vers",
					label: "2 voor €3.99",
					example: "Bv. sojayoghurt",
					section: "Uitgelicht",
				},
				{
					id: "s4",
					name: "Product s4",
					price: 199,
					unit: "1 l",
					section: "Zuivel",
				},
			],
			pagination: {
				offset: 1,
				limit: 2,
				returned: 2,
				total: 3,
				has_more: false,
			},
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

	it("returns a recipe at its stored default portions unless asked for another count", async () => {
		const { session, calls } = fakeSession();
		await connect(session);
		const result = await client.callTool({
			name: "picnic_get_recipe",
			arguments: {
				recipe: `https://picnic.app/nl/recepten/${RECIPE_ID}/pasta`,
			},
		});
		expect(calls.recipe).toEqual([
			[RECIPE_ID, undefined],
			[RECIPE_ID, 2],
		]);
		expect(payload(result)).toMatchObject({
			id: RECIPE_ID,
			url: `https://picnic.app/nl/recepten/${RECIPE_ID}`,
			portions: 2,
			ingredients: [
				{
					product_id: "s9",
					quantity: 2,
					needed: "(500 g nodig)",
					selected_by_default: true,
				},
			],
			steps: ["Kochen."],
		});

		calls.recipe.length = 0;
		const scaled = await client.callTool({
			name: "picnic_get_recipe",
			arguments: { recipe: RECIPE_ID, portions: 4 },
		});
		expect(calls.recipe).toEqual([[RECIPE_ID, 4]]);
		expect(payload(scaled)).toMatchObject({
			portions: 4,
			ingredients: [{ product_id: "s9", quantity: 4 }],
		});
	});
});
