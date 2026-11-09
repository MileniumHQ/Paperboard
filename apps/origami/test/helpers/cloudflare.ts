// Stand-ins for the Cloudflare bindings origami uses, because workerd is
// not a dependency of this worker. Each keeps the binding's real semantics
// for the calls origami makes:
// - KV: values are strings; get() resolves null for a missing key, and a
//   "json" read of a value that is not JSON throws, as the runtime does;
//   list() returns keys in byte order, at most `limit` (1000) per page,
//   with an opaque cursor until list_complete.
// - R2: get() resolves null or an object body with httpEtag (quoted) and
//   writeHttpMetadata(), which copies the stored http metadata onto headers.
// The wrangler runner speaks the CLI commands the operator publisher runs
// (`kv key list|get|put`, `r2 object put`) against the same stores, so the
// publisher and the worker routes meet over one KV and one bucket.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { CommandRunner } from "../../scripts/lib/panelPublish";
import type { Env } from "../../src/lib";

export class MemoryKV {
    readonly values = new Map<string, string>();

    async get(key: string, options?: "text" | "json" | { type?: "text" | "json" }): Promise<unknown> {
        const type = typeof options === "string" ? options : (options?.type ?? "text");
        const value = this.values.get(key);
        if (value === undefined) return null;
        return type === "json" ? JSON.parse(value) : value;
    }

    async put(key: string, value: string): Promise<void> {
        if (typeof value !== "string") throw new TypeError("KV put takes a string value here");
        this.values.set(key, value);
    }

    async delete(key: string): Promise<void> {
        this.values.delete(key);
    }

    async list(options: { prefix?: string; cursor?: string; limit?: number } = {}) {
        const limit = options.limit ?? 1000;
        const names = [...this.values.keys()]
            .filter((name) => name.startsWith(options.prefix ?? ""))
            .sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
        const start = options.cursor ? Number(Buffer.from(options.cursor, "base64").toString()) : 0;
        const page = names.slice(start, start + limit);
        const end = start + page.length;
        const complete = end >= names.length;
        return {
            keys: page.map((name) => ({ name })),
            list_complete: complete,
            ...(complete ? {} : { cursor: Buffer.from(String(end)).toString("base64") }),
            cacheStatus: null,
        };
    }

    setJson(key: string, value: unknown): void {
        this.values.set(key, JSON.stringify(value));
    }

    json<T>(key: string): T | null {
        const value = this.values.get(key);
        return value === undefined ? null : (JSON.parse(value) as T);
    }
}

export interface StoredObject {
    bytes: Uint8Array;
    contentType?: string;
    cacheControl?: string;
}

export class MemoryR2 {
    readonly objects = new Map<string, StoredObject>();

    async put(key: string, value: string | Uint8Array, options: { httpMetadata?: { contentType?: string; cacheControl?: string } } = {}) {
        const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
        this.objects.set(key, { bytes, ...options.httpMetadata });
    }

    async get(key: string) {
        const stored = this.objects.get(key);
        if (!stored) return null;
        const etag = createHash("md5").update(stored.bytes).digest("hex");
        return {
            key,
            size: stored.bytes.byteLength,
            etag,
            httpEtag: `"${etag}"`,
            httpMetadata: { contentType: stored.contentType, cacheControl: stored.cacheControl },
            get body() {
                return new Response(stored.bytes).body!;
            },
            writeHttpMetadata(headers: Headers) {
                if (stored.contentType) headers.set("content-type", stored.contentType);
                if (stored.cacheControl) headers.set("cache-control", stored.cacheControl);
            },
            text: async () => new TextDecoder().decode(stored.bytes),
            arrayBuffer: async () => stored.bytes.slice().buffer,
        };
    }
}

export interface Registry {
    kv: MemoryKV;
    panels: MemoryR2;
    paperdl: MemoryR2;
    env: Env;
}

export function createRegistry(): Registry {
    const kv = new MemoryKV();
    const panels = new MemoryR2();
    const paperdl = new MemoryR2();
    const env = {
        PACKAGES: kv as unknown as KVNamespace,
        PANELS_BUCKET: panels as unknown as R2Bucket,
        PAPERDL_BUCKET: paperdl as unknown as R2Bucket,
    } satisfies Env;
    return { kv, panels, paperdl, env };
}

export interface WranglerCall {
    command: string;
    args: string[];
}

/** The commands that write: a refused publish runs none of them. */
export function writes(calls: WranglerCall[]): WranglerCall[] {
    return calls.filter((c) => c.args.includes("put"));
}

function flag(args: string[], name: string): string | undefined {
    const at = args.indexOf(name);
    return at === -1 ? undefined : args[at + 1];
}

/** A `bunx wrangler ...` runner over the registry's stores, recording every command. */
export function wranglerRunner(registry: Registry, calls: WranglerCall[]): CommandRunner {
    return async (command, args) => {
        calls.push({ command, args: [...args] });
        if (command !== "bunx" || args[0] !== "wrangler") throw new Error(`unexpected command ${command} ${args.join(" ")}`);
        if (!args.includes("--remote")) throw new Error("the publisher must address the remote namespace");
        const [, area, noun, verb] = args;
        if (area === "kv" && noun === "key") {
            if (flag(args, "--binding") !== "PACKAGES") throw new Error("unexpected KV binding");
            if (verb === "list") {
                const prefix = flag(args, "--prefix") ?? "";
                const listed = await registry.kv.list({ prefix });
                return { stdout: JSON.stringify(listed.keys), stderr: "" };
            }
            if (verb === "get") {
                const value = registry.kv.values.get(args[4]!);
                if (value === undefined) throw new Error(`wrangler kv key get failed: Value not found`);
                return { stdout: value, stderr: "" };
            }
            if (verb === "put") {
                await registry.kv.put(args[4]!, args[5]!);
                return { stdout: "", stderr: "" };
            }
        }
        if (area === "r2" && noun === "object" && verb === "put") {
            const [bucket, ...rest] = args[4]!.split("/");
            if (bucket !== "paperboard-boards") throw new Error(`unexpected bucket ${bucket}`);
            const file = flag(args, "--file");
            const contentType = flag(args, "--content-type");
            if (!file || !contentType) throw new Error("r2 object put needs --file and --content-type");
            await registry.panels.put(rest.join("/"), new Uint8Array(readFileSync(file)), {
                httpMetadata: { contentType, cacheControl: flag(args, "--cache-control") },
            });
            return { stdout: "", stderr: "" };
        }
        throw new Error(`unexpected wrangler command: ${args.join(" ")}`);
    };
}
