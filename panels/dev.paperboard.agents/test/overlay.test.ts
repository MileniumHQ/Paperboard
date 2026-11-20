// The look/zoom overlay is drawn into every page the agent screenshots. Pages that enforce Trusted Types
// (Google sign-in, Gmail) reject HTML strings, and a throwing overlay fails the whole screenshot.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { openChrome, type Page } from "testkit/chrome";
import { REMOVE_OVERLAY_JS, overlayJs } from "../src/service/pageScripts";
import { allowTestPort } from "./hermetic";

let server: ReturnType<typeof Bun.serve>;
let chrome: Page;
const disallow: (() => void)[] = [];

beforeAll(async () => {
    server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        fetch: () =>
            new Response("<!doctype html><title>Strict</title><body><p>Sign in</p></body>", {
                headers: { "content-type": "text/html", "content-security-policy": "require-trusted-types-for 'script'" },
            }),
    });
    chrome = await openChrome(`http://127.0.0.1:${server.port}/`, { onPort: (port) => disallow.push(allowTestPort(port)) });
});

afterAll(async () => {
    await chrome?.close();
    for (const undo of disallow) undo();
    server?.stop(true);
});

/** The colour a screenshot shows at one CSS pixel, decoded in the page (the test page allows data: images). */
async function pixel(x: number, y: number): Promise<number[]> {
    const { data } = await chrome.send<{ data: string }>("Page.captureScreenshot", { format: "png", clip: { x, y, width: 1, height: 1, scale: 1 } });
    return chrome.evaluate<number[]>(`(async () => {
  const bitmap = await createImageBitmap(await (await fetch('data:image/png;base64,${data}')).blob());
  const ctx = new OffscreenCanvas(1, 1).getContext('2d');
  ctx.drawImage(bitmap, 0, 0);
  return Array.from(ctx.getImageData(0, 0, 1, 1).data.slice(0, 3));
})()`);
}

describe("screenshot overlay", () => {
    test("draws boxes, labels and a grid on a page that enforces Trusted Types, and comes off again", async () => {
        expect(await chrome.evaluate<boolean>(`(() => { let refused = false; try { document.body.innerHTML = '<b></b>'; } catch { refused = true; } return refused; })()`)).toBe(true);
        const js = overlayJs({
            boxes: [
                { x: 10, y: 40, w: 100, h: 30, label: "1" },
                { x: 20, y: 5, w: 50, h: 20, label: "<img src=x onerror=alert(1)>2" },
            ],
            grid: { x: 0, y: 0, w: 200, h: 200, step: 50, scale: 2 },
        });
        expect(await chrome.evaluate<boolean>(js)).toBe(true);
        expect(await chrome.evaluate<number>(`document.querySelectorAll('#paperboard-agent-overlay').length`)).toBe(1);
        // the first box's left border is on screen, in the palette's first colour (#e63946)
        expect(await pixel(10, 55)).toEqual([230, 57, 70]);
        // drawing again replaces the overlay, it doesn't stack a second one
        expect(await chrome.evaluate<boolean>(js)).toBe(true);
        expect(await chrome.evaluate<number>(`document.querySelectorAll('#paperboard-agent-overlay').length`)).toBe(1);
        expect(await chrome.evaluate<boolean>(REMOVE_OVERLAY_JS)).toBe(true);
        expect(await chrome.evaluate<number>(`document.querySelectorAll('#paperboard-agent-overlay').length`)).toBe(0);
    });
});
