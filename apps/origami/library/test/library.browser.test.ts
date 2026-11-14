// @vitest-environment node
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { launchChrome, type Chrome, type Page } from "../../../../scripts/testing/chrome";

// The production build of the library in a real Chrome, embedded the way
// Paperboard embeds it. This loopback server is the registry
// (/panels/index.json, listing `registry`) and the shell (/shell.html, which frames /library/
// and answers it).
const LIBRARY = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const MIME: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".webp": "image/webp" };


// The shell: it frames the library, says it is Paperboard with the
// installed list from its query, and answers media requests with what
// `window.mediaAnswer` returns. Installs wait until the test answers them
// with `window.answerInstall`. Everything the library sent is kept.
const SHELL = `<!doctype html><html><head><meta charset="utf-8"><title>shell</title>
<style>html, body { margin: 0; height: 100%; } iframe { position: fixed; inset: 0; width: 100%; height: 100%; border: 0; }</style></head>
<body><iframe id="library" src="/library/"></iframe><script>
const installed = JSON.parse(new URLSearchParams(location.search).get("installed") || "[]");
window.sent = [];
window.mediaAnswer = () => ({ ok: false, error: "Can't read store/ (EACCES)" });
addEventListener("message", (event) => {
    const message = event.data;
    window.sent.push(message);
    // a DOM change, so a test waiting on what was sent wakes up
    document.body.dataset.sent = String(window.sent.length);
    const reply = (answer) => event.source.postMessage(answer, "*");
    if (message.type === "paperboard:library-hello") reply({ type: "paperboard:library-connected", theme: "light", installed });
    if (message.type === "paperboard:library-install") window.answerInstall = Object.assign(window.answerInstall || {}, { [message.panelId]: (answer) => reply({ type: "paperboard:library-install-result", requestId: message.requestId, panelId: message.panelId, ...answer }) });
    if (message.type === "paperboard:library-media") reply({ type: "paperboard:library-media-result", requestId: message.requestId, panelId: message.panelId, ...window.mediaAnswer(message) });
});
</script></body></html>`;

let out: string;
let server: Server;
let origin: string;
let chrome: Chrome;
let registry: Record<string, unknown> = {};

beforeAll(async () => {
    out = await mkdtemp(path.join(tmpdir(), "library-build-"));
    await build({
        configFile: path.join(LIBRARY, "vite.config.ts"),
        root: LIBRARY,
        logLevel: "error",
        build: { outDir: out, emptyOutDir: true, minify: false, reportCompressedSize: false },
    });
    server = createServer((req, res) => {
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        if (url.pathname === "/shell.html") return void res.writeHead(200, { "Content-Type": MIME[".html"] }).end(SHELL);
        if (url.pathname === "/panels/index.json") return void res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(registry));
        if (!url.pathname.startsWith("/library/")) return void res.writeHead(404).end();
        const file = url.pathname === "/library/" ? "index.html" : url.pathname.slice("/library/".length);
        const target = path.resolve(out, file);
        if (!target.startsWith(out + path.sep)) return void res.writeHead(403).end();
        readFile(target).then(
            (body) => res.writeHead(200, { "Content-Type": MIME[path.extname(target)] ?? "application/octet-stream" }).end(body),
            (err: NodeJS.ErrnoException) => res.writeHead(err.code === "ENOENT" ? 404 : 500).end(String(err.code)),
        );
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    chrome = await launchChrome({ args: ["--no-sandbox", "--disable-gpu", "--disable-extensions"] });
}, 60_000);

afterAll(async () => {
    await chrome?.close();
    server?.closeAllConnections();
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    if (out) await rm(out, { recursive: true, force: true });
});

// the document the library runs in: the shell's frame
const FRAMED_DOC = "document.getElementById('library')?.contentDocument";

/**
 * Resolves once `predicate` (an expression over `doc`) holds, checked on
 * every DOM change in the page and in the shell's frame, whose document
 * the observer follows across its load.
 */
function until(page: Page, doc: string, predicate: string, what: string): Promise<void> {
    return page.evaluate(`new Promise((resolve, reject) => {
        const observers = [];
        const stop = () => { for (const o of observers.splice(0)) o.disconnect(); clearTimeout(timer); };
        const check = () => {
            let ready = false;
            try { const doc = ${doc}; ready = Boolean(doc && (${predicate})); } catch (err) { stop(); reject(err); return; }
            if (ready) { stop(); resolve(true); }
        };
        const watch = (target) => {
            const observer = new MutationObserver(check);
            observer.observe(target, { subtree: true, childList: true, attributes: true, characterData: true });
            observers.push(observer);
        };
        watch(document);
        const frame = document.getElementById("library");
        if (frame) {
            if (frame.contentDocument) watch(frame.contentDocument);
            frame.addEventListener("load", () => { watch(frame.contentDocument); check(); });
        }
        const timer = setTimeout(() => {
            stop();
            const doc = ${doc};
            reject(new Error(${JSON.stringify(`Timed out waiting for ${what}`)} + "; the library shows: " + (doc?.body?.textContent ?? "").slice(0, 2000)));
        }, 20000);
        check();
    })`).then(() => undefined);
}

/** the element the expression finds in `doc`, pressed at its centre with the mouse (the frame fills the page) */
async function press(page: Page, doc: string, element: string, what: string): Promise<void> {
    await until(page, doc, element, what);
    const box = await page.evaluate<{ x: number; y: number }>(`(() => {
        const doc = ${doc};
        const el = ${element};
        el.scrollIntoView({ block: "center" });
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    for (const type of ["mousePressed", "mouseReleased"]) {
        await page.send("Input.dispatchMouseEvent", { type, x: box.x, y: box.y, button: "left", clickCount: 1 });
    }
}

const card = (name: string) => `[...doc.querySelectorAll("[role=button]")].find((el) => el.textContent.includes(${JSON.stringify(name)}))`;
const button = (label: string) => `[...doc.querySelectorAll("button, a")].find((el) => el.textContent.trim().endsWith(${JSON.stringify(label)}))`;
const installsSent = (ids: string[]) => `JSON.stringify(window.sent.filter((m) => m.type === "paperboard:library-install").map((m) => m.panelId)) === ${JSON.stringify(JSON.stringify(ids))}`;
const shows = (text: string) => `doc.body.textContent.includes(${JSON.stringify(text)})`;

describe("the library, as a person uses it", () => {
    test("a second panel installs while the first is still installing, and each page shows only its own failure", async () => {
        registry = {
            "dev.example.alpha": { id: "dev.example.alpha", name: "Alpha", version: "1.0.0", description: "First." },
            "dev.example.beta": { id: "dev.example.beta", name: "Beta", version: "1.0.0", description: "Second." },
        };
        try {
            const page = await chrome.open(`${origin}/shell.html`);
            const doc = FRAMED_DOC;
            const heading = (name: string) => `doc.querySelector("h1")?.textContent === ${JSON.stringify(name)}`;

            await press(page, doc, card("Alpha"), "the Alpha card");
            await until(page, doc, heading("Alpha"), "Alpha's page");
            await press(page, doc, button("Install"), "Alpha's Install");
            await until(page, doc, `${button("Installing…")} && ${installsSent(["dev.example.alpha"])}`, "Alpha installing");

            await press(page, doc, button("Library"), "the back button");
            await press(page, doc, card("Beta"), "the Beta card");
            await until(page, doc, heading("Beta"), "Beta's page");
            // Alpha's install is Alpha's: Beta's button is its own and works
            await press(page, doc, button("Install"), "Beta's Install");
            await until(page, doc, `${button("Installing…")} && ${installsSent(["dev.example.alpha", "dev.example.beta"])}`, "Beta installing");

            // Alpha failing while Beta's page is open says nothing on Beta's page
            await page.evaluate(`window.answerInstall["dev.example.alpha"]({ ok: false, error: "Disk full" }); true`);
            await press(page, doc, button("Library"), "the back button");
            await press(page, doc, card("Alpha"), "the Alpha card");
            await until(page, doc, `${heading("Alpha")} && doc.querySelector("[role=alert]")?.textContent === "Couldn't install Alpha: Disk full"`, "Alpha's failure on Alpha's page");
            await press(page, doc, button("Library"), "the back button");
            await press(page, doc, card("Beta"), "the Beta card");
            await until(page, doc, `${heading("Beta")} && Boolean(${button("Installing…")})`, "Beta still installing");
            expect(await page.evaluate<boolean>(`Boolean(${FRAMED_DOC}.querySelector("[role=alert]"))`)).toBe(false);
            expect(page.exceptions).toEqual([]);
        } finally {
            registry = {};
        }
    }, 30_000);

    test("an installed panel the registry doesn't list shows a glyph, and its page says why its listing failed and retries", async () => {
        const installed = [{ id: "dev.local.tool", name: "Local Tool", version: "0.1.0" }];
        const page = await chrome.open(`${origin}/shell.html?installed=${encodeURIComponent(JSON.stringify(installed))}`);
        const doc = FRAMED_DOC;

        // the fallback is a Material Symbols glyph, never the glyph's name as text
        await until(page, doc, card("Local Tool"), "the Local Tool card");
        const font = await page.evaluate<string | null>(`(() => {
            const doc = ${doc};
            const el = [...${card("Local Tool")}.querySelectorAll("*")].find((node) => node.children.length === 0 && node.textContent.trim() === "dashboard");
            return el ? getComputedStyle(el).fontFamily : null;
        })()`);
        expect(font).toMatch(/Material Symbols/);

        await press(page, doc, card("Local Tool"), "the Local Tool card");
        await until(page, doc, `doc.querySelector("[role=alert]")?.textContent.includes("Can't read store/ (EACCES)")`, "the media failure on the page");

        await page.evaluate(`window.mediaAnswer = () => ({ ok: true, store: { about: "Made on this computer." } }); true`);
        await press(page, doc, button("Retry"), "Retry");
        await until(page, doc, `${shows("Made on this computer.")} && !doc.querySelector("[role=alert]")`, "the panel's own listing");

        await press(page, doc, button("Library"), "the back button");
        await until(page, doc, `!doc.querySelector("h1") && Boolean(${card("Local Tool")})`, "the grid again");
        expect(page.exceptions).toEqual([]);
    }, 30_000);
});
