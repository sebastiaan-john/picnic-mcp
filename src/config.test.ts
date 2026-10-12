import { describe, expect, it } from "bun:test";
import { loadConfig } from "./config";

const base = { PICNIC_USERNAME: "me@example.com", PICNIC_PASSWORD: "secret" };
const token = "a-sufficiently-long-token";

describe("loadConfig", () => {
	it("applies defaults and passes the agent override through", () => {
		const config = loadConfig({
			...base,
			PICNIC_AGENT: "30100;1.236.1-15553;",
		});
		expect(config.countryCode).toBe("NL");
		expect(config.agent).toBe("30100;1.236.1-15553;");
		expect(config.http).toBeUndefined();
		expect(config.stateFile.endsWith(".picnic-mcp.json")).toBe(true);
	});

	it("treats empty values as unset", () => {
		const config = loadConfig({
			...base,
			PICNIC_AGENT: "",
			PICNIC_HTTP_PORT: "",
		});
		expect(config.agent).toBeUndefined();
		expect(config.http).toBeUndefined();
	});

	it("lists every missing variable", () => {
		expect(() => loadConfig({})).toThrow(
			/PICNIC_USERNAME[\s\S]*PICNIC_PASSWORD/,
		);
	});

	it("rejects an unknown country", () => {
		expect(() => loadConfig({ ...base, PICNIC_COUNTRY_CODE: "BE" })).toThrow(
			/PICNIC_COUNTRY_CODE/,
		);
	});

	it("requires a long token whenever HTTP is enabled", () => {
		const env = { ...base, PICNIC_HTTP_PORT: "3000" };
		expect(() => loadConfig(env)).toThrow(/PICNIC_HTTP_TOKEN/);
		expect(() => loadConfig({ ...env, PICNIC_HTTP_TOKEN: "short" })).toThrow(
			/PICNIC_HTTP_TOKEN/,
		);
		expect(loadConfig({ ...env, PICNIC_HTTP_TOKEN: token }).http).toEqual({
			port: 3000,
			host: "127.0.0.1",
			token,
		});
	});
});
