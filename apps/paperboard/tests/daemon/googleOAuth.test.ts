import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import * as crypto from "node:crypto";
import { PaperCraneEngine } from "../../papercrane/engine";
import { DRIVE_FILE_SCOPE, signInToGoogleDrive } from "../../src/main/googleOAuth";
import { dataDir } from "./support/fs";
import { serve } from "./support/release";
import { TEST_TIMEOUT_MS } from "./support/wait";

setDefaultTimeout(TEST_TIMEOUT_MS);

const client = { clientId: "client-id", clientSecret: "client-secret" };

// Google's token endpoint on loopback: checks the PKCE verifier against the
// challenge the authorization URL carried
function fakeGoogle() {
	const server = serve();
	const challenges = new Map<string, string>();
	const exchanges: URLSearchParams[] = [];
	server.set("/token", async (req: Request) => {
		const form = new URLSearchParams(await req.text());
		exchanges.push(form);
		const expected = challenges.get(form.get("code") ?? "");
		const actual = crypto.createHash("sha256").update(form.get("code_verifier") ?? "").digest("base64url");
		if (!expected || expected !== actual) return Response.json({ error: "invalid_grant" }, { status: 400 });
		return Response.json({ access_token: "at", refresh_token: `refresh-for-${form.get("code")}` });
	});
	return { server, challenges, exchanges, endpoints: { authUrl: `${server.url}/auth`, tokenUrl: `${server.url}/token` } };
}

// the user's browser: lands on Google's screen, then follows the redirect back
function browser(google: ReturnType<typeof fakeGoogle>, code: string, onTab: (res: Promise<Response>, auth: URL) => void) {
	return async (url: string) => {
		const auth = new URL(url);
		google.challenges.set(code, auth.searchParams.get("code_challenge")!);
		const back = new URL(auth.searchParams.get("redirect_uri")!);
		back.search = new URLSearchParams({ code, state: auth.searchParams.get("state")! }).toString();
		onTab(fetch(back), auth);
	};
}

// Google Drive sign-in is PKCE, minimal-scope, and reports its real outcome.
describe("Google Drive sign-in", () => {
	const google = fakeGoogle();
	afterAll(() => google.server.close());

	test("asks only for drive.file, proves the verifier, and says connected only after the vault holds the token", async () => {
		const engine = new PaperCraneEngine(dataDir());
		const order: string[] = [];
		let tab!: Promise<Response>;
		let authUrl!: URL;
		const saved = await signInToGoogleDrive(
			client,
			{
				endpoints: google.endpoints,
				openExternal: browser(google, "code-1", (res, auth) => {
					authUrl = auth;
					tab = res.then((r) => {
						order.push("tab answered");
						return r;
					});
				}),
			},
			async (refreshToken) => {
				engine.setSecret("drive.refresh-token", refreshToken, "shell-backups");
				order.push("stored");
				return "location-id";
			},
		);
		expect(saved).toBe("location-id");
		expect(authUrl.searchParams.get("scope")).toBe(DRIVE_FILE_SCOPE);
		expect(authUrl.searchParams.get("code_challenge_method")).toBe("S256");
		expect(google.exchanges.at(-1)!.get("code_verifier")).toBeTruthy();
		const page = await (await tab).text();
		expect(page).toContain("Google Drive is connected");
		expect(order).toEqual(["stored", "tab answered"]);
		expect(engine.getSecret("drive.refresh-token", "shell-backups").value).toBe("refresh-for-code-1");
	});

	test("a failure storing the token rejects the sign-in and the tab says not connected", async () => {
		let tab!: Promise<Response>;
		const signIn = signInToGoogleDrive(
			client,
			{ endpoints: google.endpoints, openExternal: browser(google, "code-2", (res) => (tab = res)) },
			async () => {
				throw new Error("the vault refused it");
			},
		);
		await expect(signIn).rejects.toThrow("the vault refused it");
		const page = await (await tab).text();
		expect(page).toContain("was not connected");
		expect(page).not.toContain("is connected");
	});

	test("a redirect carrying a different state gets 404 and the real one still completes", async () => {
		let forged!: Response;
		let tab!: Promise<Response>;
		const signIn = signInToGoogleDrive(
			client,
			{
				endpoints: google.endpoints,
				openExternal: async (url) => {
					const auth = new URL(url);
					const back = new URL(auth.searchParams.get("redirect_uri")!);
					back.search = new URLSearchParams({ code: "stolen", state: "not-the-state" }).toString();
					forged = await fetch(back);
					await browser(google, "code-3", (res) => (tab = res))(url);
				},
			},
			async (token) => token,
		);
		expect(await signIn).toBe("refresh-for-code-3");
		expect(forged.status).toBe(404);
		expect((await tab).status).toBe(200);
		expect(google.exchanges.some((e) => e.get("code") === "stolen")).toBe(false);
	});
});
