import { describe, expect, test } from "bun:test";
import worker from "../src/worker";

// Mirrors the built dist layout: the landing at the root, every docs page a
// real file under /docs, the README aliases as static meta-redirect files, and
// the shared 404 document at the root.
const FILES: Record<string, { body: string; type: string }> = {
    "/": { body: "<!doctype html><title>Paperboard</title>", type: "text/html" },
    "/index.html": {
        body: "<!doctype html><title>Paperboard</title>",
        type: "text/html",
    },
    "/css/style.css": { body: "body{}", type: "text/css" },
    "/paperui.html": {
        body: '<meta http-equiv="refresh" content="0; url=/docs/paperui/">',
        type: "text/html",
    },
    "/paperapi.html": {
        body: '<meta http-equiv="refresh" content="0; url=/docs/paperapi/">',
        type: "text/html",
    },
    "/docs/index.html": {
        body: '<!doctype html><title>PaperDocs</title><div id="docs-root"></div>',
        type: "text/html",
    },
    "/docs/paperapi/index.html": {
        body: '<!doctype html><title>Overview | Paperboard Docs</title><div id="docs-root"></div>',
        type: "text/html",
    },
    "/docs/paperapi/overview/index.html": {
        body: '<!doctype html><title>Overview | Paperboard Docs</title><div id="docs-root"></div>',
        type: "text/html",
    },
    "/assets/docs-abc.js": { body: "console.log(1)", type: "text/javascript" },
    "/404": {
        body: '<!doctype html><title>Page not found</title><div id="docs-root"></div>',
        type: "text/html",
    },
    "/docslike.txt": { body: "static", type: "text/plain" },
};

function createAssets() {
    return {
        async fetch(request: Request): Promise<Response> {
            const url = new URL(request.url);
            const pathname = url.pathname;

            // The real asset server canonicalizes an explicit .html request to
            // the extensionless path with a 307, so a worker that asks for
            // /404.html gets an empty redirect body instead of the document.
            if (pathname.endsWith(".html")) {
                const target = new URL(url);
                target.pathname = pathname.slice(0, -".html".length);
                return new Response(null, {
                    status: 307,
                    headers: { location: target.pathname },
                });
            }

            // A directory request maps to its index file, and an extensionless
            // request maps to its .html file.
            const resolved = pathname.endsWith("/")
                ? `${pathname}index.html`
                : pathname;
            const file = FILES[resolved] ?? FILES[`${resolved}.html`];
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
    test("serves the landing at the root, not the docs app", async () => {
        const res = await get("/");
        expect(res.status).toBe(200);
        expect(await res.text()).toContain("Paperboard");
    });

    test("serves the paperui alias as a static meta redirect", async () => {
        const res = await get("/paperui");
        expect(res.status).toBe(200);
        const body = await res.text();
        expect(body).toContain('http-equiv="refresh"');
        expect(body).toContain("/docs/paperui/");
    });

    test("serves the paperapi alias as a static meta redirect", async () => {
        const res = await get("/paperapi");
        expect(res.status).toBe(200);
        expect(await res.text()).toContain("/docs/paperapi/");
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

    test("serves the docs landing as a static file", async () => {
        const res = await get("/docs/");
        expect(res.status).toBe(200);
        expect(await res.text()).toContain("PaperDocs");
    });

    test("serves a docs section root as a static file", async () => {
        const res = await get("/docs/paperapi/");
        expect(res.status).toBe(200);
        expect(await res.text()).toContain("Overview");
    });

    test("serves a docs page as a static file, no shell fallback", async () => {
        const res = await get("/docs/paperapi/overview/");
        expect(res.status).toBe(200);
        expect(await res.text()).toContain("Overview");
    });

    test("a missing docs page gets the shared 404, not the docs app", async () => {
        const res = await get("/docs/paperapi/missing");
        expect(res.status).toBe(404);
        const body = await res.text();
        expect(body).toContain("Page not found");
        expect(body).not.toContain("<title>PaperDocs</title>");
    });

    test("a missing docs asset stays a 404, never the 404 page", async () => {
        const res = await get("/docs/assets/missing.js", "*/*");
        expect(res.status).toBe(404);
    });

    test("a missing root page serves the shared 404 document", async () => {
        const res = await get("/nope");
        expect(res.status).toBe(404);
        expect(await res.text()).toContain("Page not found");
    });

    test("a missing asset is not answered with the 404 document", async () => {
        const res = await get("/nope.css", "*/*");
        expect(res.status).toBe(404);
        expect(await res.text()).not.toContain("docs-root");
    });

    test("a static file sharing the docs prefix is not captured", async () => {
        const res = await get("/docslike.txt", "*/*");
        expect(res.status).toBe(200);
        expect(await res.text()).toBe("static");
    });
});
