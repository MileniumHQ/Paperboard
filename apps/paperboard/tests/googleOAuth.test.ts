import { afterEach, expect, test } from "bun:test";
import * as crypto from "node:crypto";
import http from "node:http";
import { once } from "node:events";
import { paperboardGoogleClient, signInToGoogleDrive } from "../src/main/googleOAuth";

const servers: http.Server[] = [];
afterEach(async () => {
    for (const s of servers.splice(0)) await new Promise<void>((resolve) => s.close(() => resolve()));
});

// a token endpoint that grants only the code it issued, for the PKCE
// verifier matching the challenge the sign-in page was opened with
async function tokenServer(expected: { code: string; challenge: () => string }) {
    const server = http.createServer(async (req, res) => {
        let body = "";
        for await (const chunk of req) body += chunk;
        const form = new URLSearchParams(body);
        const verifierHash = crypto.createHash("sha256").update(form.get("code_verifier") ?? "").digest("base64url");
        const ok = form.get("code") === expected.code && verifierHash === expected.challenge() && form.get("grant_type") === "authorization_code";
        res.writeHead(ok ? 200 : 400, { "content-type": "application/json" }).end(JSON.stringify(ok ? { refresh_token: "refresh-1", access_token: "a" } : { error: "invalid_grant" }));
    });
    servers.push(server);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    return `http://127.0.0.1:${(server.address() as { port: number }).port}/token`;
}

// the page the browser tab receives; the tab's request stays open until the
// sign-in has its real outcome, so openExternal must not wait for it
function browser(tokenUrl: string, tabs: Array<Promise<string>>, params: (auth: URL) => string) {
    return {
        endpoints: { authUrl: "https://accounts.example/auth", tokenUrl },
        page: (outcome: string, reason?: string) => `page:${outcome}${reason ? `:${reason}` : ""}`,
        openExternal: async (raw: string) => {
            const auth = new URL(raw);
            tabs.push(fetch(`${auth.searchParams.get("redirect_uri")}?${params(auth)}&state=${auth.searchParams.get("state")}`).then((r) => r.text()));
        },
    };
}

test("the loopback sign-in exchanges the returned code with its PKCE verifier and shows connected only after the token is kept", async () => {
    let challenge = "";
    const tokenUrl = await tokenServer({ code: "code-1", challenge: () => challenge });
    const tabs: Array<Promise<string>> = [];
    let kept = "";
    let tabAnsweredEarly = false;
    const deps = browser(tokenUrl, tabs, (auth) => {
        expect(auth.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/drive.file");
        challenge = auth.searchParams.get("code_challenge")!;
        return "code=code-1";
    });
    const result = await signInToGoogleDrive({ clientId: "client", clientSecret: "secret" }, deps, async (refreshToken) => {
        tabAnsweredEarly = await Promise.race([tabs[0].then(() => true), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 50))]);
        kept = refreshToken;
        return "kept";
    });
    expect(result).toBe("kept");
    expect(kept).toBe("refresh-1");
    expect(tabAnsweredEarly).toBe(false);
    expect(await tabs[0]).toBe("page:connected");
});

test("a request with another state is not the answer", async () => {
    const tokenUrl = await tokenServer({ code: "code-1", challenge: () => "" });
    const tabs: Array<Promise<string>> = [];
    let wrongStatus = 0;
    const deps = browser(tokenUrl, tabs, () => "error=access_denied");
    const open = deps.openExternal;
    deps.openExternal = async (raw: string) => {
        const redirect = new URL(raw).searchParams.get("redirect_uri")!;
        wrongStatus = (await fetch(`${redirect}?code=stolen&state=wrong`)).status;
        await open(raw);
    };
    await expect(signInToGoogleDrive({ clientId: "c", clientSecret: "s" }, deps, async () => "never")).rejects.toThrow("not allowed");
    expect(wrongStatus).toBe(404);
});

test("a token the daemon cannot keep is not shown as connected", async () => {
    let challenge = "";
    const tokenUrl = await tokenServer({ code: "code-1", challenge: () => challenge });
    const tabs: Array<Promise<string>> = [];
    const deps = browser(tokenUrl, tabs, (auth) => {
        challenge = auth.searchParams.get("code_challenge")!;
        return "code=code-1";
    });
    await expect(
        signInToGoogleDrive({ clientId: "c", clientSecret: "s" }, deps, async () => {
            throw new Error("The computer could not be reached");
        }),
    ).rejects.toThrow("could not be reached");
    expect(await tabs[0]).toBe("page:not-connected:The computer could not be reached");
});

test("a refused token exchange is not shown as connected", async () => {
    const tokenUrl = await tokenServer({ code: "other-code", challenge: () => "" });
    const tabs: Array<Promise<string>> = [];
    const deps = browser(tokenUrl, tabs, () => "code=code-1");
    await expect(signInToGoogleDrive({ clientId: "c", clientSecret: "s" }, deps, async () => "never")).rejects.toThrow("Google refused the sign-in");
    expect(await tabs[0]).toContain("page:not-connected:Google refused the sign-in");
});

test("a refused consent fails the sign-in, shows the not-connected page, and frees it for another try", async () => {
    const tokenUrl = await tokenServer({ code: "never", challenge: () => "" });
    const tabs: Array<Promise<string>> = [];
    const deps = (error: string) => browser(tokenUrl, tabs, () => `error=${error}`);
    await expect(signInToGoogleDrive({ clientId: "c", clientSecret: "s" }, deps("access_denied"), async () => "never")).rejects.toThrow("not allowed");
    await expect(signInToGoogleDrive({ clientId: "c", clientSecret: "s" }, deps("server_error"), async () => "never")).rejects.toThrow("server_error");
    expect(await Promise.all(tabs)).toEqual(["page:not-connected:Google access was not allowed", "page:not-connected:Google sign-in failed: server_error"]);
});

test("Paperboard's Google client comes from the build, and a build without both halves has none", () => {
    expect(paperboardGoogleClient({ MAIN_VITE_GOOGLE_CLIENT_ID: " id.apps.googleusercontent.com ", MAIN_VITE_GOOGLE_CLIENT_SECRET: "s" })).toEqual({
        clientId: "id.apps.googleusercontent.com",
        clientSecret: "s",
    });
    expect(paperboardGoogleClient({ MAIN_VITE_GOOGLE_CLIENT_ID: "id" })).toBeNull();
    expect(paperboardGoogleClient({ MAIN_VITE_GOOGLE_CLIENT_ID: "id", MAIN_VITE_GOOGLE_CLIENT_SECRET: "  " })).toBeNull();
    expect(paperboardGoogleClient({})).toBeNull();
});
