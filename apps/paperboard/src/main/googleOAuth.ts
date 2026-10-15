// Connecting Google Drive for backups: Google's installed-app sign-in with
// PKCE and a loopback redirect, with Paperboard's own "Desktop app" client so
// Google's screen asks for Paperboard. The browser comes back to a one-shot
// listener on 127.0.0.1; the
// refresh token it yields goes from here to the daemon's vault and never
// passes through a renderer. Electron-free so it can be tested.
import * as crypto from "crypto";
import * as http from "http";
import { once } from "events";
import { logger } from "../../papercrane/logger";

export const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const SIGN_IN_TIMEOUT_MS = 5 * 60_000;

export interface GoogleOAuthEndpoints {
    authUrl: string;
    tokenUrl: string;
}

export const GOOGLE_OAUTH: GoogleOAuthEndpoints = {
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
};

export interface GoogleClient {
    clientId: string;
    clientSecret: string;
}

/** Paperboard's Google client, built in from MAIN_VITE_GOOGLE_CLIENT_ID and
 * MAIN_VITE_GOOGLE_CLIENT_SECRET (apps/paperboard/.env.local, gitignored).
 * Google does not treat a Desktop app client's secret as confidential, since
 * it ships inside the app; it stays out of git so secret scanning does not
 * flag it. null when the build has no client. */
export function paperboardGoogleClient(env: { MAIN_VITE_GOOGLE_CLIENT_ID?: unknown; MAIN_VITE_GOOGLE_CLIENT_SECRET?: unknown }): GoogleClient | null {
    const clientId = typeof env.MAIN_VITE_GOOGLE_CLIENT_ID === "string" ? env.MAIN_VITE_GOOGLE_CLIENT_ID.trim() : "";
    const clientSecret = typeof env.MAIN_VITE_GOOGLE_CLIENT_SECRET === "string" ? env.MAIN_VITE_GOOGLE_CLIENT_SECRET.trim() : "";
    return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export interface GoogleSignInDeps {
    /** shows the sign-in page in the user's browser */
    openExternal: (url: string) => Promise<void>;
    endpoints?: GoogleOAuthEndpoints;
    timeoutMs?: number;
    /** the page the browser lands on afterwards; a bare one by default */
    page?: (outcome: "connected" | "not-connected") => string;
}

const base64url = (buf: Buffer) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const PAGE = (message: string) =>
    `<!doctype html><meta charset="utf-8"><title>Paperboard</title><body style="font-family:sans-serif;padding:3em">${message}</body>`;

// one sign-in at a time: each holds a listening socket and a browser tab
let signingIn = false;

/** resolves with the refresh token once the user signs in and allows access */
export async function signInToGoogleDrive(
    client: GoogleClient,
    deps: GoogleSignInDeps,
): Promise<string> {
    if (signingIn) throw new Error("A Google sign-in is already open in your browser");
    signingIn = true;
    const endpoints = deps.endpoints ?? GOOGLE_OAUTH;
    const verifier = base64url(crypto.randomBytes(32));
    const state = base64url(crypto.randomBytes(16));
    let finish!: (outcome: { code: string } | { error: string }) => void;
    const outcome = new Promise<{ code: string } | { error: string }>((resolve) => (finish = resolve));
    const server = http.createServer((req, res) => {
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        if (url.pathname !== "/callback" || url.searchParams.get("state") !== state) {
            res.writeHead(404).end();
            return;
        }
        const code = url.searchParams.get("code");
        const error = url.searchParams.get("error");
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(
            deps.page
                ? deps.page(code ? "connected" : "not-connected")
                : PAGE(code ? "Google Drive is connected. You can close this tab and go back to Paperboard." : "Google Drive was not connected. You can close this tab."),
        );
        finish(code ? { code } : { error: error === "access_denied" ? "Google access was not allowed" : `Google sign-in failed: ${error ?? "no code"}` });
    });
    const timer = setTimeout(() => finish({ error: "The Google sign-in was not finished within 5 minutes" }), deps.timeoutMs ?? SIGN_IN_TIMEOUT_MS);
    try {
        server.listen(0, "127.0.0.1");
        await once(server, "listening");
        const redirectUri = `http://127.0.0.1:${(server.address() as { port: number }).port}/callback`;
        const auth = new URL(endpoints.authUrl);
        auth.search = new URLSearchParams({
            client_id: client.clientId,
            redirect_uri: redirectUri,
            response_type: "code",
            scope: DRIVE_FILE_SCOPE,
            access_type: "offline",
            prompt: "consent",
            state,
            code_challenge: base64url(crypto.createHash("sha256").update(verifier).digest()),
            code_challenge_method: "S256",
        }).toString();
        await deps.openExternal(auth.toString());
        const result = await outcome;
        if ("error" in result) throw new Error(result.error);

        const res = await fetch(endpoints.tokenUrl, {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                code: result.code,
                client_id: client.clientId,
                client_secret: client.clientSecret,
                redirect_uri: redirectUri,
                grant_type: "authorization_code",
                code_verifier: verifier,
            }),
            signal: AbortSignal.timeout(30_000),
        });
        const body = (await res.json().catch((err) => {
            logger.warn("[backups] Google's token answer was not JSON:", err);
            return null;
        })) as { refresh_token?: unknown; error_description?: unknown; error?: unknown } | null;
        if (!body) throw new Error(`Google sent an unreadable answer (HTTP ${res.status})`);
        if (!res.ok) throw new Error(`Google refused the sign-in: ${String(body?.error_description ?? body?.error ?? `HTTP ${res.status}`)}`);
        if (typeof body?.refresh_token !== "string") throw new Error("Google did not grant offline access, so backups could not run later");
        return body.refresh_token;
    } finally {
        clearTimeout(timer);
        signingIn = false;
        server.closeAllConnections();
        server.close();
    }
}
