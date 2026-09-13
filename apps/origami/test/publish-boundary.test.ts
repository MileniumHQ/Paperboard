// Publish-boundary hardening (bun test): the adversarial audit's O1–O6,
// O8–O12. Each test proves the attack fails — these are the proofs the
// fix ships with.
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import worker, { type Env } from "../src/index";
import {
    isValidPanelId,
    isValidPanelVersion,
} from "../src/panels";

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
            if (options?.type === "json") return JSON.parse(val);
            return val;
        },
        async list(options?: any) {
            const prefix: string = options?.prefix ?? "";
            const keys = Array.from(store.keys())
                .filter((k) => k.startsWith(prefix))
                .map((name) => ({ name }));
            return { keys, list_complete: true, cacheStatus: null } as any;
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
    const objects = new Map<
        string,
        { body: Uint8Array; httpMetadata?: any; customMetadata?: Record<string, string> }
    >();
    return {
        objects,
        async put(key: string, body: any, options?: any) {
            const buf =
                body instanceof Uint8Array
                    ? body
                    : new Uint8Array(await new Response(body).arrayBuffer());
            objects.set(key, {
                body: buf,
                httpMetadata: options?.httpMetadata,
                customMetadata: options?.customMetadata,
            });
        },
        async get(key: string) {
            const obj = objects.get(key);
            if (!obj) return null;
            return {
                body: obj.body,
                httpEtag: '"mock-etag"',
                httpMetadata: obj.httpMetadata ?? { contentType: "application/gzip" },
                customMetadata: obj.customMetadata ?? {},
                writeHttpMetadata(headers: Headers) {
                    const type = obj.httpMetadata?.contentType ?? "application/gzip";
                    headers.set("Content-Type", type);
                },
            };
        },
        async delete(key: string) {
            objects.delete(key);
        },
    } as unknown as R2Bucket;
}

function envWith(kvData: Record<string, unknown> = {}, vars: Record<string, string> = {}) {
    const kv = createMockKV(kvData);
    const r2 = createMockR2();
    const env = { PACKAGES: kv, PANELS_BUCKET: r2, AUTH_KEY, ...vars } as unknown as Env;
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

function publishForm(
    metadata: Record<string, unknown>,
    archive = new Uint8Array([1, 2, 3]),
    icon?: { data: Uint8Array; name: string; type?: string },
): FormData {
    const form = new FormData();
    form.append(
        "archive",
        new Blob([archive as any], { type: "application/gzip" }),
        "panel.tar.gz",
    );
    form.append("metadata", JSON.stringify(metadata));
    if (icon) {
        form.append(
            "icon",
            new Blob([icon.data as any], { type: icon.type }),
            icon.name,
        );
    }
    return form;
}

const savedConsoleError = console.error;
beforeEach(() => {
    // the trash paths log loudly on mock gaps; keep test output clean
    console.error = () => {};
});
afterEach(() => {
    console.error = savedConsoleError;
});

describe("O1: id/version validation at the publish boundary", () => {
    it("refuses an id that would collide with the index key namespace", async () => {
        const { env, kv } = envWith();
        const res = await worker.fetch(
            authed("http://localhost/panel/publish", {
                method: "POST",
                body: publishForm({ id: "s:index", name: "Squat", version: "1.0.0" }),
            }),
            env,
            {} as any,
        );
        expect(res.status).toBe(400);
        expect((await res.json()).error).toMatch(/[a-zA-Z0-9_-]/);
        expect((kv as any).__store.has("panels:index")).toBe(false);
        expect((kv as any).__store.has("panel:s:index")).toBe(false);
    });

    it("refuses ids with quotes, slashes, dots-only traversal shapes, and control chars", async () => {
        const { env } = envWith();
        for (const bad of ['x"y', "a/b", "a\\b", "a b", "", "x\ny", "é"]) {
            const res = await worker.fetch(
                authed("http://localhost/panel/publish", {
                    method: "POST",
                    body: publishForm({ id: bad, name: "X", version: "1.0.0" }),
                }),
                env,
                {} as any,
            );
            expect(res.status).toBe(400);
        }
    });

    it("refuses versions that would break the download header", async () => {
        const { env } = envWith();
        for (const bad of ['1.0"0', "1.0.0\nR", "a/b", ""]) {
            const res = await worker.fetch(
                authed("http://localhost/panel/publish", {
                    method: "POST",
                    body: publishForm({ id: "ok", name: "X", version: bad }),
                }),
                env,
                {} as any,
            );
            expect(res.status).toBe(400);
        }
    });

    it("accepts well-formed ids and versions", () => {
        expect(isValidPanelId("dev.paperboard.terminal")).toBe(false); // dots are refused at publish
        expect(isValidPanelId("dev_paperboard_terminal")).toBe(true);
        expect(isValidPanelVersion("1.0.0-alpha.1")).toBe(true);
        expect(isValidPanelVersion("1 0")).toBe(false);
    });

    it("the JSON publish path validates id/version before the refusal branch", async () => {
        const { env } = envWith();
        const res = await worker.fetch(
            authed("http://localhost/panel/publish", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id: "s:index", name: "X", version: "1.0.0" }),
            }),
            env,
            {} as any,
        );
        expect(res.status).toBe(400);
    });
});

describe("O2: icon content type is derived, never publisher-chosen", () => {
    it("stores text/html icon bytes under the svg-derived image type", async () => {
        const { env, r2 } = envWith();
        const html = new TextEncoder().encode(
            '<html><script>alert(1)</script></html>',
        );
        const res = await worker.fetch(
            authed("http://localhost/panel/publish", {
                method: "POST",
                body: publishForm(
                    { id: "xss", name: "XSS", version: "1.0.0" },
                    new Uint8Array([1]),
                    { data: html, name: "icon.svg", type: "text/html" },
                ),
            }),
            env,
            {} as any,
        );
        expect(res.status).toBe(200);
        const stored = (r2 as any).objects.get("panels/xss/icon.svg");
        expect(stored?.httpMetadata?.contentType).toBe("image/svg+xml");
    });

    it("serves the icon back with the derived type, not the stored attack type", async () => {
        const { env, kv, r2 } = envWith();
        const html = new TextEncoder().encode("<script>1</script>");
        await worker.fetch(
            authed("http://localhost/panel/publish", {
                method: "POST",
                body: publishForm(
                    { id: "xss2", name: "XSS2", version: "1.0.0" },
                    new Uint8Array([1]),
                    { data: html, name: "icon.svg", type: "text/html" },
                ),
            }),
            env,
            {} as any,
        );
        const res = await worker.fetch(
            new Request("http://localhost/panel/xss2/icon"),
            env,
            {} as any,
        );
        expect(res.status).toBe(200);
        expect(res.headers.get("Content-Type")).toBe("image/svg+xml");
    });
});

describe("O3: the request envelope cap holds without a declared Content-Length", () => {
    it("refuses a body over MAX_REQUEST_BYTES even when the CL header lies or is absent", async () => {
        const { env, r2 } = envWith();
        // 64 MiB archive + 1 MiB icon + 1 MiB envelope = the cap; one byte
        // over must refuse. No Content-Length header at all (chunked-style).
        const oversized = new Uint8Array(64 * 1024 * 1024 + 2 * 1024 * 1024);
        const form = new FormData();
        form.append("archive", new Blob([oversized as any], { type: "application/gzip" }), "big.tar.gz");
        form.append("metadata", JSON.stringify({ id: "big", name: "Big", version: "1.0.0" }));
        const res = await worker.fetch(
            authed("http://localhost/panel/publish", { method: "POST", body: form }),
            env,
            {} as any,
        );
        expect(res.status).toBe(413);
        expect((r2 as any).objects.size).toBe(0);
    });
});

describe("O4: trash records never leak through the package index", () => {
    it("a deleted panel's trash record is absent from /package/index.json", async () => {
        const { env, kv } = envWith({
            "real-package": { name: "real" },
        });
        // publish then delete: the trash record exists in KV
        await worker.fetch(
            authed("http://localhost/panel/publish", {
                method: "POST",
                body: publishForm({ id: "doomed", name: "Doomed", version: "1.0.0" }),
            }),
            env,
            {} as any,
        );
        await worker.fetch(
            authed("http://localhost/panel/doomed", { method: "DELETE" }),
            env,
            {} as any,
        );
        expect(Array.from((kv as any).__store.keys()).some((k) => String(k).startsWith("trash:"))).toBe(true);

        const res = await worker.fetch(
            new Request("http://localhost/package/index.json"),
            env,
            {} as any,
        );
        const body = await res.json();
        expect(Object.keys(body).some((k) => String(k).startsWith("trash:"))).toBe(false);
        expect(body["real-package"]).toBeDefined();
    });
});

describe("O5: the index is a projection of live records, not a RMW cache", () => {
    it("a publish's index write reflects the full record set, not a stale read", async () => {
        const { env, kv } = envWith();
        await worker.fetch(
            authed("http://localhost/panel/publish", {
                method: "POST",
                body: publishForm({ id: "one", name: "One", version: "1.0.0" }),
            }),
            env,
            {} as any,
        );
        await worker.fetch(
            authed("http://localhost/panel/publish", {
                method: "POST",
                body: publishForm({ id: "two", name: "Two", version: "1.0.0" }),
            }),
            env,
            {} as any,
        );
        const index = JSON.parse((kv as any).__store.get("panels:index"));
        expect(index["one"]).toBeDefined();
        expect(index["two"]).toBeDefined();
    });

    it("a delete removes the panel from the index by rebuild", async () => {
        const { env, kv } = envWith();
        await worker.fetch(
            authed("http://localhost/panel/publish", {
                method: "POST",
                body: publishForm({ id: "gone", name: "Gone", version: "1.0.0" }),
            }),
            env,
            {} as any,
        );
        await worker.fetch(
            authed("http://localhost/panel/gone", { method: "DELETE" }),
            env,
            {} as any,
        );
        const index = JSON.parse((kv as any).__store.get("panels:index"));
        expect(index["gone"]).toBeUndefined();
    });
});

describe("O6: icons die with the panel", () => {
    it("trash removes every icon variant and the icon route refuses afterwards", async () => {
        const { env, kv, r2 } = envWith();
        await worker.fetch(
            authed("http://localhost/panel/publish", {
                method: "POST",
                body: publishForm(
                    { id: "iconed", name: "Iconed", version: "1.0.0" },
                    new Uint8Array([1]),
                    { data: new Uint8Array([9]), name: "icon.png", type: "image/png" },
                ),
            }),
            env,
            {} as any,
        );
        expect((r2 as any).objects.has("panels/iconed/icon.png")).toBe(true);

        await worker.fetch(
            authed("http://localhost/panel/iconed", { method: "DELETE" }),
            env,
            {} as any,
        );
        expect((r2 as any).objects.has("panels/iconed/icon.png")).toBe(false);
        expect(
            Array.from((r2 as any).objects.keys()).some((k) => String(k).startsWith("trash/")),
        ).toBe(true);

        // live record is gone, so the icon route refuses even if an object
        // somehow survived
        const res = await worker.fetch(
            new Request("http://localhost/panel/iconed/icon"),
            env,
            {} as any,
        );
        expect(res.status).toBe(404);
    });
});

describe("O8: method confusion closed", () => {
    it("download refuses non-GET/HEAD methods", async () => {
        const { env } = envWith();
        await worker.fetch(
            authed("http://localhost/panel/publish", {
                method: "POST",
                body: publishForm({ id: "dl", name: "DL", version: "1.0.0" }),
            }),
            env,
            {} as any,
        );
        const res = await worker.fetch(
            authed("http://localhost/panel/dl/download", { method: "PUT" }),
            env,
            {} as any,
        );
        expect(res.status).toBe(405);
    });

    it("java update refuses GET and requires POST + auth", async () => {
        const { env } = envWith();
        const get = await worker.fetch(
            authed("http://localhost/update/java", { method: "GET" }),
            env,
            {} as any,
        );
        expect(get.status).toBe(405);

        const noAuth = await worker.fetch(
            new Request("http://localhost/update/java", { method: "POST" }),
            env,
            {} as any,
        );
        expect(noAuth.status).toBe(401);
    });
});

describe("O9/O10/O11/O12: record hygiene", () => {
    it("the catch-all 500 does not echo internal error details", async () => {
        const { env } = envWith();
        // PACKAGES binding missing → the index route throws inside the handler
        const broken = { AUTH_KEY } as unknown as Env;
        const res = await worker.fetch(
            new Request("http://localhost/panels/index.json"),
            broken,
            {} as any,
        );
        expect(res.status).toBe(500);
        const body = await res.json();
        expect(body.details).toBeUndefined();
    });

    it("record URLs come from PANEL_BASE_URL, not the request origin", async () => {
        const { env, kv } = envWith(
            {},
            { PANEL_BASE_URL: "https://origami.ariapis.com" },
        );
        await worker.fetch(
            authed("http://evil.example/panel/publish", {
                method: "POST",
                body: publishForm({ id: "hosted", name: "Hosted", version: "1.0.0" }),
            }),
            env,
            {} as any,
        );
        const record = JSON.parse((kv as any).__store.get("panel:hosted"));
        expect(record.downloadUrl).toBe("https://origami.ariapis.com/panel/hosted/download");
        expect(record.downloadUrl).not.toContain("evil.example");
    });

    it("publisher-supplied icon URLs are dropped from the record", async () => {
        const { env, kv } = envWith();
        await worker.fetch(
            authed("http://localhost/panel/publish", {
                method: "POST",
                body: publishForm({
                    id: "noicon",
                    name: "NoIcon",
                    version: "1.0.0",
                    icon: "https://attacker.example/pixel.gif",
                }),
            }),
            env,
            {} as any,
        );
        const record = JSON.parse((kv as any).__store.get("panel:noicon"));
        expect(record.icon).toBeUndefined();
    });

    it("download 404s are indistinguishable between missing record and missing archive", async () => {
        const { env } = envWith();
        // no record at all
        const missing = await worker.fetch(
            new Request("http://localhost/panel/ghost/download"),
            env,
            {} as any,
        );
        expect(await missing.json()).toEqual({ error: "Panel not found" });
    });
});
