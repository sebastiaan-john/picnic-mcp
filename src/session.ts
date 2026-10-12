import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import PicnicClient from "picnic-api";
import * as z from "zod";
import type { Config } from "./config";

export type PicnicApi = InstanceType<typeof PicnicClient>;

/** The session surface tools depend on; tests inject fakes. */
export interface Session {
	/**
	 * Runs `fn` with a logged-in client. Rejects with TwoFactorRequiredError
	 * while 2FA is pending. An auth rejection inside `fn` invalidates the
	 * session so the next call logs in again.
	 */
	call<T>(fn: (client: PicnicApi) => Promise<T>): Promise<T>;
	/** Starts or restarts a 2FA attempt and asks Picnic for an SMS code. Resolves false when nothing is pending. */
	sendTwoFactorCode(): Promise<boolean>;
	verifyTwoFactorCode(code: string): Promise<void>;
}

const storedState = z.object({
	deviceId: z.string().min(1),
	authKey: z.string().nullable().catch(null),
	twoFactorPending: z.boolean().catch(false),
});
type StoredState = z.infer<typeof storedState>;

/** Thrown while 2FA is pending; the message tells the model which tools to call. */
export class TwoFactorRequiredError extends Error {
	constructor() {
		super(
			"Picnic requires two-factor authentication for this login. " +
				"Call picnic_send_2fa_code, ask the user for the code they received, " +
				"then call picnic_verify_2fa_code.",
		);
		this.name = "TwoFactorRequiredError";
	}
}

export type CreateClient = (
	options: ConstructorParameters<typeof PicnicClient>[0],
) => PicnicApi;

function warnSaveFailed(error: unknown): void {
	const message = error instanceof Error ? error.message : String(error);
	console.error(`[picnic-mcp] could not save session state: ${message}`);
}

/**
 * Owns the single Picnic API client for this process.
 *
 * Login happens lazily on the first tool call and is memoized; a failed login
 * is retried on the next call. The auth key is persisted so restarts reuse
 * the session, which matters because each fresh login on a 2FA account needs
 * a new code.
 */
export class PicnicSession implements Session {
	private clientPromise?: Promise<PicnicApi>;
	private readyPromise?: Promise<PicnicApi>;
	private twoFactorPending = false;

	constructor(
		private readonly options: Omit<Config, "http">,
		private readonly createClient: CreateClient = (o) => new PicnicClient(o),
	) {}

	async call<T>(fn: (client: PicnicApi) => Promise<T>): Promise<T> {
		const ready = this.ready();
		const client = await ready;
		try {
			return await fn(client);
		} catch (error) {
			// picnic-api errors carry no status, so any Picnic error re-checks the
			// key on the next call (one GET). Network errors are TypeErrors and keep it.
			if (!(error instanceof TypeError) && this.readyPromise === ready) {
				this.readyPromise = undefined;
			}
			throw error;
		}
	}

	async sendTwoFactorCode(): Promise<boolean> {
		const client = await this.client();
		if (this.twoFactorPending) {
			// A new code starts a new attempt: the key from the earlier login may have aged out.
			this.twoFactorPending = false;
			this.readyPromise = undefined;
			client.authKey = null;
		}
		try {
			await this.ready();
			return false;
		} catch (error) {
			if (!(error instanceof TwoFactorRequiredError)) throw error;
		}
		await client.auth.generate2FACode("SMS");
		return true;
	}

	async verifyTwoFactorCode(code: string): Promise<void> {
		const client = await this.client();
		await client.auth.verify2FACode(code);
		this.twoFactorPending = false;
		this.readyPromise = Promise.resolve(client);
		await this.save(client).catch(warnSaveFailed);
	}

	private ready(): Promise<PicnicApi> {
		if (this.twoFactorPending) {
			return Promise.reject(new TwoFactorRequiredError());
		}
		this.readyPromise ??= this.authenticate().catch((error: unknown) => {
			this.readyPromise = undefined;
			throw error;
		});
		return this.readyPromise;
	}

	private client(): Promise<PicnicApi> {
		this.clientPromise ??= this.loadClient();
		return this.clientPromise;
	}

	private async loadClient(): Promise<PicnicApi> {
		const stored = await this.readState();
		this.twoFactorPending = stored?.twoFactorPending ?? false;
		return this.createClient({
			countryCode: this.options.countryCode,
			agent: this.options.agent,
			deviceId:
				stored?.deviceId ?? randomBytes(8).toString("hex").toUpperCase(),
			authKey: stored?.authKey ?? undefined,
		});
	}

	private async authenticate(): Promise<PicnicApi> {
		const client = await this.client();
		if (this.twoFactorPending) throw new TwoFactorRequiredError();
		if (client.authKey && (await this.savedKeyAccepted(client))) return client;
		client.authKey = null;
		const login = await client.auth.login(
			this.options.username,
			this.options.password,
		);
		this.twoFactorPending = login.second_factor_authentication_required;
		await this.save(client).catch(warnSaveFailed);
		if (this.twoFactorPending) throw new TwoFactorRequiredError();
		return client;
	}

	/**
	 * Probes the saved key with a raw request because picnic-api's errors drop
	 * the HTTP status. Only a 401 or 403 means the key is dead; a network error
	 * or a Picnic 5xx propagates so the key survives for the next attempt.
	 */
	private async savedKeyAccepted(client: PicnicApi): Promise<boolean> {
		const response = await fetch(`${client.url}/user`, {
			headers: client.baseHeaders,
		});
		if (response.ok) return true;
		if (response.status === 401 || response.status === 403) return false;
		throw new Error(
			`Picnic session check failed: ${response.status} ${response.statusText}`,
		);
	}

	private async readState(): Promise<StoredState | null> {
		try {
			return storedState.parse(
				JSON.parse(await readFile(this.options.stateFile, "utf8")),
			);
		} catch {
			return null;
		}
	}

	/** Writes atomically through a temp file so a crash never truncates the state and the file is always created mode 600. */
	private async save(client: PicnicApi): Promise<void> {
		const state: StoredState = {
			authKey: client.authKey,
			deviceId: client.deviceId,
			twoFactorPending: this.twoFactorPending,
		};
		const file = this.options.stateFile;
		const tmp = `${file}.${randomBytes(6).toString("hex")}.tmp`;
		await mkdir(dirname(file), { recursive: true, mode: 0o700 });
		await writeFile(tmp, JSON.stringify(state), { mode: 0o600, flag: "wx" });
		await rename(tmp, file).catch(async (error: unknown) => {
			await unlink(tmp).catch(() => {});
			throw error;
		});
	}
}
