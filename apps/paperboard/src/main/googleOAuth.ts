// Connecting Google Drive for backups: Google's installed-app sign-in with
// PKCE and a loopback redirect, with Paperboard's own "Desktop app" client so
// Google's screen asks for Paperboard. The browser comes back to a one-shot
// listener on 127.0.0.1 (loopbackRedirect.ts); the refresh token it yields
// goes from here to the daemon's vault and never passes through a renderer.
// Electron-free so it can be tested.
import * as crypto from "crypto";
import { logger } from "daemon/core/logger";
import { listenForRedirect } from "./loopbackRedirect";

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
    /** the page the browser lands on afterwards; the reason says why a
     * sign-in was not connected */
    page: (outcome: "connected" | "not-connected", reason?: string) => string;
}

const base64url = (buf: Buffer) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// the sign-in waiting for the browser, if any: one at a time, and a newer
// one replaces it, since a tab the person closed never comes back to say so
let pending: AbortController | null = null;

/** Stops the sign-in waiting for the browser, if one is. It rejects as canceled. */
export function cancelGoogleSignIn(): void {
    pending?.abort();
}

/**
 * Signs in, exchanges the code for a refresh token, and hands the token to
 * `persist` (the daemon keeping it). Resolves with what persist resolves
 * with. Cancels the sign-in already waiting, if any. The browser tab is
 * answered last, with the real outcome: "connected" only once persist
 * succeeded, otherwise "not-connected" with the reason.
 */
export async function signInToGoogleDrive<T>(
    client: GoogleClient,
    deps: GoogleSignInDeps,
    persist: (refreshToken: string) => Promise<T>,
): Promise<T> {
    pending?.abort();
    const controller = new AbortController();
    pending = controller;
    const endpoints = deps.endpoints ?? GOOGLE_OAUTH;
    const verifier = base64url(crypto.randomBytes(32));
    const state = base64url(crypto.randomBytes(16));
    let tab: ((page: string) => Promise<void>) | null = null;
    try {
        const listener = await listenForRedirect({
            port: 0,
            pathname: "/callback",
            accept: (requested) => requested.searchParams.get("state") === state,
            signal: controller.signal,
            timeoutMs: deps.timeoutMs ?? SIGN_IN_TIMEOUT_MS,
        });
        try {
            const redirectUri = `http://127.0.0.1:${listener.port}/callback`;
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
            const caught = await listener.caught();
            tab = caught.answer;
            const code = caught.requested.searchParams.get("code");
            const error = caught.requested.searchParams.get("error");
            if (!code) throw new Error(error === "access_denied" ? "Google access was not allowed" : `Google sign-in failed: ${error ?? "no code"}`);

            const res = await fetch(endpoints.tokenUrl, {
                method: "POST",
                headers: { "content-type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams({
                    code,
                    client_id: client.clientId,
                    client_secret: client.clientSecret,
                    redirect_uri: redirectUri,
                    grant_type: "authorization_code",
                    code_verifier: verifier,
                }),
                signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]),
            });
            const body = (await res.json().catch((err) => {
                logger.warn("[backups] Google's token answer was not JSON:", err);
                return null;
            })) as { refresh_token?: unknown; error_description?: unknown; error?: unknown } | null;
            if (!body) throw new Error(`Google sent an unreadable answer (HTTP ${res.status})`);
            if (!res.ok) throw new Error(`Google refused the sign-in: ${String(body?.error_description ?? body?.error ?? `HTTP ${res.status}`)}`);
            if (typeof body?.refresh_token !== "string") throw new Error("Google did not grant offline access, so backups could not run later");
            const saved = await persist(body.refresh_token);
            await tab(deps.page("connected"));
            return saved;
        } catch (err) {
            await tab?.(deps.page("not-connected", (err as Error)?.message ?? String(err)));
            throw err;
        } finally {
            await listener.close();
        }
    } finally {
        if (pending === controller) pending = null;
    }
}
