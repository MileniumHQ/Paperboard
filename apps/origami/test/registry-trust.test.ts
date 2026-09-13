// Registry trust proofs (bun test): the registry hashes what it hosts,
// refuses self-attested records, never authenticates via URL query keys,
// and trashes instead of destroying.
import { describe, expect, it } from "bun:test";
import worker, { type Env } from "../src/index";

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
            JSON.stringify({ id: "good", name: "Good", version: "1.0.0", sha256: "b".repeat(64) }),
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

    it("writes the canonical panel: namespace only, no board: aliasing", async () => {
        const { env, kv } = envWith();
        const archive = new Uint8Array([9]);
        const form = new FormData();
        form.append("archive", new Blob([archive as any]), "m-1.0.0.tar.gz");
        form.append("metadata", JSON.stringify({ id: "m", name: "M", version: "1.0.0" }));
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
        form.append("metadata", JSON.stringify({ id: "doomed", name: "Doomed", version: "1.0.0" }));
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
    form.append("metadata", JSON.stringify({ id: "noform", name: "NoForm", version: "1.0.0" }));
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
        form.append("metadata", JSON.stringify({ id: "big", name: "Big", version: "1.0.0" }));
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
        const limit = 64 * 1024 * 1024 + 1024 * 1024 + 1024 * 1024;
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
        form.append("metadata", JSON.stringify({ id: "iconny", name: "Iconny", version: "1.0.0" }));
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
        form.append("metadata", JSON.stringify({ id: "iconext", name: "IconExt", version: "1.0.0" }));
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
        form.append("metadata", JSON.stringify({ id: "webpy", name: "Webpy", version: "1.0.0" }));
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

describe("paperdl filename sanitization", () => {
    function envWithPaperdl(objects: Record<string, { body: Uint8Array; filename?: string }>): Env {
        const dl = {
            async get(key: string) {
                const o = objects[key];
                if (!o) return null;
                return {
                    body: o.body,
                    httpEtag: '"mock-etag"',
                    customMetadata: o.filename ? { filename: o.filename } : {},
                    writeHttpMetadata(headers: Headers) {
                        headers.set("Content-Type", "application/octet-stream");
                    },
                };
            },
        } as unknown as R2Bucket;
        return { PACKAGES: createMockKV(), PAPERDL_BUCKET: dl, AUTH_KEY } as unknown as Env;
    }

    it("strips control characters from a decoded trailing filename instead of throwing", async () => {
        const env = envWithPaperdl({
            "crane/app": { body: new Uint8Array([1, 2, 3]) },
        });
        // %0A decodes to \n — a raw newline inside Content-Disposition used
        // to throw inside Headers.set and surface as a 500
        const res = await worker.fetch(
            new Request("http://localhost/paperdl/crane/app/download/foo%0Abar"),
            env,
            {} as any,
        );
        expect(res.status).toBe(200);
        expect(res.headers.get("Content-Disposition")).toBe(
            'attachment; filename="foobar"',
        );
    });

    it("returns 400 for an undecodable trailing filename", async () => {
        const env = envWithPaperdl({
            "crane/app": { body: new Uint8Array([1, 2, 3]) },
        });
        const res = await worker.fetch(
            new Request("http://localhost/paperdl/crane/app/download/%zz"),
            env,
            {} as any,
        );
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toMatch(/filename/i);
    });

    it("returns 400 for a trailing filename that sanitizes to nothing", async () => {
        const env = envWithPaperdl({
            "crane/app": { body: new Uint8Array([1, 2, 3]) },
        });
        // %0A%0A decodes to two newlines: every byte is a control character
        const res = await worker.fetch(
            new Request("http://localhost/paperdl/crane/app/download/%0A%0A"),
            env,
            {} as any,
        );
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toMatch(/filename/i);
    });

    it("keeps serving a stored metadata filename when no trailing name is given", async () => {
        const env = envWithPaperdl({
            "crane/app": { body: new Uint8Array([1, 2, 3]), filename: "app-1.2.3.jar" },
        });
        const res = await worker.fetch(
            new Request("http://localhost/paperdl/crane/app/download"),
            env,
            {} as any,
        );
        expect(res.status).toBe(200);
        expect(res.headers.get("Content-Disposition")).toBe(
            'attachment; filename="app-1.2.3.jar"',
        );
    });
});
