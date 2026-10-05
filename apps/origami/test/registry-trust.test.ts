// Registry trust proofs (bun test): the registry serves only the archive
// it hosts, download redirects are database-backed, and the worker has no
// publish route (panels are written by the operator through wrangler).
import { describe, expect, it } from "bun:test";
import worker, { type Env } from "../src/index";

function createMockKV(initialData: Record<string, unknown> = {}): KVNamespace {
    const store = new Map<string, string>();
    for (const [k, v] of Object.entries(initialData)) {
        store.set(k, typeof v === "string" ? v : JSON.stringify(v));
    }

    return {
        async get(key: string, options?: any) {
            const val = store.get(key);
            if (val === undefined) return null;
            if (options?.type === "json") {
                return JSON.parse(val);
            }
            return val;
        },
        async list(options?: any) {
            const prefix: string = options?.prefix ?? "";
            const keys = Array.from(store.keys())
                .filter((k) => k.startsWith(prefix))
                .map((name) => ({ name }));
            return {
                keys,
                list_complete: true,
                cacheStatus: null,
            } as any;
        },
        async put(key: string, value: string) {
            store.set(key, value);
        },
        async delete(key: string) {
            store.delete(key);
        },
        async getWithMetadata() {
            throw new Error("Not implemented");
        },
        __store: store,
    } as unknown as KVNamespace;
}

function createMockR2() {
    const objects = new Map<string, { body: Uint8Array; customMetadata?: Record<string, string> }>();
    return {
        objects,
        async put(key: string, body: any, options?: any) {
            const buf =
                body instanceof Uint8Array
                    ? body
                    : new Uint8Array(await new Response(body).arrayBuffer());
            objects.set(key, { body: buf, customMetadata: options?.customMetadata });
        },
        async get(key: string) {
            const obj = objects.get(key);
            if (!obj) return null;
            return {
                body: obj.body,
                httpEtag: '"mock-etag"',
                customMetadata: obj.customMetadata ?? {},
                writeHttpMetadata(headers: Headers) {
                    headers.set("Content-Type", "application/gzip");
                },
            };
        },
        async delete(key: string) {
            objects.delete(key);
        },
    } as unknown as R2Bucket;
}

function envWith(kvData: Record<string, unknown> = {}): { env: Env; kv: any; r2: any } {
    const kv = createMockKV(kvData);
    const r2 = createMockR2();
    const env = {
        PACKAGES: kv,
        PANELS_BUCKET: r2,
    } as unknown as Env;
    return { env, kv, r2 };
}


it("a stored record with an off-registry downloadUrl never redirects to it", async () => {
    // a legacy pre-hashing record could carry a publisher URL; the
    // redirect leg is deleted — the registry serves only what it hosts
    const { env, kv, r2 } = envWith();
    (kv as any).__store.set(
        "panel:legacy",
        JSON.stringify({
            id: "legacy",
            name: "Legacy",
            version: "0.9.0",
            sha256: "a".repeat(64),
            archiveKey: "panels/legacy/nonexistent.tar.gz", // bytes absent
            downloadUrl: "https://off-registry.example/evil.tar.gz",
        }),
    );
    const res = await worker.fetch(
        new Request("http://localhost/panel/legacy/download"),
        env,
        {} as any,
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(String(body.error ?? body.message ?? "")).toMatch(/not found/i);
});




describe("no worker write surface", () => {
    it("has no publish route: POST /panel/publish writes nothing", async () => {
        const { env, kv, r2 } = envWith();
        const res = await worker.fetch(
            new Request("http://localhost/panel/publish", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id: "x", name: "X", version: "1.0.0" }),
            }),
            env,
            {} as any,
        );
        expect(res.status).not.toBe(200);
        expect((kv as any).__store.size).toBe(0);
        expect((r2 as any).objects.size).toBe(0);
    });

    it("has no delete route: DELETE /panel/:id does not trash a record", async () => {
        const { env, kv } = envWith({
            "panel:keep": { id: "keep", name: "Keep", version: "1.0.0" },
        });
        const res = await worker.fetch(
            new Request("http://localhost/panel/keep", { method: "DELETE" }),
            env,
            {} as any,
        );
        expect(res.status).not.toBe(200);
        expect((kv as any).__store.has("panel:keep")).toBe(true);
    });
});

describe("download redirects", () => {
    // Binaries live on GitHub Releases; Origami only 302-redirects to
    // them (plus the small latest.yml feeds from R2). The KV version
    // database is the source of truth: unknown versions and unrecorded
    // files are 404s, never fabricated redirects.
    const PB_RECORD = {
        latest: "3.0.0-alpha",
        versions: {
            "2.0.0-alpha": {
                files: [{ file: "paperboard-macos-x64.zip", sha256: "old", size: 1 }],
            },
            "3.0.0-alpha": {
                files: [
                    { file: "paperboard-macos-x64.zip", sha256: "aaa", sha512: "bbb", size: 10 },
                    { file: "paperboard-linux-x64.AppImage", sha256: "ccc", sha512: "ddd", size: 20 },
                ],
            },
        },
    };
    const CRANE_RECORD = {
        latest: "2.0.0-alpha",
        versions: {
            "2.0.0-alpha": {
                files: [{ file: "crane-linux-arm64.tar.gz", sha256: "eee", size: 5 }],
            },
        },
    };

    function envWithDownloads(withRecords = true, withBucket = true): Env {
        const objects: Record<string, string> = {
            "pb/latest.yml": "version: 3.0.0-alpha\n",
            "pb/latest-mac.yml": "version: 3.0.0-alpha\n",
            "pb/latest-linux.yml": "version: 3.0.0-alpha\n",
            "paperboard/index.json": JSON.stringify({ frozen: true }),
        };
        const dl = {
            async get(key: string) {
                const text = objects[key];
                if (!text) return null;
                return {
                    body: text,
                    httpEtag: '"mock-etag"',
                    customMetadata: {},
                    writeHttpMetadata(headers: Headers) {
                        headers.set("Content-Type", "application/octet-stream");
                    },
                    async text() {
                        return text;
                    },
                };
            },
        } as unknown as R2Bucket;
        const kvData = withRecords ? { "dl/pb": PB_RECORD, "dl/crane": CRANE_RECORD } : {};
        return {
            PACKAGES: createMockKV(kvData),
            ...(withBucket ? { PAPERDL_BUCKET: dl } : {}),
        } as unknown as Env;
    }

    const dl = (path: string) => `https://i.paperboard.dev${path}`;
    const get = (url: string, env: Env, init?: RequestInit) =>
        worker.fetch(new Request(url, init), env, {} as any);

    it("302s a versioned file to its GitHub release asset, immutably", async () => {
        const env = envWithDownloads();
        const res = await get(
            dl("/pb/3.0.0-alpha/paperboard-macos-x64.zip"),
            env,
        );
        expect(res.status).toBe(302);
        expect(res.headers.get("Location")).toBe(
            "https://github.com/MileniumHQ/Paperboard/releases/download/v3.0.0-alpha/paperboard-macos-x64.zip",
        );
        expect(res.headers.get("Cache-Control")).toContain("immutable");
    });

    it("resolves the latest alias from KV without caching it", async () => {
        const env = envWithDownloads();
        const res = await get(dl("/crane/latest/crane-linux-arm64.tar.gz"), env);
        expect(res.status).toBe(302);
        expect(res.headers.get("Location")).toBe(
            "https://github.com/MileniumHQ/Paperboard/releases/download/v2.0.0-alpha/crane-linux-arm64.tar.gz",
        );
        expect(res.headers.get("Cache-Control")).toBe("no-cache");
    });

    it("keeps serving previous versions after latest moves", async () => {
        const env = envWithDownloads();
        const res = await get(dl("/pb/2.0.0-alpha/paperboard-macos-x64.zip"), env);
        expect(res.status).toBe(302);
        expect(res.headers.get("Location")).toBe(
            "https://github.com/MileniumHQ/Paperboard/releases/download/v2.0.0-alpha/paperboard-macos-x64.zip",
        );
    });

    it("404s unknown versions, unrecorded files, and hostile segments", async () => {
        const env = envWithDownloads();
        for (const path of [
            "/pb/9.9.9/paperboard-macos-x64.zip", // version not in the DB
            "/pb/3.0.0-alpha/evil.exe", // file not recorded for that version
            "/pb/3.0.0-alpha/paperboard-macos-x64.zip/extra", // too many segments
            "/pb/3.0.0-alpha/a%20b", // encoded space: not a clean segment
            "/pb/%2e%2e/x", // encoded traversal: not a clean segment
            "/pb/latest", // alias without a file
            "/pb", // app without version/file
            "/", // bare root
            "/panel/some-id/download", // registry routes are unreachable here
            "/package/java-26.json",
            "/health",
            "/paperdl/pb/latest/paperboard-macos-x64.zip", // prefixed scheme belongs on the main host
        ]) {
            const res = await get(dl(path), env);
            expect(res.status).toBe(404);
        }
    });

    it("refuses non-GET methods on the download host", async () => {
        const env = envWithDownloads();
        const res = await get(dl("/pb/3.0.0-alpha/paperboard-macos-x64.zip"), env, {
            method: "POST",
        });
        expect(res.status).toBe(404);
    });

    it("404s when the version database has no record", async () => {
        const env = envWithDownloads(false);
        const res = await get(dl("/pb/latest/paperboard-macos-x64.zip"), env);
        expect(res.status).toBe(404);
    });

    it("serves the updater feeds from R2 on the download host", async () => {
        const env = envWithDownloads();
        const res = await get(dl("/pb/latest-mac.yml"), env);
        expect(res.status).toBe(200);
        expect(res.headers.get("Content-Type")).toContain("text/yaml");
        expect(await res.text()).toContain("version: 3.0.0-alpha");
    });

    it("500s the feed when the bucket is unconfigured", async () => {
        const res = await get(dl("/pb/latest.yml"), envWithDownloads(true, false));
        expect(res.status).toBe(500);
    });

    it("404s a missing feed object instead of an empty body", async () => {
        const env = {
            PACKAGES: createMockKV({}),
            PAPERDL_BUCKET: { async get() { return null; } },
        } as unknown as Env;
        const res = await get(dl("/pb/latest.yml"), env);
        expect(res.status).toBe(404);
    });

    it("mirrors the versioned scheme under /paperdl/ on the main host", async () => {
        const env = envWithDownloads();
        const versioned = await get(
            "http://localhost/paperdl/pb/3.0.0-alpha/paperboard-macos-x64.zip",
            env,
        );
        expect(versioned.status).toBe(302);
        expect(versioned.headers.get("Location")).toBe(
            "https://github.com/MileniumHQ/Paperboard/releases/download/v3.0.0-alpha/paperboard-macos-x64.zip",
        );
        const latest = await get(
            "http://localhost/paperdl/crane/latest/crane-linux-arm64.tar.gz",
            env,
        );
        expect(latest.status).toBe(302);
        expect(latest.headers.get("Location")).toBe(
            "https://github.com/MileniumHQ/Paperboard/releases/download/v2.0.0-alpha/crane-linux-arm64.tar.gz",
        );
        const feed = await get("http://localhost/paperdl/pb/latest.yml", env);
        expect(feed.status).toBe(200);
        expect(await feed.text()).toContain("version: 3.0.0-alpha");
    });

    it("redirects legacy per-target downloads to the canonical latest file", async () => {
        const env = envWithDownloads();
        const mac = await get("http://localhost/paperdl/paperboard/macos-x64/download", env);
        expect(mac.status).toBe(302);
        expect(mac.headers.get("Location")).toBe(
            "https://i.paperboard.dev/pb/latest/paperboard-macos-x64.zip",
        );
        const crane = await get("http://localhost/paperdl/crane/linux-x64/download", env);
        expect(crane.status).toBe(302);
        expect(crane.headers.get("Location")).toBe(
            "https://i.paperboard.dev/crane/latest/crane-linux-x64.tar.gz",
        );
    });

    it("404s legacy downloads for unknown targets instead of fabricating", async () => {
        const env = envWithDownloads();
        for (const url of [
            "http://localhost/paperdl/crane/app/download",
            "http://localhost/paperdl/paperboard/solaris-sparc/download",
        ]) {
            expect((await get(url, env)).status).toBe(404);
        }
    });

    it("serves the current feed from the legacy yml path so old installs keep updating", async () => {
        const env = envWithDownloads();
        const res = await get("http://localhost/paperdl/paperboard/latest-mac.yml", env);
        expect(res.status).toBe(200);
        expect(await res.text()).toContain("version: 3.0.0-alpha");
    });

    it("keeps serving the frozen legacy index.json", async () => {
        const env = envWithDownloads();
        const res = await get("http://localhost/paperdl/paperboard/index.json", env);
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ frozen: true });
    });

    it("does not serve short routes on the main host", async () => {
        const env = envWithDownloads();
        const res = await get(
            "http://localhost/pb/latest/paperboard-macos-x64.zip",
            env,
        );
        expect(res.status).toBe(404);
    });
});
