// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { readFile } from "node:fs/promises";
import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { launchChrome, type Chrome, type Tab } from "./helpers/chrome";

// The real paintReady module, served to a real Chrome. Images come from
// this loopback server: one is held until the test releases it, one is
// bytes no browser can decode, and one never answers.
const PAINT_READY = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../../packages/paperapi/src/paintReady.ts");
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
const LONG = 10 * 60_000;

let server: Server;
let origin: string;
let chrome: Chrome;
let moduleJs: string;
const hanging = new Set<ServerResponse>();
const held: { res: ServerResponse; url: string }[] = [];
let heldArrived: ((url: string) => void) | undefined;
const imageRequests: string[] = [];

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>paint</title></head><body>
<script type="module">
import { waitForContentPainted } from "/paintReady.js";
window.waitForContentPainted = waitForContentPainted;
window.moduleReady = true;
</script></body></html>`;

beforeAll(async () => {
    moduleJs = ts.transpileModule(await readFile(PAINT_READY, "utf8"), {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    server = createServer((req, res) => {
        const url = req.url ?? "/";
        if (url === "/") return void res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(PAGE);
        if (url === "/paintReady.js") return void res.writeHead(200, { "Content-Type": "text/javascript" }).end(moduleJs);
        if (url.startsWith("/img/")) imageRequests.push(url);
        if (url.startsWith("/img/held")) {
            held.push({ res, url });
            heldArrived?.(url);
            return;
        }
        if (url.startsWith("/img/broken")) return void res.writeHead(200, { "Content-Type": "image/png" }).end("these bytes are not a PNG");
        if (url.startsWith("/img/hang")) {
            hanging.add(res);
            return;
        }
        res.writeHead(404).end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    chrome = await launchChrome();
}, 60_000);

afterAll(async () => {
    await chrome?.close();
    for (const res of hanging) res.destroy();
    for (const { res } of held) res.destroy();
    server?.closeAllConnections();
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
});

beforeEach(() => {
    imageRequests.length = 0;
});

async function page(): Promise<Tab> {
    const tab = await chrome.open(`${origin}/`);
    // module scripts run before the load event, so by load the module is in or it failed
    await tab.evaluate(`new Promise((resolve, reject) => {
        const settle = () => window.moduleReady ? resolve(true) : reject(new Error("paintReady.js did not load"));
        if (window.moduleReady || document.readyState === "complete") settle();
        else window.addEventListener("load", settle, { once: true });
    })`);
    return tab;
}

// Readiness is signalled and never hangs.
describe("waitForContentPainted waits for images, and never hangs", () => {
    test("it waits for a non-lazy image, but not for an offscreen lazy one", async () => {
        const tab = await page();
        const arrived = new Promise<string>((resolve) => (heldArrived = resolve));
        await tab.evaluate(`(() => {
            document.body.insertAdjacentHTML("beforeend",
                '<img src="/img/held.png"><div style="height:20000px"></div><img loading="lazy" src="/img/hang.png?lazy">');
            window.painted = "pending";
            window.paint = window.waitForContentPainted({ timeoutMs: ${LONG} }).then(() => { window.painted = "done"; });
            return true;
        })()`);
        await arrived;
        expect(await tab.evaluate<string>("window.painted")).toBe("pending");
        const [image] = held.splice(0);
        image!.res.writeHead(200, { "Content-Type": "image/png" }).end(PNG);
        await tab.evaluate("window.paint.then(() => true)");
        expect(await tab.evaluate<string>("window.painted")).toBe("done");
        expect(await tab.evaluate<boolean>("document.querySelector('img').complete && document.querySelector('img').naturalWidth === 1")).toBe(true);
    }, 30_000);

    test("an image that fails to decode does not block it", async () => {
        const tab = await page();
        await tab.evaluate(`(() => { document.body.insertAdjacentHTML("beforeend", '<img src="/img/broken.png">'); return true; })()`);
        await tab.evaluate(`window.waitForContentPainted({ timeoutMs: ${LONG} }).then(() => true)`);
        expect(imageRequests).toContain("/img/broken.png");
        expect(await tab.evaluate<boolean>("document.querySelector('img').complete && document.querySelector('img').naturalWidth === 0")).toBe(true);
    }, 30_000);

    test("an image that never settles is bounded by the timeout", async () => {
        const tab = await page();
        await tab.evaluate(`(() => { document.body.insertAdjacentHTML("beforeend", '<img src="/img/hang.png?bounded">'); return true; })()`);
        expect(await tab.evaluate<boolean>("window.waitForContentPainted({ timeoutMs: 300 }).then(() => document.querySelector('img').complete)")).toBe(false);
        expect(imageRequests).toContain("/img/hang.png?bounded");
    }, 30_000);

    test("without decode() it resolves instead of waiting on images it cannot observe", async () => {
        const tab = await page();
        await tab.evaluate(`(() => {
            delete HTMLImageElement.prototype.decode;
            document.body.insertAdjacentHTML("beforeend", '<img src="/img/hang.png?nodecode">');
            return typeof HTMLImageElement.prototype.decode;
        })()`);
        await tab.evaluate(`window.waitForContentPainted({ timeoutMs: ${LONG} }).then(() => true)`);
        expect(await tab.evaluate<boolean>("document.querySelector('img').complete")).toBe(false);
    }, 30_000);
});
