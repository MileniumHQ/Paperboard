import { afterEach, expect, test } from "bun:test";
import * as crypto from "node:crypto";
import http from "node:http";
import { once } from "node:events";
import { signInToGoogleDrive } from "../src/main/googleOAuth";

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

test("the loopback sign-in exchanges the returned code with its PKCE verifier for a refresh token", async () => {
    let challenge = "";
    const tokenUrl = await tokenServer({ code: "code-1", challenge: () => challenge });
    const refresh = await signInToGoogleDrive(
        { clientId: "client", clientSecret: "secret" },
        {
            endpoints: { authUrl: "https://accounts.example/auth", tokenUrl },
            openExternal: async (raw) => {
                const auth = new URL(raw);
                expect(auth.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/drive.file");
                challenge = auth.searchParams.get("code_challenge")!;
                const redirect = auth.searchParams.get("redirect_uri")!;
                // a request with another state is not the answer
                expect((await fetch(`${redirect}?code=stolen&state=wrong`)).status).toBe(404);
                await fetch(`${redirect}?code=code-1&state=${auth.searchParams.get("state")}`);
            },
        },
    );
    expect(refresh).toBe("refresh-1");
});

test("a refused consent fails the sign-in and frees it for another try", async () => {
    const tokenUrl = await tokenServer({ code: "never", challenge: () => "" });
    const deps = (error: string) => ({
        endpoints: { authUrl: "https://accounts.example/auth", tokenUrl },
        openExternal: async (raw: string) => {
            const auth = new URL(raw);
            await fetch(`${auth.searchParams.get("redirect_uri")}?error=${error}&state=${auth.searchParams.get("state")}`);
        },
    });
    await expect(signInToGoogleDrive({ clientId: "c", clientSecret: "s" }, deps("access_denied"))).rejects.toThrow("not allowed");
    await expect(signInToGoogleDrive({ clientId: "c", clientSecret: "s" }, deps("server_error"))).rejects.toThrow("server_error");
});
