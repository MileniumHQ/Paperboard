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
// `window.mediaAnswer` returns; with `?hold=1` they wait until the test
// answers them with `window.answerMedia["<id>:<full>"]`. With `?late=1` it
// answers the hello only when the test calls `window.connect()`. Installs wait until
// the test answers them with `window.answerInstall`. Everything the library
// sent is kept.
const SHELL = `<!doctype html><html><head><meta charset="utf-8"><title>shell</title>
<style>html, body { margin: 0; height: 100%; } iframe { position: fixed; inset: 0; width: 100%; height: 100%; border: 0; }</style></head>
<body><iframe id="library" src="/library/"></iframe><script>
const query = new URLSearchParams(location.search);
const installed = JSON.parse(query.get("installed") || "[]");
window.sent = [];
window.answerMedia = {};
window.mediaAnswer = () => (query.get("hold") ? null : { ok: false, error: "Can't read store/ (EACCES)" });
addEventListener("message", (event) => {
    const message = event.data;
    window.sent.push(message);
    // a DOM change, so a test waiting on what was sent wakes up
    document.body.dataset.sent = String(window.sent.length);
    const reply = (answer) => event.source.postMessage(answer, "*");
    if (message.type === "paperboard:library-hello") {
        window.connect = () => reply({ type: "paperboard:library-connected", theme: "light", installed });
        if (!query.get("late")) window.connect();
    }
    if (message.type === "paperboard:library-install") window.answerInstall = Object.assign(window.answerInstall || {}, { [message.panelId]: (answer) => reply({ type: "paperboard:library-install-result", requestId: message.requestId, panelId: message.panelId, ...answer }) });
    if (message.type === "paperboard:library-media") {
        const answer = (media) => reply({ type: "paperboard:library-media-result", requestId: message.requestId, panelId: message.panelId, ...media });
        const media = window.mediaAnswer(message);
        if (media) answer(media);
        else window.answerMedia[message.panelId + ":" + message.full] = answer;
    }
});
</script></body></html>`;

let out: string;
let server: Server;
let origin: string;
let chrome: Chrome;
let registry: Record<string, unknown> = {};
// every archive the page asked the server for, and who waits for the next
const archiveRequests: string[] = [];
let onArchiveRequest: (() => void) | undefined;

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
        if (url.pathname.endsWith(".tar.gz") || url.pathname.endsWith("/download")) {
            archiveRequests.push(url.pathname);
            onArchiveRequest?.();
            return void res.writeHead(200, { "Content-Type": "application/gzip", "Content-Disposition": "attachment" }).end();
        }
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

    test("screenshots that arrive while the gallery is open can be stepped through", async () => {
        const installed = [{ id: "dev.local.shots", name: "Shots", version: "0.1.0" }];
        const page = await chrome.open(`${origin}/shell.html?hold=1&installed=${encodeURIComponent(JSON.stringify(installed))}`);
        const doc = FRAMED_DOC;
        const PIXEL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
        const shots = (count: number) => ({ ok: true, store: { screenshots: Array.from({ length: count }, (_, i) => ({ light: PIXEL, alt: `Shot ${i + 1}` })) } });
        const gallery = (count: number) => `doc.querySelectorAll("[aria-label=Screenshots] img").length === ${count}`;
        const next = `doc.querySelector("[aria-label='Next screenshot']")`;

        // the grid's light read brings one screenshot; the page's full read is held
        await until(page, doc, `Boolean(window.answerMedia["dev.local.shots:false"])`, "the grid's media request");
        await page.evaluate(`window.answerMedia["dev.local.shots:false"](${JSON.stringify(shots(1))}); true`);
        await press(page, doc, card("Shots"), "the Shots card");
        await until(page, doc, `${gallery(1)} && ${next}.disabled && Boolean(window.answerMedia["dev.local.shots:true"])`, "one screenshot, nothing after it");

        // the full listing lands on the open gallery: there is now more to see
        await page.evaluate(`window.answerMedia["dev.local.shots:true"](${JSON.stringify(shots(3))}); true`);
        await until(page, doc, `${gallery(3)} && !${next}.disabled`, "Next enabled for the new screenshots");
        expect(page.exceptions).toEqual([]);
    }, 30_000);

    test("a shell that answers after the handshake timed out still hears that the library is ready", async () => {
        registry = { "dev.example.alpha": { id: "dev.example.alpha", name: "Alpha", version: "1.0.0" } };
        try {
            const page = await chrome.open(`${origin}/shell.html?late=1`);
            const doc = FRAMED_DOC;
            const readies = `window.sent.filter((m) => m.type === "paperboard:library-ready").length`;
            // unanswered, the library gives up on the shell and offers Download
            await press(page, doc, card("Alpha"), "the Alpha card");
            await until(page, doc, `Boolean(${button("Download")})`, "the standalone Download");
            // and the paint it waits on before a ready has settled, so the
            // shell answers after the library had its say as standalone
            await page.evaluate(`(async () => {
                const frame = document.getElementById("library").contentWindow;
                await frame.document.fonts.ready;
                await Promise.all([...frame.document.images].map((img) => img.decode().catch(() => undefined)));
                for (let i = 0; i < 3; i++) await new Promise((resolve) => frame.requestAnimationFrame(resolve));
                return true;
            })()`);
            expect(await page.evaluate<number>(readies)).toBe(0);

            // the shell was only slow: the library becomes embedded and says ready, once
            await page.evaluate(`window.connect(); true`);
            await until(page, doc, `Boolean(${button("Install")}) && ${readies} === 1`, "Install and the ready signal");
            expect(await page.evaluate<number>(readies)).toBe(1);
            expect(page.exceptions).toEqual([]);
        } finally {
            registry = {};
        }
    }, 30_000);

    test("Download outside Paperboard fetches the archive the registry hosts, never a record's own URL", async () => {
        // a legacy record that names an off-registry archive
        registry = { "dev.example.alpha": { id: "dev.example.alpha", name: "Alpha", version: "1.0.0", downloadUrl: `${origin}/elsewhere/alpha.tar.gz` } };
        archiveRequests.length = 0;
        try {
            const requested = new Promise<void>((resolve) => (onArchiveRequest = resolve));
            // opened directly, the library is standalone: Download, not Install
            const page = await chrome.open(`${origin}/library/`);
            const doc = "document";
            await press(page, doc, card("Alpha"), "the Alpha card");
            // the page's facts are a listing section like the others, never a hand-built strip
            const information = `doc.querySelector("section[aria-label=Information]")?.textContent`;
            await until(page, doc, `${information}?.includes("PublisherPublisher not provided") && ${information}.includes("Versionv1.0.0")`, "Alpha's information");
            await press(page, doc, button("Download"), "Alpha's Download");
            await requested;
            expect(archiveRequests).toEqual(["/panel/dev.example.alpha/download"]);
            expect(page.exceptions).toEqual([]);
        } finally {
            registry = {};
            onArchiveRequest = undefined;
        }
    }, 30_000);
});
