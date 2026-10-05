// Registry trust proofs (bun test): the registry hashes what it hosts,
// refuses self-attested records, never authenticates via URL query keys,
// and trashes instead of destroying.
import { describe, expect, it } from "bun:test";
import worker, { type Env } from "../src/index";
import { MAX_REQUEST_BYTES } from "../src/routes/panels";

// a well-formed release signature: origami stores it but holds no key to
// verify it (clients do, against the offline release key)
const TEST_SIGNATURE = "A".repeat(86) + "==";

const AUTH_KEY = "test-auth-key";

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
        AUTH_KEY,
    } as unknown as Env;
    return { env, kv, r2 };
}

const authed = (url: string, init?: RequestInit) =>
    new Request(url, {
        ...init,
        headers: {
            ...(init?.headers as Record<string, string> | undefined),
            Authorization: `Bearer ${AUTH_KEY}`,
        },
    });

describe("registry auth surface", () => {
    it("refuses the publish route with a query-string key, even a correct one", async () => {
        const { env } = envWith();
        const res = await worker.fetch(
            new Request(`http://localhost/panel/publish?key=${AUTH_KEY}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id: "x", name: "X", version: "1.0.0" }),
            }),
            env,
            {} as any,
        );
        // query keys are not credentials: 401, and the body is never read
        // as a publish (the refusal happens before JSON parsing matters)
        expect(res.status).toBe(401);
    });

    it("refuses ?auth= the same way", async () => {
        const { env } = envWith();
        const res = await worker.fetch(
            new Request(`http://localhost/panel/publish?auth=${AUTH_KEY}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id: "x", name: "X", version: "1.0.0" }),
            }),
            env,
            {} as any,
        );
        expect(res.status).toBe(401);
    });

    it("still accepts header credentials", async () => {
        const { env } = envWith();
        const res = await worker.fetch(
            authed("http://localhost/panel/publish", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id: "x", name: "X", version: "1.0.0" }),
            }),
            env,
            {} as any,
        );
        // header auth passes; the JSON-publish trust refusal answers 400
        expect(res.status).toBe(400);
    });
});

describe("publish trust separation", () => {
    it("refuses JSON records carrying a publisher URL and self-supplied hash", async () => {
        const { env, kv } = envWith();
        const res = await worker.fetch(
            authed("http://localhost/panel/publish", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    id: "evil",
                    name: "Evil",
                    version: "9.9.9",
                    downloadUrl: "https://evil.example/evil.tar.gz",
                    sha256: "a".repeat(64),
                }),
            }),
            env,
            {} as any,
        );
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toMatch(/multipart/);
        // nothing stored
        expect((kv as any).__store.has("panel:evil")).toBe(false);
    });

    it("multipart publish stores the server-computed hash, never the claim", async () => {
        const { env, kv, r2 } = envWith();
        const archive = new Uint8Array([1, 2, 3, 4, 5]);
        const form = new FormData();
        form.append("archive", new Blob([archive as any], { type: "application/gzip" }), "evil-1.0.0.tar.gz");
        form.append(
            "metadata",
            JSON.stringify({ signature: TEST_SIGNATURE, id: "good", name: "Good", version: "1.0.0", sha256: "b".repeat(64) }),
        );
        const res = await worker.fetch(
            authed("http://localhost/panel/publish", { method: "POST", body: form }),
            env,
            {} as any,
        );
        expect(res.status).toBe(200);
        const stored = JSON.parse((kv as any).__store.get("panel:good"));
        const digest = await crypto.subtle.digest("SHA-256", archive);
        const expected = Array.from(new Uint8Array(digest))
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("");
        expect(stored.sha256).toBe(expected);
        expect(stored.sha256).not.toBe("b".repeat(64));
        // same-origin download URL: the registry hosts what it hashes
        expect(stored.downloadUrl).toBe("http://localhost/panel/good/download");
        expect(stored.archiveKey).toBe("panels/good/good-1.0.0.tar.gz");
        expect((r2 as any).objects.has("panels/good/good-1.0.0.tar.gz")).toBe(true);
    });

    it("refuses a publish without a release signature, writing nothing", async () => {
        const { env, kv, r2 } = envWith();
        for (const signature of [undefined, "", "not base64!", "QUJD"]) {
            const form = new FormData();
            form.append("archive", new Blob([new Uint8Array([7])]), "u-1.0.0.tar.gz");
            form.append("metadata", JSON.stringify({ id: "unsigned", name: "U", version: "1.0.0", signature }));
            const res = await worker.fetch(
                authed("http://localhost/panel/publish", { method: "POST", body: form }),
                env,
                {} as any,
            );
            expect(res.status).toBe(400);
        }
        expect(((kv as any).__store as Map<string, string>).has("panel:unsigned")).toBe(false);
        expect((r2 as any).objects.size).toBe(0);
    });

    it("stores the publisher's signature on the record", async () => {
        const { env, kv } = envWith();
        const form = new FormData();
        form.append("archive", new Blob([new Uint8Array([8])]), "s-1.0.0.tar.gz");
        form.append("metadata", JSON.stringify({ signature: TEST_SIGNATURE, id: "signed", name: "S", version: "1.0.0" }));
        const res = await worker.fetch(authed("http://localhost/panel/publish", { method: "POST", body: form }), env, {} as any);
        expect(res.status).toBe(200);
        expect(JSON.parse(((kv as any).__store as Map<string, string>).get("panel:signed")!).signature).toBe(TEST_SIGNATURE);
    });

    it("writes the canonical panel: namespace only, no board: aliasing", async () => {
        const { env, kv } = envWith();
        const archive = new Uint8Array([9]);
        const form = new FormData();
        form.append("archive", new Blob([archive as any]), "m-1.0.0.tar.gz");
        form.append("metadata", JSON.stringify({ signature: TEST_SIGNATURE, id: "m", name: "M", version: "1.0.0" }));
        const res = await worker.fetch(
            authed("http://localhost/panel/publish", { method: "POST", body: form }),
            env,
            {} as any,
        );
        expect(res.status).toBe(200);
        const store = (kv as any).__store as Map<string, string>;
        expect(store.has("panel:m")).toBe(true);
        expect(store.has("board:m")).toBe(false);
        // outright rename, no legacy aliasing: a pre-rename board: key is
        // dead data — /panel/:id must not serve it
        store.set("board:legacy", JSON.stringify({ id: "legacy", name: "Legacy", version: "0.1.0" }));
        const get = await worker.fetch(new Request("http://localhost/panel/legacy"), env, {} as any);
        expect(get.status).toBe(404);
    });
});

describe("recoverable delete", () => {
    async function publish(env: Env) {
        const archive = new Uint8Array([7, 7, 7]);
        const form = new FormData();
        form.append("archive", new Blob([archive as any]), "doomed-1.0.0.tar.gz");
        form.append("metadata", JSON.stringify({ signature: TEST_SIGNATURE, id: "doomed", name: "Doomed", version: "1.0.0" }));
        const res = await worker.fetch(
            authed("http://localhost/panel/publish", { method: "POST", body: form }),
            env,
            {} as any,
        );
        expect(res.status).toBe(200);
    }

    it("DELETE trashes the record and archive instead of destroying them", async () => {
        const { env, kv, r2 } = envWith();
        await publish(env);
        const store = (kv as any).__store as Map<string, string>;
        expect(store.has("panel:doomed")).toBe(true);

        const del = await worker.fetch(
            authed("http://localhost/panel/doomed", { method: "DELETE" }),
            env,
            {} as any,
        );
        expect(del.status).toBe(200);
        const body = await del.json();
        expect(body.trashed).toBe(true);

        // live keys gone
        expect(store.has("panel:doomed")).toBe(false);
        expect((r2 as any).objects.has("panels/doomed/doomed-1.0.0.tar.gz")).toBe(false);
        // record recoverable under a trash: key with its timestamp
        const trashKeys = Array.from(store.keys()).filter((k) => k.startsWith("trash:"));
        expect(trashKeys).toHaveLength(1);
        const trashed = JSON.parse(store.get(trashKeys[0])!);
        expect(trashed.id).toBe("doomed");
        expect(trashed.trashedAt).toBeTruthy();
        // trashed archive copy recoverable
        const trashObjects = Array.from((r2 as any).objects.keys() as Iterable<string>).filter((k: string) =>
            k.startsWith("trash/"),
        );
        expect(trashObjects).toHaveLength(1);
        // the panel no longer serves or downloads
        const get = await worker.fetch(new Request("http://localhost/panel/doomed"), env, {} as any);
        expect(get.status).toBe(404);
        const index = await worker.fetch(new Request("http://localhost/panels/index.json"), env, {} as any);
        const indexBody = await index.json();
        expect(indexBody["doomed"]).toBeUndefined();
    });
});

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
        authed("http://localhost/panel/legacy/download"),
        env,
        {} as any,
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(String(body.error ?? body.message ?? "")).toMatch(/not found/i);
});

it("publish without a manifest stores no manifest (no metadata masquerade)", async () => {
    const { env, kv } = envWith();
    const archive = new Uint8Array([7]);
    const form = new FormData();
    form.append("archive", new Blob([archive as any], { type: "application/gzip" }), "m-1.0.0.tar.gz");
    form.append("metadata", JSON.stringify({ signature: TEST_SIGNATURE, id: "noform", name: "NoForm", version: "1.0.0" }));
    const res = await worker.fetch(
        authed("http://localhost/panel/publish", { method: "POST", body: form }),
        env,
        {} as any,
    );
    expect(res.status).toBe(200);
    const stored = JSON.parse((kv as any).__store.get("panel:noform"));
    expect(stored.manifest).toBeUndefined();
});

describe("publish upload size caps", () => {
    it("refuses an archive over MAX_ARCHIVE_BYTES without buffering it", async () => {
        const { env, kv, r2 } = envWith();
        const oversized = new Uint8Array(64 * 1024 * 1024 + 1);
        const form = new FormData();
        form.append("archive", new Blob([oversized as any], { type: "application/gzip" }), "big-1.0.0.tar.gz");
        form.append("metadata", JSON.stringify({ signature: TEST_SIGNATURE, id: "big", name: "Big", version: "1.0.0" }));
        const res = await worker.fetch(
            authed("http://localhost/panel/publish", { method: "POST", body: form }),
            env,
            {} as any,
        );
        expect(res.status).toBe(413);
        const body = await res.json();
        expect(body.error).toMatch(/MAX_ARCHIVE_BYTES/);
        expect(body.limitBytes).toBe(64 * 1024 * 1024);
        // refused without buffering: nothing hashed, nothing stored
        expect((kv as any).__store.has("panel:big")).toBe(false);
        expect((r2 as any).objects.has("panels/big/big-1.0.0.tar.gz")).toBe(false);
    });

    it("refuses early on a declared Content-Length over the request envelope, body unread", async () => {
        const { env, kv, r2 } = envWith();
        const limit = MAX_REQUEST_BYTES;
        const res = await worker.fetch(
            authed("http://localhost/panel/publish", {
                method: "POST",
                headers: {
                    "Content-Type": "multipart/form-data; boundary=cap",
                    "Content-Length": String(limit + 1),
                },
                body: "tiny",
            }),
            env,
            {} as any,
        );
        expect(res.status).toBe(413);
        const body = await res.json();
        expect(body.error).toMatch(/MAX_REQUEST_BYTES/);
        expect((kv as any).__store.has("panel:big")).toBe(false);
        expect((r2 as any).objects.size).toBe(0);
    });

    it("refuses an icon over MAX_ICON_BYTES", async () => {
        const { env, kv, r2 } = envWith();
        const bigIcon = new Uint8Array(1024 * 1024 + 1);
        const form = new FormData();
        form.append("archive", new Blob([new Uint8Array([1])], { type: "application/gzip" }), "m-1.0.0.tar.gz");
        form.append("metadata", JSON.stringify({ signature: TEST_SIGNATURE, id: "iconny", name: "Iconny", version: "1.0.0" }));
        form.append("icon", new Blob([bigIcon as any], { type: "image/png" }), "icon.png");
        const res = await worker.fetch(
            authed("http://localhost/panel/publish", { method: "POST", body: form }),
            env,
            {} as any,
        );
        expect(res.status).toBe(413);
        const body = await res.json();
        expect(body.error).toMatch(/MAX_ICON_BYTES/);
        expect(body.limitBytes).toBe(1024 * 1024);
        // record never saved; no icon object stored
        expect((kv as any).__store.has("panel:iconny")).toBe(false);
        expect(
            Array.from((r2 as any).objects.keys() as Iterable<string>).some(
                (k: string) => k.startsWith("panels/iconny/icon."),
            ),
        ).toBe(false);
    });
});

describe("publish icon extension", () => {
    it("refuses unknown icon extensions with a typed 400 instead of defaulting to png", async () => {
        const { env, kv, r2 } = envWith();
        const form = new FormData();
        form.append("archive", new Blob([new Uint8Array([1])], { type: "application/gzip" }), "m-1.0.0.tar.gz");
        form.append("metadata", JSON.stringify({ signature: TEST_SIGNATURE, id: "iconext", name: "IconExt", version: "1.0.0" }));
        form.append("icon", new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" }), "icon.jpg");
        const res = await worker.fetch(
            authed("http://localhost/panel/publish", { method: "POST", body: form }),
            env,
            {} as any,
        );
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toMatch(/\.png, \.svg, or \.webp/);
        expect(body.error).toMatch(/\.jpg/);
        expect((kv as any).__store.has("panel:iconext")).toBe(false);
        expect(
            Array.from((r2 as any).objects.keys() as Iterable<string>).some(
                (k: string) => k.startsWith("panels/iconext/icon."),
            ),
        ).toBe(false);
    });

    it("accepts .webp icons under the cap and stores them with the webp content type", async () => {
        const { env, kv, r2 } = envWith();
        const form = new FormData();
        form.append("archive", new Blob([new Uint8Array([1])], { type: "application/gzip" }), "m-1.0.0.tar.gz");
        form.append("metadata", JSON.stringify({ signature: TEST_SIGNATURE, id: "webpy", name: "Webpy", version: "1.0.0" }));
        form.append("icon", new Blob([new Uint8Array([1, 2])], { type: "image/webp" }), "icon.webp");
        const res = await worker.fetch(
            authed("http://localhost/panel/publish", { method: "POST", body: form }),
            env,
            {} as any,
        );
        expect(res.status).toBe(200);
        expect((r2 as any).objects.has("panels/webpy/icon.webp")).toBe(true);
        const stored = JSON.parse((kv as any).__store.get("panel:webpy"));
        expect(stored.iconUrl).toBe("http://localhost/panel/webpy/icon");
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
            AUTH_KEY,
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
            "https://github.com/MileniumHQ/Paperboard/releases/download/pb-v3.0.0-alpha/paperboard-macos-x64.zip",
        );
        expect(res.headers.get("Cache-Control")).toContain("immutable");
    });

    it("resolves the latest alias from KV without caching it", async () => {
        const env = envWithDownloads();
        const res = await get(dl("/crane/latest/crane-linux-arm64.tar.gz"), env);
        expect(res.status).toBe(302);
        expect(res.headers.get("Location")).toBe(
            "https://github.com/MileniumHQ/Paperboard/releases/download/crane-v2.0.0-alpha/crane-linux-arm64.tar.gz",
        );
        expect(res.headers.get("Cache-Control")).toBe("no-cache");
    });

    it("keeps serving previous versions after latest moves", async () => {
        const env = envWithDownloads();
        const res = await get(dl("/pb/2.0.0-alpha/paperboard-macos-x64.zip"), env);
        expect(res.status).toBe(302);
        expect(res.headers.get("Location")).toBe(
            "https://github.com/MileniumHQ/Paperboard/releases/download/pb-v2.0.0-alpha/paperboard-macos-x64.zip",
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
            AUTH_KEY,
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
            "https://github.com/MileniumHQ/Paperboard/releases/download/pb-v3.0.0-alpha/paperboard-macos-x64.zip",
        );
        const latest = await get(
            "http://localhost/paperdl/crane/latest/crane-linux-arm64.tar.gz",
            env,
        );
        expect(latest.status).toBe(302);
        expect(latest.headers.get("Location")).toBe(
            "https://github.com/MileniumHQ/Paperboard/releases/download/crane-v2.0.0-alpha/crane-linux-arm64.tar.gz",
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
            "https://i.paperboard.dev/pb/latest/paperboard-macos-x64.dmg",
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

describe("store listing publish", () => {
    const STORE = {
        about: "./store/about.md",
        screenshots: [
            { light: "./store/1-light.png", dark: "./store/1-dark.png", alt: "Chat" },
        ],
        services: [{ name: "Ollama", detail: "Downloading models" }],
        credits: [{ name: "Discord.js", detail: "Providing the backend engine" }],
        requirements: [{ name: "RAM", detail: "16 GB" }],
    };

    function listingForm(store: unknown, parts: Record<string, Blob | string>) {
        const form = new FormData();
        form.append("archive", new Blob([new Uint8Array([1])], { type: "application/gzip" }), "s-1.0.0.tar.gz");
        form.append(
            "metadata",
            JSON.stringify({
                signature: TEST_SIGNATURE,
                id: "storey",
                name: "Storey",
                version: "1.0.0",
                manifest: { id: "storey", store },
            }),
        );
        for (const [name, part] of Object.entries(parts)) {
            if (typeof part === "string") form.append(name, part);
            else form.append(name, part, `${name}.png`);
        }
        return form;
    }

    const png = (byte: number) => new Blob([new Uint8Array([byte])], { type: "image/png" });

    async function publish(env: Env, form: FormData) {
        return worker.fetch(
            authed("http://localhost/panel/publish", { method: "POST", body: form }),
            env,
            {} as any,
        );
    }

    it("stores the listing in the record and serves its screenshots", async () => {
        const { env, kv, r2 } = envWith();
        const res = await publish(
            env,
            listingForm(STORE, {
                about: "## Hello",
                "screenshot-0-light": png(1),
                "screenshot-0-dark": png(2),
            }),
        );
        expect(res.status).toBe(200);

        const stored = JSON.parse((kv as any).__store.get("panel:storey"));
        expect(stored.store).toEqual({
            about: "## Hello",
            screenshots: [
                {
                    light: "http://localhost/panel/storey/media/1.0.0/0-light.png",
                    dark: "http://localhost/panel/storey/media/1.0.0/0-dark.png",
                    alt: "Chat",
                },
            ],
            services: STORE.services,
            credits: STORE.credits,
            requirements: STORE.requirements,
        });
        expect([...(r2 as any).objects.keys()]).toContain("panels/storey/media/1.0.0/0-dark.png");

        const media = await worker.fetch(
            new Request("http://localhost/panel/storey/media/1.0.0/0-dark.png"),
            env,
            {} as any,
        );
        expect(media.status).toBe(200);
        expect(new Uint8Array(await media.arrayBuffer())).toEqual(new Uint8Array([2]));
    });

    it("refuses a listing whose declared screenshot is missing, before writing anything", async () => {
        const { env, kv, r2 } = envWith();
        const res = await publish(
            env,
            listingForm(STORE, { about: "hi", "screenshot-0-light": png(1) }),
        );
        expect(res.status).toBe(400);
        expect(((await res.json()) as any).error).toContain("screenshot-0-dark");
        expect((kv as any).__store.has("panel:storey")).toBe(false);
        expect((r2 as any).objects.size).toBe(0);
    });

    it("refuses a malformed listing with a typed 400", async () => {
        const { env, kv } = envWith();
        for (const bad of [
            { screenshots: [{ light: "../secret.png" }] },
            { about: "./store/about.txt" },
            { services: [{ name: "Ollama" }] },
            { requirements: "16 GB" },
        ]) {
            const res = await publish(env, listingForm(bad, {}));
            expect(res.status).toBe(400);
        }
        expect((kv as any).__store.has("panel:storey")).toBe(false);
    });

    it("refuses an oversize screenshot with the cap's 413", async () => {
        const { env, kv } = envWith();
        const big = new Blob([new Uint8Array(2 * 1024 * 1024 + 1)], { type: "image/png" });
        const res = await publish(
            env,
            listingForm({ screenshots: [{ light: "./store/1.png" }] }, { "screenshot-0-light": big }),
        );
        expect(res.status).toBe(413);
        expect((kv as any).__store.has("panel:storey")).toBe(false);
    });

    it("serves only media the live record references, and trashes it on delete", async () => {
        const { env, r2 } = envWith();
        await publish(
            env,
            listingForm(STORE, {
                about: "hi",
                "screenshot-0-light": png(1),
                "screenshot-0-dark": png(2),
            }),
        );
        // an object under the prefix the record doesn't name stays private
        (r2 as any).objects.set("panels/storey/media/0.9.0/0-light.png", { body: new Uint8Array([9]) });
        const stale = await worker.fetch(
            new Request("http://localhost/panel/storey/media/0.9.0/0-light.png"),
            env,
            {} as any,
        );
        expect(stale.status).toBe(404);

        const del = await worker.fetch(
            authed("http://localhost/panel/storey", { method: "DELETE" }),
            env,
            {} as any,
        );
        expect(del.status).toBe(200);
        const keys = [...(r2 as any).objects.keys()] as string[];
        expect(keys).not.toContain("panels/storey/media/1.0.0/0-light.png");
        expect(keys.some((k) => k.endsWith("-panels/storey/media/1.0.0/0-light.png") && k.startsWith("trash/"))).toBe(true);
        const gone = await worker.fetch(
            new Request("http://localhost/panel/storey/media/1.0.0/0-light.png"),
            env,
            {} as any,
        );
        expect(gone.status).toBe(404);
    });
});
