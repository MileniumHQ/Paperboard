// Signing in to an MCP server over OAuth, the way the MCP authorization spec
// lays it out, for any server that asks:
//
//   1. find the server's authorization server: the protected-resource
//      metadata its 401 names (or the well-known address), else the server's
//      own origin, as servers from before that metadata existed do
//   2. read the authorization server's metadata (or its default endpoints)
//   3. register Paperboard as a client (dynamic client registration); a
//      server that doesn't offer it can't be signed in to this way
//   4. send the user's browser to its sign-in page with PKCE, asking for the
//      server as the resource; it comes back to a loopback address
//   5. trade the code for tokens, and later the refresh token for new ones
//
// Tokens go to the vault and nowhere else. Every endpoint is https (or a
// loopback address); a token request never follows a redirect.

import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";

/** what is kept in the vault for a signed-in server */
export interface Tokens {
    access: string;
    /** its type as the token endpoint named it ("Bearer") */
    type: string;
    refresh: string | null;
    /** ms since the epoch, or null when the endpoint didn't say */
    expiresAt: number | null;
    clientId: string;
    clientSecret: string | null;
    tokenEndpoint: string;
    /** how the client authenticates to the token endpoint */
    clientAuth: "none" | "client_secret_post" | "client_secret_basic";
    resource: string;
}

export interface Discovered {
    authorizationEndpoint: string;
    tokenEndpoint: string;
    registrationEndpoint: string;
    scope: string | null;
    resource: string;
    /** how Paperboard asks to authenticate to the token endpoint: as a public client unless the server takes only clients with a secret */
    clientAuth: Tokens["clientAuth"];
}

const MAX_JSON = 1024 * 1024;
const REQUEST_MS = 15_000;
/** a sign-in waits this long for the browser to come back */
export const SIGN_IN_MS = 15 * 60_000;
/** tokens this close to expiring are refreshed before use */
const EARLY_MS = 60_000;

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export class SignInNeeded extends Error {}

/** the endpoint is https, or http on this computer */
function checkEndpoint(raw: unknown, what: string): string {
    if (typeof raw !== "string" || !raw) throw new Error(`the sign-in server didn't give its ${what}`);
    let u: URL;
    try {
        u = new URL(raw);
    } catch {
        throw new Error(`the sign-in server's ${what} isn't an address`);
    }
    if (u.protocol !== "https:" && !(u.protocol === "http:" && LOOPBACK.has(u.hostname))) throw new Error(`the sign-in server's ${what} isn't https (${u.origin})`);
    if (u.username || u.password) throw new Error(`the sign-in server's ${what} holds a password`);
    return u.href;
}

async function readJson(res: Response): Promise<unknown> {
    const text = await res.text();
    if (text.length > MAX_JSON) throw new Error("the answer is past the size limit");
    try {
        return JSON.parse(text);
    } catch {
        throw new Error("the answer isn't JSON");
    }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** GET a metadata document; null when it isn't there (404 and the like), an error when it's broken */
async function getMetadata(f: typeof fetch, url: string): Promise<Record<string, unknown> | null> {
    let res: Response;
    try {
        res = await f(url, { headers: { Accept: "application/json", "MCP-Protocol-Version": "2025-06-18" }, signal: AbortSignal.timeout(REQUEST_MS) });
    } catch (e) {
        throw new Error(`couldn't reach ${new URL(url).host}: ${(e as Error).message}`);
    }
    if (!res.ok) {
        await res.body?.cancel();
        return null;
    }
    const body = await readJson(res).catch(() => null);
    return isRecord(body) ? body : null;
}

/** the parameters of a `WWW-Authenticate: Bearer ...` challenge */
export function bearerChallenge(header: string | null): Record<string, string> | null {
    if (!header || !/^\s*bearer\b/i.test(header)) return null;
    const out: Record<string, string> = {};
    for (const m of header.matchAll(/([a-zA-Z_][a-zA-Z0-9_-]*)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^\s,]+))/g)) out[m[1]!.toLowerCase()] = (m[2] ?? m[3] ?? "").replace(/\\(.)/g, "$1");
    return out;
}

/** the well-known addresses for a metadata document about `base`, path-aware as RFC 8414 and 9728 put them */
function wellKnown(base: URL, name: string): string[] {
    const path = base.pathname.replace(/\/+$/, "");
    return path ? [`${base.origin}/.well-known/${name}${path}`, `${base.origin}/.well-known/${name}`] : [`${base.origin}/.well-known/${name}`];
}

/** Find how to sign in to the MCP server at `serverUrl`. */
export async function discover(f: typeof fetch, serverUrl: string): Promise<Discovered> {
    const server = new URL(serverUrl);
    // 1. the server's own 401 names its metadata, and maybe the scope it wants
    let challenge: Record<string, string> | null = null;
    try {
        const res = await f(serverUrl, {
            method: "POST",
            redirect: "error",
            headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-06-18" },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "paperboard", version: "0.1.0" } } }),
            signal: AbortSignal.timeout(REQUEST_MS),
        });
        challenge = res.status === 401 ? bearerChallenge(res.headers.get("www-authenticate")) : null;
        await res.body?.cancel();
    } catch (e) {
        throw new Error(`couldn't reach ${server.host}: ${(e as Error).message}`);
    }
    let resourceMeta: Record<string, unknown> | null = null;
    if (challenge?.resource_metadata) resourceMeta = await getMetadata(f, checkEndpoint(challenge.resource_metadata, "resource metadata address"));
    for (const url of resourceMeta ? [] : wellKnown(server, "oauth-protected-resource")) {
        resourceMeta = await getMetadata(f, url);
        if (resourceMeta) break;
    }
    const servers = resourceMeta?.authorization_servers;
    const issuer = new URL(Array.isArray(servers) && typeof servers[0] === "string" ? checkEndpoint(servers[0], "authorization server") : server.origin);

    // 2. the authorization server's metadata
    let meta: Record<string, unknown> | null = null;
    for (const url of [...wellKnown(issuer, "oauth-authorization-server"), ...wellKnown(issuer, "openid-configuration"), `${issuer.href.replace(/\/+$/, "")}/.well-known/openid-configuration`]) {
        meta = await getMetadata(f, url);
        if (meta) break;
    }
    // servers from before the metadata: the default endpoints at the origin
    const at = (path: string) => `${issuer.origin}${path}`;
    const methods = meta?.code_challenge_methods_supported;
    if (Array.isArray(methods) && !methods.includes("S256")) throw new Error(`${issuer.host} doesn't support the sign-in protection (PKCE S256) Paperboard uses`);
    const registration = meta ? meta.registration_endpoint : at("/register");
    if (!registration) throw new Error(`${issuer.host} doesn't let apps register themselves, so signing in needs a client ID made for Paperboard`);

    const scopes = resourceMeta?.scopes_supported;
    const scope = challenge?.scope ?? (Array.isArray(scopes) && scopes.every((s) => typeof s === "string") && scopes.length ? scopes.join(" ") : null);
    const resource = typeof resourceMeta?.resource === "string" ? resourceMeta.resource : serverUrl;
    const auths = meta?.token_endpoint_auth_methods_supported;
    const clientAuth: Tokens["clientAuth"] =
        !Array.isArray(auths) || auths.includes("none") ? "none" : auths.includes("client_secret_post") ? "client_secret_post" : auths.includes("client_secret_basic") ? "client_secret_basic" : "none";
    return {
        authorizationEndpoint: checkEndpoint(meta ? meta.authorization_endpoint : at("/authorize"), "sign-in page"),
        tokenEndpoint: checkEndpoint(meta ? meta.token_endpoint : at("/token"), "token address"),
        registrationEndpoint: checkEndpoint(registration, "registration address"),
        scope,
        resource,
        clientAuth,
    };
}

/** Register Paperboard as a client of the authorization server, for one redirect address. */
export async function register(f: typeof fetch, d: Discovered, redirectUri: string): Promise<Pick<Tokens, "clientId" | "clientSecret" | "clientAuth">> {
    let res: Response;
    try {
        res = await f(d.registrationEndpoint, {
            method: "POST",
            redirect: "error",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({
                client_name: "Paperboard",
                redirect_uris: [redirectUri],
                grant_types: ["authorization_code", "refresh_token"],
                response_types: ["code"],
                token_endpoint_auth_method: d.clientAuth,
                ...(d.scope ? { scope: d.scope } : {}),
            }),
            signal: AbortSignal.timeout(REQUEST_MS),
        });
    } catch (e) {
        throw new Error(`couldn't register with ${new URL(d.registrationEndpoint).host}: ${(e as Error).message}`);
    }
    const host = new URL(d.registrationEndpoint).host;
    // 401 and 403 here mean the server only lets in apps it has approved; no request Paperboard makes changes that
    if (res.status === 401 || res.status === 403) {
        await res.body?.cancel();
        throw new Error(`${host} only lets apps it has approved sign in, and Paperboard isn't one of them yet`);
    }
    const body = await readJson(res).catch((e: Error) => {
        throw new Error(`${host} answered the registration with ${res.status}: ${e.message}`);
    });
    if (!res.ok || !isRecord(body) || typeof body.client_id !== "string" || !body.client_id) {
        const why = isRecord(body) && typeof body.error_description === "string" ? body.error_description : isRecord(body) && typeof body.error === "string" ? body.error : `status ${res.status}`;
        throw new Error(`${new URL(d.registrationEndpoint).host} refused to register Paperboard: ${why}`);
    }
    const secret = typeof body.client_secret === "string" && body.client_secret ? body.client_secret : null;
    const method = body.token_endpoint_auth_method;
    const clientAuth = !secret ? "none" : method === "client_secret_post" ? "client_secret_post" : "client_secret_basic";
    return { clientId: body.client_id, clientSecret: secret, clientAuth };
}

export const pkcePair = () => {
    const verifier = crypto.randomBytes(32).toString("base64url");
    return { verifier, challenge: crypto.createHash("sha256").update(verifier).digest("base64url") };
};

export function authorizeUrl(d: Discovered, clientId: string, redirectUri: string, state: string, challenge: string): string {
    const u = new URL(d.authorizationEndpoint);
    u.searchParams.set("response_type", "code");
    u.searchParams.set("client_id", clientId);
    u.searchParams.set("redirect_uri", redirectUri);
    u.searchParams.set("state", state);
    u.searchParams.set("code_challenge", challenge);
    u.searchParams.set("code_challenge_method", "S256");
    u.searchParams.set("resource", d.resource);
    if (d.scope) u.searchParams.set("scope", d.scope);
    return u.href;
}

/** POST to the token endpoint: a code, or a refresh token, for tokens */
async function tokenRequest(f: typeof fetch, t: Pick<Tokens, "tokenEndpoint" | "clientId" | "clientSecret" | "clientAuth" | "resource">, params: Record<string, string>, refreshFallback: string | null): Promise<Tokens> {
    const body = new URLSearchParams({ ...params, resource: t.resource });
    const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" };
    if (t.clientAuth === "client_secret_basic" && t.clientSecret) {
        headers.Authorization = `Basic ${Buffer.from(`${encodeURIComponent(t.clientId)}:${encodeURIComponent(t.clientSecret)}`).toString("base64")}`;
    } else {
        body.set("client_id", t.clientId);
        if (t.clientAuth === "client_secret_post" && t.clientSecret) body.set("client_secret", t.clientSecret);
    }
    const host = new URL(t.tokenEndpoint).host;
    let res: Response;
    try {
        res = await f(t.tokenEndpoint, { method: "POST", redirect: "error", headers, body, signal: AbortSignal.timeout(REQUEST_MS) });
    } catch (e) {
        throw new Error(`couldn't reach ${host}: ${(e as Error).message}`);
    }
    const got = await readJson(res).catch((e: Error) => {
        throw new Error(`${host} answered ${res.status}: ${e.message}`);
    });
    if (!res.ok || !isRecord(got) || typeof got.access_token !== "string" || !got.access_token) {
        const why = isRecord(got) && typeof got.error_description === "string" ? got.error_description : isRecord(got) && typeof got.error === "string" ? got.error : `status ${res.status}`;
        throw new Error(`${host} refused: ${why}`);
    }
    const expires = Number(got.expires_in);
    return {
        access: got.access_token,
        type: typeof got.token_type === "string" && got.token_type ? got.token_type : "Bearer",
        refresh: typeof got.refresh_token === "string" && got.refresh_token ? got.refresh_token : refreshFallback,
        expiresAt: Number.isFinite(expires) && expires > 0 ? Date.now() + expires * 1000 : null,
        clientId: t.clientId,
        clientSecret: t.clientSecret,
        clientAuth: t.clientAuth,
        tokenEndpoint: t.tokenEndpoint,
        resource: t.resource,
    };
}

export function exchange(f: typeof fetch, client: Pick<Tokens, "tokenEndpoint" | "clientId" | "clientSecret" | "clientAuth" | "resource">, code: string, redirectUri: string, verifier: string): Promise<Tokens> {
    return tokenRequest(f, client, { grant_type: "authorization_code", code, redirect_uri: redirectUri, code_verifier: verifier }, null);
}

export function refresh(f: typeof fetch, t: Tokens): Promise<Tokens> {
    if (!t.refresh) throw new SignInNeeded("the sign-in expired; sign in again");
    // the old refresh token is kept when the server doesn't rotate it
    return tokenRequest(f, t, { grant_type: "refresh_token", refresh_token: t.refresh }, t.refresh);
}

export const stale = (t: Tokens, now: number) => t.expiresAt !== null && t.expiresAt - EARLY_MS <= now;

export function parseTokens(raw: string): Tokens {
    let t: unknown;
    try {
        t = JSON.parse(raw);
    } catch {
        throw new SignInNeeded("the saved sign-in can't be read; sign in again");
    }
    if (!isRecord(t) || typeof t.access !== "string" || typeof t.clientId !== "string" || typeof t.tokenEndpoint !== "string" || typeof t.resource !== "string") {
        throw new SignInNeeded("the saved sign-in can't be read; sign in again");
    }
    return t as unknown as Tokens;
}

/**
 * A loopback listener for one sign-in: the browser comes back to
 * http://127.0.0.1:<port>/callback on this computer. When the panel is on
 * another device, it catches the same address there and the service is
 * handed it instead (finish), so the listener here simply never hears it.
 */
export class Callback {
    private server: http.Server | null = null;
    redirectUri = "";

    /** `onAddress` resolves with why it failed, or null; `over` says whether to stop listening once the browser has its page */
    async listen(onAddress: (url: string) => Promise<string | null>, over: () => boolean): Promise<string> {
        const server = http.createServer((req, res) => {
            const url = new URL(req.url ?? "/", this.redirectUri);
            if (url.pathname !== "/callback") {
                res.writeHead(404).end();
                return;
            }
            void onAddress(url.href)
                .catch((e: Error) => e.message)
                .then((failure) => {
                    // the page is sent before the listener goes, or the browser sees the connection drop
                    res.once("finish", () => over() && this.close());
                    page(res, failure);
                });
        });
        await new Promise<void>((ok, fail) => {
            server.once("error", fail);
            server.listen(0, "127.0.0.1", () => ok());
        });
        this.server = server;
        this.redirectUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}/callback`;
        return this.redirectUri;
    }

    close() {
        this.server?.close();
        this.server?.closeAllConnections();
        this.server = null;
    }
}

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function page(res: http.ServerResponse, failure: string | null) {
    const title = failure ? "Not signed in" : "Signed in";
    const text = failure ? `Paperboard couldn't finish signing in: ${escape(failure)}` : "You're signed in. You can close this tab and go back to Paperboard.";
    res.writeHead(failure ? 400 : 200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end(`<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem"><h1>${title}</h1><p>${text}</p></body>`);
}
