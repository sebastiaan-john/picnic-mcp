import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
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

/**
 * Whether Picnic rejected the auth key, as opposed to a network or server
 * error that should not cost the saved session. picnic-api throws a plain
 * Error carrying Picnic's message or `<status> <statusText>`; fetch failures
 * are TypeErrors. Picnic's exact wording is unverified, so this matches the
 * status codes and common phrasing.
 */
function isAuthRejection(error: unknown): boolean {
	if (!(error instanceof Error) || error instanceof TypeError) return false;
	return /\b40[13]\b|unauthori[sz]ed|forbidden|\bauth/i.test(error.message);
}

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
		const client = await this.ready();
		try {
			return await fn(client);
		} catch (error) {
			if (isAuthRejection(error)) this.readyPromise = undefined;
			throw error;
		}
	}

	async sendTwoFactorCode(): Promise<boolean> {
		if (this.twoFactorPending) {
			// A new code starts a new attempt: the key from the earlier login may have aged out.
			this.twoFactorPending = false;
			this.readyPromise = undefined;
			(await this.client()).authKey = null;
		}
		try {
			await this.ready();
			return false;
		} catch (error) {
			if (!(error instanceof TwoFactorRequiredError)) throw error;
		}
		const client = await this.client();
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
		if (client.authKey) {
			try {
				await client.user.getUserDetails();
				return client;
			} catch (error) {
				if (!isAuthRejection(error)) throw error;
				client.authKey = null;
			}
		}
		const login = await client.auth.login(
			this.options.username,
			this.options.password,
		);
		this.twoFactorPending = login.second_factor_authentication_required;
		await this.save(client).catch(warnSaveFailed);
		if (this.twoFactorPending) throw new TwoFactorRequiredError();
		return client;
	}

	private async readState(): Promise<z.infer<typeof storedState> | null> {
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
		const state: z.infer<typeof storedState> = {
			authKey: client.authKey,
			deviceId: client.deviceId,
			twoFactorPending: this.twoFactorPending,
		};
		const file = this.options.stateFile;
		const tmp = `${file}.${process.pid}.tmp`;
		await mkdir(dirname(file), { recursive: true, mode: 0o700 });
		await writeFile(tmp, JSON.stringify(state), { mode: 0o600, flag: "wx" });
		await rename(tmp, file);
	}
}
