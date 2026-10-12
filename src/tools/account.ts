import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import type { Session } from "../session";
import { IDEMPOTENT_WRITE, json, READ_ONLY } from "./common";

export function registerAccountTools(server: McpServer, session: Session) {
	server.registerTool(
		"picnic_get_account",
		{
			title: "Get account",
			description:
				"The logged-in Picnic account: name, delivery address, phone, email, household size, and delivery counts.",
			annotations: READ_ONLY,
		},
		() =>
			session.call(async (client) => {
				const user = await client.user.getUserDetails();
				return json({
					user_id: user.user_id,
					firstname: user.firstname,
					lastname: user.lastname,
					address: user.address,
					phone: user.phone,
					contact_email: user.contact_email,
					household_details: user.household_details,
					total_deliveries: user.total_deliveries,
					completed_deliveries: user.completed_deliveries,
				});
			}),
	);

	server.registerTool(
		"picnic_send_2fa_code",
		{
			title: "Send 2FA code",
			description:
				"Asks Picnic to text a two-factor code to the account's phone. Call it when a tool reports that two-factor authentication is required, then ask the user for the code. Returns `sent: false` when no verification is pending. Each call sends a new code.",
			annotations: {
				readOnlyHint: false,
				destructiveHint: false,
				idempotentHint: false,
				openWorldHint: true,
			},
		},
		async () => json({ sent: await session.sendTwoFactorCode() }),
	);

	server.registerTool(
		"picnic_verify_2fa_code",
		{
			title: "Verify 2FA code",
			description:
				"Completes two-factor authentication with the code the user received. The session is saved, so this is needed again only when Picnic expires it.",
			inputSchema: z.object({
				code: z.string().min(1).describe("The code the user received"),
			}),
			annotations: IDEMPOTENT_WRITE,
		},
		async ({ code }) => {
			await session.verifyTwoFactorCode(code);
			return json({ verified: true });
		},
	);
}
