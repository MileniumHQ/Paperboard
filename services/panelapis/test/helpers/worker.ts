// Runs panelapis in real workerd through Miniflare: the real Cache API, the
// real rate-limit binding and the real SteamBudget Durable Object. Steam is
// the one party that cannot run on loopback, so the worker's outbound fetch
// is answered here, speaking Steam's wire format, and every request the
// worker sends upstream is recorded.
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { build } from "esbuild";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";

export const STEAM_KEY = "TESTKEY0123456789ABCDEF0123456789";
export const CLIENT_LIMIT = 60;

export interface UpstreamCall {
    method: string;
    url: URL;
    body: string;
}

export type SteamAnswer = (call: UpstreamCall) => Response | Promise<Response>;

let bundled: Promise<string> | undefined;

function bundle(): Promise<string> {
    bundled ??= build({
        entryPoints: [path.join(import.meta.dir, "testWorker.ts")],
        bundle: true,
        format: "esm",
        platform: "neutral",
        target: "esnext",
        write: false,
        logLevel: "silent",
    }).then((result) => {
        const out = result.outputFiles[0];
        if (!out) throw new Error("esbuild produced no worker bundle");
        return out.text;
    });
    return bundled;
}

export interface Panelapis {
    /** Sends a request to the worker, from `ip` unless the caller sets CF-Connecting-IP. */
    get(pathAndQuery: string, init?: RequestInit & { ip?: string | null }): Promise<Response>;
    budget(op: "clock" | "real-clock" | "seed" | "hours" | "reserve", body?: unknown): Promise<Response>;
    calls: UpstreamCall[];
    /** How Steam answers; replace per test. */
    steam: { answer: SteamAnswer };
    mf: Miniflare;
    /** Stops workerd; the Durable Object's storage stays on disk for a restart. */
    stop(): Promise<void>;
    /** Removes the persisted storage too. */
    dispose(): Promise<void>;
    persistDir: string;
}

export async function startPanelapis(options: { persistDir?: string; steamKey?: string } = {}): Promise<Panelapis> {
    const persistDir = options.persistDir ?? (await mkdtemp(path.join(tmpdir(), "panelapis-test-")));
    const calls: UpstreamCall[] = [];
    const steam: { answer: SteamAnswer } = {
        answer: (call) => {
            throw new Error(`no Steam answer set for ${call.method} ${call.url.pathname}`);
        },
    };
    const script = await bundle();
    const mf = new Miniflare(convertV4MiniflareOptions({
        resourcePersistencePath: persistDir,
        name: "panelapis",
        modules: [{ type: "ESModule", path: "worker.mjs", contents: script }],
        compatibilityDate: "2026-10-01",
        bindings: options.steamKey === "" ? {} : { STEAM_WEB_API_KEY: options.steamKey ?? STEAM_KEY },
        ratelimits: { CLIENT_LIMIT: { namespace_id: "1281930", simple: { limit: CLIENT_LIMIT, period: 60 } } },
        durableObjects: { BUDGET: "SteamBudget" },
        outboundService: async (request: Request) => {
            const call: UpstreamCall = { method: request.method, url: new URL(request.url), body: await request.text() };
            calls.push(call);
            return steam.answer(call);
        },
    }));
    // Requests go straight to workerd's loopback entry socket. Miniflare's
    // dispatchFetch routes through an undici dispatcher that Bun's fetch
    // ignores, which would send the request to the URL's real host instead.
    const entry = await mf.ready;
    if (entry.hostname !== "127.0.0.1" && entry.hostname !== "localhost") {
        throw new Error(`workerd is not on loopback: ${entry.href}`);
    }
    const origin = entry.origin;
    let stopped = false;
    const stop = async () => {
        if (stopped) return;
        stopped = true;
        await mf.dispose();
    };
    return {
        get(pathAndQuery, init = {}) {
            const { ip = "203.0.113.7", ...rest } = init;
            const headers = new Headers(rest.headers);
            if (ip !== null && !headers.has("CF-Connecting-IP")) headers.set("CF-Connecting-IP", ip);
            return fetch(`${origin}${pathAndQuery}`, { ...rest, headers, redirect: "manual" });
        },
        budget(op, body) {
            return fetch(`${origin}/__test/budget/${op}`, {
                method: "POST",
                body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
            });
        },
        calls,
        steam,
        mf,
        stop,
        async dispose() {
            await stop();
            if (!options.persistDir) await rm(persistDir, { recursive: true, force: true });
        },
        persistDir,
    };
}

export interface Fixture {
    items: Record<string, unknown>[];
}

export async function workshopItems(): Promise<Record<string, unknown>[]> {
    const fixture = JSON.parse(await readFile(path.join(import.meta.dir, "..", "fixtures", "tf2-workshop-items.json"), "utf8")) as Fixture;
    // the capture is ISteamRemoteStorage's; IPublishedFileService spells the game consumer_appid
    return fixture.items.map(({ consumer_app_id, ...item }) => ({ ...item, consumer_appid: consumer_app_id }));
}

export function steamJson(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
