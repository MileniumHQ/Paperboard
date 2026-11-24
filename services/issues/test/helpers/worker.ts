// Runs the issues worker in real workerd through Miniflare: the real
// rate-limit binding and the real IssueStore Durable Object. Two parties
// can't run on loopback and are answered here: Cloudflare Access's signing
// keys (a key pair made per run, so tokens are signed for real) and the
// static assets, which only need to show the worker let a request through.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { build } from "esbuild";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";

export const TEAM = "test-team.cloudflareaccess.com";
export const AUD = "test-audience-tag";
export const SUBMIT_LIMIT = 5;
export const DASHBOARD_PAGE = "<!doctype html><title>Issues</title>";

let bundled: Promise<string> | undefined;

function bundle(): Promise<string> {
    bundled ??= build({
        entryPoints: [path.join(import.meta.dir, "testWorker.ts")],
        bundle: true,
        format: "esm",
        platform: "neutral",
        target: "esnext",
        external: ["cloudflare:workers"],
        write: false,
        logLevel: "silent",
    }).then((result) => {
        const out = result.outputFiles[0];
        if (!out) throw new Error("esbuild produced no worker bundle");
        return out.text;
    });
    return bundled;
}

const base64url = (bytes: ArrayBuffer | Uint8Array) => Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).toString("base64url");

export interface SigningKey {
    kid: string;
    privateKey: CryptoKey;
    jwk: JsonWebKey & { kid: string };
}

export async function signingKey(kid: string): Promise<SigningKey> {
    const pair = (await crypto.subtle.generateKey(
        { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
        true,
        ["sign", "verify"],
    )) as CryptoKeyPair;
    const jwk = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey;
    return { kid, privateKey: pair.privateKey, jwk: { ...jwk, kid, alg: "RS256", use: "sig" } };
}

/** An Access token as Cloudflare signs it; `claims` overrides the valid defaults. */
export async function accessToken(key: SigningKey, claims: Record<string, unknown> = {}): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const header = base64url(new TextEncoder().encode(JSON.stringify({ alg: "RS256", kid: key.kid, typ: "JWT" })));
    const payload = base64url(
        new TextEncoder().encode(
            JSON.stringify({ aud: [AUD], email: "maintainer@example.com", iss: `https://${TEAM}`, iat: now, nbf: now, exp: now + 3600, ...claims }),
        ),
    );
    const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key.privateKey, new TextEncoder().encode(`${header}.${payload}`));
    return `${header}.${payload}.${base64url(signature)}`;
}

export interface Issues {
    /** Sends a request to the worker, from `ip` unless the caller sets CF-Connecting-IP. */
    request(pathAndQuery: string, init?: RequestInit & { ip?: string | null }): Promise<Response>;
    /** Posts an issue the way the app does. */
    submit(body: unknown, init?: RequestInit & { ip?: string | null }): Promise<Response>;
    /** Calls the dashboard signed in with a valid token. */
    dashboard(pathAndQuery: string, init?: RequestInit): Promise<Response>;
    seed(count: number, receivedAt: number): Promise<void>;
    /** Rewrites the store as the first release left it (test door). */
    legacy(): Promise<void>;
    /** Where the store is kept; pass it to the next startIssues to restart on it. */
    persistDir: string;
    /** workerd's loopback origin */
    origin: string;
    /** The keys Access publishes; replace to rotate them. */
    access: { keys: SigningKey[]; reads: number };
    key: SigningKey;
    dispose(): Promise<void>;
}

export function validIssue(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        text: "The Game Server panel says Stopped after the app restarts.\n\nIt's still running.",
        context: { appVersion: "0.4.0", os: "Linux", osVersion: "6.12.1", arch: "x64", shell: "window" },
        details: "Panels on it:\n- dev.paperboard.gameserver 0.4.0\n\nWarnings and errors:\n2026-11-23T10:00:00.000Z [ERROR] [Supervisor] lost <ip>:25565",
        ...overrides,
    };
}

export async function startIssues(
    options: { aud?: string; assets?: (request: Request) => Response | Promise<Response>; persistDir?: string } = {},
): Promise<Issues> {
    const persistDir = options.persistDir ?? (await mkdtemp(path.join(tmpdir(), "issues-test-")));
    const key = await signingKey("key-1");
    const access = { keys: [key], reads: 0 };
    const script = await bundle();
    const mf = new Miniflare(
        convertV4MiniflareOptions({
            resourcePersistencePath: persistDir,
            name: "issues",
            modules: [{ type: "ESModule", path: "worker.mjs", contents: script }],
            compatibilityDate: "2026-10-01",
            bindings: { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: options.aud ?? AUD },
            ratelimits: { SUBMIT_LIMIT: { namespace_id: "1281931", simple: { limit: SUBMIT_LIMIT, period: 60 } } },
            durableObjects: { ISSUES: { className: "IssueStore", useSQLite: true } },
            serviceBindings: {
                ASSETS: options.assets ?? (async () => new Response(DASHBOARD_PAGE, { headers: { "Content-Type": "text/html" } })),
            },
            outboundService: async (request: Request) => {
                const url = new URL(request.url);
                if (url.host === TEAM && url.pathname === "/cdn-cgi/access/certs") {
                    access.reads++;
                    return Response.json({ keys: access.keys.map((k) => k.jwk) });
                }
                return new Response(`unexpected outbound request to ${url.href}`, { status: 599 });
            },
        }),
    );
    // Requests go straight to workerd's loopback entry socket: Miniflare's
    // dispatchFetch routes through an undici dispatcher that Bun's fetch ignores.
    const entry = await mf.ready;
    if (entry.hostname !== "127.0.0.1" && entry.hostname !== "localhost") throw new Error(`workerd is not on loopback: ${entry.href}`);
    const origin = entry.origin;

    const request: Issues["request"] = (pathAndQuery, init = {}) => {
        const { ip = "203.0.113.7", ...rest } = init;
        const headers = new Headers(rest.headers);
        if (ip !== null && !headers.has("CF-Connecting-IP")) headers.set("CF-Connecting-IP", ip);
        return fetch(`${origin}${pathAndQuery}`, { ...rest, headers, redirect: "manual" });
    };
    return {
        request,
        submit: (body, init = {}) =>
            request("/v1/issues", {
                method: "POST",
                ...init,
                headers: { "Content-Type": "application/json", ...Object.fromEntries(new Headers(init.headers)) },
                body: typeof body === "string" ? body : JSON.stringify(body),
            }),
        dashboard: async (pathAndQuery, init = {}) => {
            const headers = new Headers(init.headers);
            headers.set("Cf-Access-Jwt-Assertion", await accessToken(key));
            return request(pathAndQuery, { ...init, headers });
        },
        seed: async (count, receivedAt) => {
            const res = await fetch(`${origin}/__test/seed`, { method: "POST", body: JSON.stringify({ count, receivedAt }) });
            if (!res.ok) throw new Error(`seeding failed: ${res.status} ${await res.text()}`);
        },
        legacy: async () => {
            const res = await fetch(`${origin}/__test/legacy`, { method: "POST" });
            if (!res.ok) throw new Error(`legacy failed: ${res.status} ${await res.text()}`);
        },
        persistDir,
        access,
        key,
        origin,
        // a store the caller passed in outlives this run, for a restart on it
        async dispose() {
            await mf.dispose();
            if (!options.persistDir) await rm(persistDir, { recursive: true, force: true });
        },
    };
}
