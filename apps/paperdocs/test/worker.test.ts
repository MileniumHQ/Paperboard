import { describe, expect, test } from "bun:test";
import worker from "../src/worker";

// Mirrors the built dist layout: the landing at the root, the docs HTML entry
// at /docs/index.html, docs assets at the root but linked through the /docs
// base, and the docs' own public files at the root.
const FILES: Record<string, { body: string; type: string }> = {
    "/": { body: "<!doctype html><title>Paperboard</title>", type: "text/html" },
    "/index.html": {
        body: "<!doctype html><title>Paperboard</title>",
        type: "text/html",
    },
    "/css/style.css": { body: "body{}", type: "text/css" },
    "/js/vendor/three.module.js": { body: "export {}", type: "text/javascript" },
    "/screens/paperconsole-docs.png": { body: "png", type: "image/png" },
    "/docs/index.html": {
        body: "<!doctype html><title>PaperDocs</title>",
        type: "text/html",
    },
    "/404.html": {
        body: "<!doctype html><title>404</title><p>That page does not exist.</p>",
        type: "text/html",
    },
    "/assets/docs-abc.js": { body: "console.log(1)", type: "text/javascript" },
    "/assets/docs-abc.css": { body: "a{}", type: "text/css" },
    "/paperdocs.png": { body: "png", type: "image/png" },
    "/site.webmanifest": { body: "{}", type: "application/manifest+json" },
    "/docslike.txt": { body: "static", type: "text/plain" },
};

function createAssets() {
    return {
        async fetch(request: Request): Promise<Response> {
            // The asset server maps a directory request to its index file.
            const pathname = new URL(request.url).pathname.replace(
                /\/$/,
                "/index.html",
            );
            const file = FILES[pathname] ?? FILES[`${pathname}.html`];
            if (!file) return new Response("not found", { status: 404 });
            return new Response(file.body, {
                headers: { "content-type": file.type },
            });
        },
    };
}

function get(path: string, accept = "text/html") {
    return worker.fetch(
        new Request(`https://paperboard.dev${path}`, {
            headers: accept ? { accept } : {},
        }),
        { ASSETS: createAssets() },
    );
}

describe("paperdocs worker routing", () => {
    test("serves the landing at the root, not the docs shell", async () => {
        const res = await get("/");
        expect(res.status).toBe(200);
        expect(await res.text()).toContain("Paperboard");
    });

    test("serves landing static files unchanged", async () => {
        const css = await get("/css/style.css", "*/*");
        expect(css.status).toBe(200);
        expect(css.headers.get("content-type")).toBe("text/css");

        const model = await get("/js/vendor/three.module.js", "*/*");
        expect(model.status).toBe(200);
    });

    test("redirects the bare docs mount to its trailing-slash form", async () => {
        const res = await get("/docs");
        expect(res.status).toBe(308);
        expect(new URL(res.headers.get("location")!).pathname).toBe("/docs/");
    });

    test("redirects the docs index to the canonical mount", async () => {
        const res = await get("/docs/index.html");
        expect(res.status).toBe(308);
        expect(new URL(res.headers.get("location")!).pathname).toBe("/docs/");
    });

    test("serves the docs shell at /docs/", async () => {
        const res = await get("/docs/");
        expect(res.status).toBe(200);
        expect(await res.text()).toContain("PaperDocs");
    });

    test("strips the docs prefix for built assets", async () => {
        const js = await get("/docs/assets/docs-abc.js", "*/*");
        expect(js.status).toBe(200);
        expect(await js.text()).toContain("console.log");

        const png = await get("/docs/paperdocs.png", "*/*");
        expect(png.status).toBe(200);
        expect(png.headers.get("content-type")).toBe("image/png");

        const manifest = await get("/docs/site.webmanifest", "*/*");
        expect(manifest.status).toBe(200);
    });

    test("falls back to the docs shell for client-side routes", async () => {
        const res = await get("/docs/paperapi/general/overview");
        expect(res.status).toBe(200);
        expect(await res.text()).toContain("PaperDocs");
    });

    test("a missing docs asset stays a 404, never the shell", async () => {
        const res = await get("/docs/assets/missing.js", "*/*");
        expect(res.status).toBe(404);
    });

    test("a missing top-level path stays a 404, never the landing", async () => {
        const res = await get("/nope");
        expect(res.status).toBe(404);
    });

    test("a missing root page serves the static 404 document", async () => {
        const res = await get("/nope");
        expect(res.status).toBe(404);
        expect(await res.text()).toContain("That page does not exist.");
    });

    test("a missing asset is not answered with the 404 document", async () => {
        const res = await get("/nope.css", "*/*");
        expect(res.status).toBe(404);
        expect(await res.text()).not.toContain("That page does not exist.");
    });

    test("a static file sharing the docs prefix is not captured", async () => {
        const res = await get("/docslike.txt", "*/*");
        expect(res.status).toBe(200);
        expect(await res.text()).toBe("static");
    });
});
