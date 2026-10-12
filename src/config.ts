import { homedir } from "node:os";
import { join } from "node:path";
import * as z from "zod";

const envSchema = z
	.object({
		PICNIC_USERNAME: z.string().min(1),
		PICNIC_PASSWORD: z.string().min(1),
		PICNIC_COUNTRY_CODE: z.enum(["NL", "DE", "FR"]).default("NL"),
		PICNIC_AGENT: z.string().optional(),
		PICNIC_STATE_FILE: z.string().default(join(homedir(), ".picnic-mcp.json")),
		PICNIC_HTTP_PORT: z.coerce.number().int().min(1).max(65535).optional(),
		PICNIC_HTTP_HOST: z.string().default("127.0.0.1"),
		PICNIC_HTTP_TOKEN: z.string().trim().min(16).optional(),
	})
	.refine(
		(e) =>
			e.PICNIC_HTTP_PORT === undefined || e.PICNIC_HTTP_TOKEN !== undefined,
		{
			message: "Required (16+ characters) whenever PICNIC_HTTP_PORT is set",
			path: ["PICNIC_HTTP_TOKEN"],
		},
	)
	.transform((e) => ({
		username: e.PICNIC_USERNAME,
		password: e.PICNIC_PASSWORD,
		countryCode: e.PICNIC_COUNTRY_CODE,
		/** Overrides picnic-api's default `x-picnic-agent` app version header. */
		agent: e.PICNIC_AGENT,
		/** Where the auth key, device id, and 2FA state persist between runs. */
		stateFile: e.PICNIC_STATE_FILE,
		/** Present when the server should listen on Streamable HTTP instead of stdio. */
		http:
			e.PICNIC_HTTP_PORT !== undefined && e.PICNIC_HTTP_TOKEN !== undefined
				? {
						port: e.PICNIC_HTTP_PORT,
						host: e.PICNIC_HTTP_HOST,
						token: e.PICNIC_HTTP_TOKEN,
					}
				: undefined,
	}));

export type Config = z.output<typeof envSchema>;
export type HttpConfig = NonNullable<Config["http"]>;

/**
 * Parses environment variables into the server configuration. Empty values
 * count as unset, since some hosts write `KEY=` for every optional variable.
 * Throws a readable error naming the invalid variables.
 */
export function loadConfig(env: Record<string, string | undefined>): Config {
	const present = Object.fromEntries(
		Object.entries(env).filter(([, v]) => v !== ""),
	);
	const parsed = envSchema.safeParse(present);
	if (!parsed.success) {
		throw new Error(`Invalid configuration:\n${z.prettifyError(parsed.error)}`);
	}
	return parsed.data;
}
