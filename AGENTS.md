# picnic-mcp

MCP server (SDK v2, `@modelcontextprotocol/server`) exposing a Picnic grocery account as tools. Bun only; there is no build step.

## Commands

- `bun run check` runs oxlint, oxfmt --check, tsc, and bun test. Run it before every commit.
- `bun run lint` fixes lint and formats (tabs, 80 columns, sorted imports).
- The README shows how to run the MCP Inspector; it does not inherit the shell env.

## Layout

- `src/index.ts` picks stdio or HTTP from the config and wires the session.
- `src/config.ts` parses env with zod; the only place env is read. Types are inferred from the schema.
- `src/session.ts` owns the one picnic-api client: lazy memoized login, 2FA state, atomic state file.
- `src/server.ts` builds an `McpServer` per connection or request from `src/tools/*`.
- `src/tools/*.ts` one file per Picnic domain. Every tool except the 2FA pair runs through `session.call(client => ...)`, which re-checks the saved key on the next call after any Picnic error.
- `src/picnic/*.ts` pure mappers over Picnic responses, page trees, and ids, each with a colocated test.
- `src/http.ts` `Bun.serve` around `createMcpHandler` with a mandatory bearer token.

## Rules

- stdout is the MCP channel on stdio. Log with `console.error` only.
- Tools return `json(...)` text blocks (the image tool returns image content) and throw plain `Error`s; the SDK turns them into `isError` results. Non-idempotent cart writes (adding or removing products, adding a recipe) go through `mutateCart`, with the response mapping inside the callback, so the error warns that a retry can double-apply. Clearing the cart and removing a recipe are idempotent and stay outside it.
- Ids that picnic-api splices into request paths go through `idArg` so `../` cannot reach another endpoint.
- Every tool carries `annotations` and every argument a `.describe()`; the server test enforces both.
- Prefer picnic-api methods over `sendRequest`; add a page-tree extractor only when picnic-api has no structured method.
- Tests use fakes injected through `Session` or the `createClient` factory, never module mocks, and never call Picnic.
