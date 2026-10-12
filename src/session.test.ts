import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	chmod,
	mkdtemp,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type CreateClient,
	type PicnicApi,
	PicnicSession,
	TwoFactorRequiredError,
} from "./session";

interface Calls {
	login: number;
	probes: number;
	generate: number;
	verify: string[];
	created: Parameters<CreateClient>[0][];
}

/**
 * A fake picnic-api client. `validKeys` lists auth keys the key probe
 * accepts; others get a 401. The probe is a raw fetch, so the fake also
 * installs a global fetch that answers it.
 */
function fakeApi(opts: {
	validKeys?: string[];
	needsTwoFactor?: boolean;
	probeError?: Error;
	probeStatus?: number;
	loginError?: Error;
	rejectCode?: string;
}) {
	const calls: Calls = {
		login: 0,
		probes: 0,
		generate: 0,
		verify: [],
		created: [],
	};
	const create: CreateClient = (options) => {
		calls.created.push(options);
		const client = {
			authKey: options?.authKey ?? null,
			deviceId: options?.deviceId ?? "GENERATED",
			countryCode: options?.countryCode ?? "NL",
			url: "https://picnic.test/api/15",
			get baseHeaders() {
				return { "x-picnic-auth": client.authKey ?? "" };
			},
			auth: {
				login: async () => {
					calls.login++;
					if (opts.loginError) throw opts.loginError;
					client.authKey = `login-${calls.login}`;
					return {
						second_factor_authentication_required: opts.needsTwoFactor ?? false,
					};
				},
				generate2FACode: async () => {
					calls.generate++;
				},
				verify2FACode: async (code: string) => {
					calls.verify.push(code);
					if (code === opts.rejectCode) throw new Error("400 Bad Request");
					client.authKey = "verified-key";
				},
			},
		};
		return client as unknown as PicnicApi;
	};
	globalThis.fetch = (async (
		_input: string | URL | Request,
		init?: RequestInit,
	) => {
		calls.probes++;
		if (opts.probeError) throw opts.probeError;
		const key = new Headers(init?.headers).get("x-picnic-auth") ?? "";
		const status =
			opts.probeStatus ?? (opts.validKeys?.includes(key) ? 200 : 401);
		return new Response(null, { status });
	}) as typeof fetch;
	return { create, calls };
}

const options = (stateFile: string) => ({
	username: "u",
	password: "p",
	countryCode: "NL" as const,
	agent: "30100;1.236.1-15553;",
	stateFile,
});
const whoami = (client: PicnicApi) => Promise.resolve(client.authKey);
const realFetch = globalThis.fetch;

describe("PicnicSession", () => {
	let dir: string;
	let stateFile: string;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "picnic-mcp-"));
		stateFile = join(dir, "nested", "state.json");
	});
	afterEach(async () => {
		globalThis.fetch = realFetch;
		await rm(dir, { recursive: true, force: true });
	});

	it("logs in once for concurrent calls and persists key and device id with mode 600", async () => {
		const { create, calls } = fakeApi({});
		const session = new PicnicSession(options(stateFile), create);

		const [a, b] = await Promise.all([
			session.call(whoami),
			session.call(whoami),
		]);
		expect(a).toBe("login-1");
		expect(b).toBe("login-1");
		expect(calls.login).toBe(1);
		expect(calls.probes).toBe(0);
		expect(calls.created[0]).toMatchObject({
			countryCode: "NL",
			agent: "30100;1.236.1-15553;",
			authKey: undefined,
		});

		expect(JSON.parse(await readFile(stateFile, "utf8"))).toEqual({
			authKey: "login-1",
			deviceId: expect.stringMatching(/^[0-9A-F]{16}$/),
			twoFactorPending: false,
		});
		expect((await stat(stateFile)).mode & 0o777).toBe(0o600);
	});

	it("replaces a pre-existing world-readable state file with a 600 one", async () => {
		stateFile = join(dir, "state.json");
		await writeFile(stateFile, "{}");
		await chmod(stateFile, 0o644);
		await new PicnicSession(options(stateFile), fakeApi({}).create).call(
			whoami,
		);
		expect((await stat(stateFile)).mode & 0o777).toBe(0o600);
	});

	it("reuses a valid saved session without logging in", async () => {
		await new PicnicSession(options(stateFile), fakeApi({}).create).call(
			whoami,
		);
		const { create, calls } = fakeApi({ validKeys: ["login-1"] });
		const session = new PicnicSession(options(stateFile), create);
		expect(await session.call(whoami)).toBe("login-1");
		expect(calls.login).toBe(0);
		expect(calls.probes).toBe(1);
		expect(calls.created[0]?.deviceId).toMatch(/^[0-9A-F]{16}$/);
	});

	it("logs in again when the probe rejects the saved key", async () => {
		await new PicnicSession(options(stateFile), fakeApi({}).create).call(
			whoami,
		);
		const { create, calls } = fakeApi({});
		expect(
			await new PicnicSession(options(stateFile), create).call(whoami),
		).toBe("login-1");
		expect(calls.login).toBe(1);
	});

	it("keeps the saved key through a network error and a Picnic server error", async () => {
		await new PicnicSession(options(stateFile), fakeApi({}).create).call(
			whoami,
		);
		for (const probe of [
			{ probeError: new TypeError("fetch failed") },
			{ probeStatus: 503 },
		]) {
			const { create, calls } = fakeApi(probe);
			const session = new PicnicSession(options(stateFile), create);
			await expect(session.call(whoami)).rejects.toThrow(/fetch failed|503/);
			await expect(session.call(whoami)).rejects.toThrow(/fetch failed|503/);
			expect(calls.login).toBe(0);
			expect(calls.probes).toBe(2);
		}
		expect(JSON.parse(await readFile(stateFile, "utf8")).authKey).toBe(
			"login-1",
		);
	});

	it("retries a failed login on the next call", async () => {
		const api = fakeApi({ loginError: new Error("Login failed: boom") });
		const session = new PicnicSession(options(stateFile), api.create);
		await expect(session.call(whoami)).rejects.toThrow(/boom/);
		await expect(session.call(whoami)).rejects.toThrow(/boom/);
		expect(api.calls.login).toBe(2);
	});

	it("re-checks the key after a Picnic error and logs in only when it is rejected", async () => {
		const { create, calls } = fakeApi({ validKeys: ["login-1"] });
		const session = new PicnicSession(options(stateFile), create);
		await session.call(whoami);

		await expect(
			session.call(() =>
				Promise.reject(new Error("500 Internal Server Error")),
			),
		).rejects.toThrow(/500/);
		expect(await session.call(whoami)).toBe("login-1");
		expect(calls.login).toBe(1);
		expect(calls.probes).toBe(1);

		await expect(
			session.call(() => Promise.reject(new TypeError("fetch failed"))),
		).rejects.toThrow(/fetch failed/);
		expect(await session.call(whoami)).toBe("login-1");
		expect(calls.probes).toBe(1);

		const { create: rejecting, calls: later } = fakeApi({});
		const stuck = new PicnicSession(options(stateFile), rejecting);
		await stuck.call(whoami);
		await expect(
			stuck.call(() => Promise.reject(new Error("401"))),
		).rejects.toThrow(/401/);
		expect(await stuck.call(whoami)).toBe("login-2");
		expect(later.login).toBe(2);
	});

	it("holds tools until 2FA completes, then saves the verified key", async () => {
		const { create, calls } = fakeApi({
			needsTwoFactor: true,
			rejectCode: "bad",
		});
		const session = new PicnicSession(options(stateFile), create);

		await expect(session.call(whoami)).rejects.toBeInstanceOf(
			TwoFactorRequiredError,
		);
		await expect(session.call(whoami)).rejects.toBeInstanceOf(
			TwoFactorRequiredError,
		);
		expect(calls.login).toBe(1);
		expect(JSON.parse(await readFile(stateFile, "utf8")).twoFactorPending).toBe(
			true,
		);

		expect(await session.sendTwoFactorCode()).toBe(true);
		expect(calls.generate).toBe(1);
		expect(calls.login).toBe(2);

		await expect(session.verifyTwoFactorCode("bad")).rejects.toThrow(/400/);
		await expect(session.call(whoami)).rejects.toBeInstanceOf(
			TwoFactorRequiredError,
		);

		await session.verifyTwoFactorCode("000000");
		expect(await session.call(whoami)).toBe("verified-key");
		expect(JSON.parse(await readFile(stateFile, "utf8"))).toMatchObject({
			authKey: "verified-key",
			twoFactorPending: false,
		});
	});

	it("restores a pending 2FA after a restart and resends with a fresh login", async () => {
		const first = new PicnicSession(
			options(stateFile),
			fakeApi({ needsTwoFactor: true }).create,
		);
		await first.call(whoami).catch(() => {});

		const { create, calls } = fakeApi({ needsTwoFactor: true });
		const second = new PicnicSession(options(stateFile), create);
		await expect(second.call(whoami)).rejects.toBeInstanceOf(
			TwoFactorRequiredError,
		);
		expect(calls.probes).toBe(0);
		expect(await second.sendTwoFactorCode()).toBe(true);
		expect(calls.login).toBe(1);

		const third = new PicnicSession(
			options(stateFile),
			fakeApi({ needsTwoFactor: true }).create,
		);
		expect(await third.sendTwoFactorCode()).toBe(true);
	});

	it("reports nothing to send when the session is already authenticated", async () => {
		const { create, calls } = fakeApi({});
		const session = new PicnicSession(options(stateFile), create);
		expect(await session.sendTwoFactorCode()).toBe(false);
		expect(calls.generate).toBe(0);
	});
});
