# picnic-mcp

An MCP server for [Picnic](https://picnic.app) grocery delivery. It gives an AI assistant tools to search products, manage the cart, pick a delivery slot, follow deliveries, and work with recipes on your own Picnic account. Works with accounts in the Netherlands, Germany, and France.

Built on the MCP TypeScript SDK v2 and [picnic-api](https://github.com/MRVDH/picnic-api). Runs on [Bun](https://bun.sh) 1.4+.

## Run

```sh
git clone https://github.com/sebastiaan-john/picnic-mcp
cd picnic-mcp
bun install
```

Claude Desktop, Claude Code, Cursor, and other stdio hosts:

```json
{
	"mcpServers": {
		"picnic": {
			"command": "bun",
			"args": ["/path/to/picnic-mcp/src/index.ts"],
			"env": {
				"PICNIC_USERNAME": "you@example.com",
				"PICNIC_PASSWORD": "your-password",
				"PICNIC_COUNTRY_CODE": "NL"
			}
		}
	}
}
```

If the host cannot find `bun`, use its full path, for example `~/.bun/bin/bun`.

### Two-factor authentication

Picnic asks for an SMS code when a login needs a second factor, for example the first login from a new device. The server stays up; any tool you call answers with instructions to run `picnic_send_2fa_code`, then `picnic_verify_2fa_code` with the code you received. The session, device id, and pending 2FA state are saved in `PICNIC_STATE_FILE`, so later starts reuse them.

### Environment

| Variable | Default | Meaning |
|---|---|---|
| `PICNIC_USERNAME` | required | Picnic account email |
| `PICNIC_PASSWORD` | required | Picnic account password |
| `PICNIC_COUNTRY_CODE` | `NL` | `NL`, `DE`, or `FR`; must match the account |
| `PICNIC_STATE_FILE` | `~/.picnic-mcp.json` | Saved session key, device id, and 2FA state; written with mode 600 |
| `PICNIC_AGENT` | picnic-api's default | App version sent as `x-picnic-agent`. Set an older one, e.g. `30100;1.236.1-15553;`, when a tool reports an unreadable page format |
| `PICNIC_HTTP_PORT` | unset | Serve Streamable HTTP on this port instead of stdio |
| `PICNIC_HTTP_HOST` | `127.0.0.1` | Bind address for HTTP mode |
| `PICNIC_HTTP_TOKEN` | unset | Bearer token every request must carry; required (16+ characters) whenever HTTP is on |

Empty values count as unset.

### HTTP mode

```sh
export PICNIC_HTTP_TOKEN=$(openssl rand -hex 24); echo "$PICNIC_HTTP_TOKEN"
PICNIC_HTTP_PORT=3000 PICNIC_USERNAME=you@example.com PICNIC_PASSWORD=... bun src/index.ts
```

The endpoint is `/mcp`. The token is the only access control, which is why it is mandatory: it also stops browser pages from reaching the server through DNS rebinding, since they do not know it.

## Tools

Prices are in euro cents. Product ids look like `s1001524`.

| Tool | Does |
|---|---|
| `picnic_search_products` | Keyword search with paging |
| `picnic_get_product` | One product; `full=true` adds ingredient and nutrition sections, similar products, and price tiers |
| `picnic_get_product_image` | PNG image by image id |
| `picnic_get_promotions` | This week's deals |
| `picnic_get_favorites` | Products bought before, by category, as on the Favorieten tab |
| `picnic_get_cart` | Cart contents, totals, selected slot |
| `picnic_add_to_cart`, `picnic_remove_from_cart`, `picnic_clear_cart` | Cart mutations |
| `picnic_get_delivery_slots`, `picnic_set_delivery_slot` | Delivery windows, the next three days by default |
| `picnic_start_checkout`, `picnic_confirm_order` | Place the order: start and initiate payment, the user pays at the returned URL, then confirm |
| `picnic_get_checkout_status`, `picnic_cancel_checkout` | Payment status and backing out before confirming |
| `picnic_get_deliveries`, `picnic_get_delivery` | Order history and one delivery in full |
| `picnic_track_delivery` | ETA and route for a delivery on its way |
| `picnic_cancel_delivery` | Cancel an upcoming delivery |
| `picnic_get_recipe` | Ingredients with product ids, amounts, steps, tips, timing; scalable by portions |
| `picnic_get_recipes` | Saved or own recipes |
| `picnic_save_recipe`, `picnic_unsave_recipe` | Cookbook bookmarks |
| `picnic_add_recipe_to_cart`, `picnic_remove_recipe_from_cart` | Recipe bundles in the cart |
| `picnic_get_account` | Account, address, household |
| `picnic_send_2fa_code`, `picnic_verify_2fa_code` | Two-factor login |

Adding or removing products and adding recipes is not idempotent. Picnic applies a mutation and renders the cart in the same request, so a failed call may still have changed the cart; the error says so and points at `picnic_get_cart` before any retry.

Placing an order follows the sequence the other unofficial Picnic clients use: `picnic_start_checkout` starts the checkout from the current cart and initiates payment, the user opens the returned payment URL and pays, and `picnic_confirm_order` checks that the payment finished before confirming. A blocking issue such as an alcohol age check comes back as an error with a `resolve_key` to pass on the next start. This path has not been run against a live account yet; the direct-debit case, where no bank page may appear, is untested.

## Development

```sh
bun run check   # oxlint, oxfmt --check, tsc, bun test
bun run lint    # fix and format
```

Tests are colocated as `*.test.ts` and run with `bun test`. The server tests drive the real MCP handler in-process through `@modelcontextprotocol/client` with a fake Picnic client; nothing in the suite talks to Picnic.

The MCP Inspector does not inherit your shell environment, so pass the variables explicitly:

```sh
bunx @modelcontextprotocol/inspector -e PICNIC_USERNAME=you@example.com -e PICNIC_PASSWORD=... bun src/index.ts
```

## Credits

Started as a rewrite of [ivo-toby/mcp-picnic](https://github.com/ivo-toby/mcp-picnic) and keeps its cart-safety and recipe-page extraction ideas. Picnic access is through [MRVDH/picnic-api](https://github.com/MRVDH/picnic-api). Not affiliated with Picnic.

MIT, see [LICENSE](LICENSE).
