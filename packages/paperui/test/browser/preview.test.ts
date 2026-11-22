// @vitest-environment node
import { describe, expect, test } from "vitest";
import { type Page, useBrowser } from "./support/browser";

const browser = useBrowser();
let page: Page;

// every page here runs under the panel's CSP, as a panel's preview does
const PANEL = { query: "csp=panel" };
const PREVIEW = "document.querySelector('[data-kind]')";

const show = (file: Record<string, unknown>) => page.eval(`t.show(${JSON.stringify(file)})`);

// Inventory: Templates — PaperPreview picks a viewer for a file and shows its failures in place.
describe("PaperPreview", () => {
    test("a picture fits, zooms from the keys, and goes back to fitted", async () => {
        page = await browser.open("preview", PANEL);
        const img = `document.querySelector('img[alt="photo.png"]')`;
        await page.waitFor(`${img}?.complete && ${img}.getBoundingClientRect().width > 0 && !${img}.className.includes("hidden")`, "the picture to load");
        // 800×500 fits a 800×600 box at its own size: never enlarged past it
        expect(await page.eval(`Math.round(${img}.getBoundingClientRect().width)`)).toBe(800);
        const readout = `document.querySelector('[role="toolbar"] [aria-live]')?.textContent`;
        expect(await page.eval(readout)).toBe("100%");

        const key = (k: string) => page.eval(`document.querySelector('[aria-label="photo.png"][tabindex]').dispatchEvent(new KeyboardEvent("keydown", { key: ${JSON.stringify(k)}, bubbles: true }))`);
        await key("+");
        await page.waitFor(`${readout} === "125%"`, "a step in");
        await key("0");
        await page.waitFor(`${readout} === "100%"`, "back to fitted");
    });

    test("the zoom buttons over the picture take a real press", async () => {
        page = await browser.open("preview", PANEL);
        await page.waitFor(`document.querySelector('[aria-label="Zoom in"]')`, "the zoom controls");
        await page.click('[aria-label="Zoom in"]');
        await page.waitFor(`document.querySelector('[role="toolbar"] [aria-live]')?.textContent === "125%"`, "a step in from the button");
    });

    test("markdown, code, a table and a font each get their own viewer", async () => {
        page = await browser.open("preview", PANEL);
        await show({ name: "notes.md", src: "/files/notes.md" });
        await page.waitFor(`[...document.querySelectorAll("h1")].some((h) => h.textContent === "Release notes")`, "the markdown's heading");

        await show({ name: "greet.ts", src: "/files/greet.ts", type: "application/octet-stream" });
        await page.waitFor(`document.querySelector("code")?.textContent.includes("export function greet")`, "the code");
        expect(await page.eval(`${PREVIEW}.dataset.kind`)).toBe("code");

        await show({ name: "table.csv", src: "/files/table.csv" });
        await page.waitFor(`document.querySelectorAll("tbody tr").length === 2`, "the table's two rows");
        expect(await page.eval(`[...document.querySelectorAll("thead th")].map((c) => c.textContent)`)).toEqual(["Name", "City", "Note"]);
        // a quoted cell keeps its comma and its line break
        expect(await page.eval(`[...document.querySelectorAll("tbody tr:first-child td")].map((c) => c.textContent)`)).toEqual(["Ada", "London, UK", "first\nline"]);

        await show({ name: "sample.woff2", src: "/files/sample.woff2" });
        await page.waitFor(`[...document.querySelectorAll("*")].some((e) => e.children.length === 0 && e.textContent === "Aa" && getComputedStyle(e).fontFamily.includes("paper-preview-"))`, "the font's specimen in its own face");
        expect(await page.eval("t.errors")).toEqual([]);
    });

    test("a file with no viewer is a card that says what it is", async () => {
        page = await browser.open("preview", PANEL);
        await show({ name: "archive.zip", src: "/files/archive.zip", size: 1200 });
        await page.waitFor(`${PREVIEW}.dataset.kind === "file"`, "the card");
        const text = await page.eval<string>(`${PREVIEW}.innerText`);
        expect(text).toContain("archive.zip");
        expect(text).toContain("ZIP file · 1.2 KB");
    });

    test("a file that can't be read says why, in place and to onError", async () => {
        page = await browser.open("preview", PANEL);
        await show({ name: "gone.md", src: "/files/gone.md" });
        await page.waitFor(`document.querySelector('[role="alert"]')?.innerText.includes("gone.md couldn't be read (404)")`, "the failure");
        expect(await page.eval("t.errors")).toEqual(["gone.md couldn't be read (404)"]);

        await show({ name: "photo.png", src: "/files/photo.png", error: "photo.png couldn't be downloaded" });
        await page.waitFor(`document.querySelector('[role="alert"]')?.innerText.includes("couldn't be downloaded")`, "the host's error");
        expect(await page.eval(`Boolean(document.querySelector('img[alt="photo.png"]'))`)).toBe(false);
    });

    test("a long text shows its first megabyte and says so", async () => {
        page = await browser.open("preview", PANEL);
        await page.eval(`t.show({ name: "server.log", src: t.longText() })`);
        await page.waitFor(`document.body.innerText.includes("Showing the first 1 MB.")`, "the cut note");
        const chars = await page.eval<number>(`document.querySelector("code").textContent.length`);
        expect(chars).toBe(1024 * 1024);
    });

    test("a newer file wins over an older one still loading", async () => {
        page = await browser.open("preview", PANEL);
        await page.eval(`(() => { t.show({ name: "server.log", src: t.longText() }); t.show({ name: "notes.md", src: "/files/notes.md" }); })()`);
        await page.waitFor(`[...document.querySelectorAll("h1")].some((h) => h.textContent === "Release notes")`, "the newer file");
        await page.frames();
        expect(await page.eval(`document.body.innerText.includes("line of a long log")`)).toBe(false);
    });
});

// Inventory: Templates — PaperPreviewModal shows a file over the page.
describe("PaperPreviewModal", () => {
    test("it rises in, shows the file under its name and actions, and Close closes it", async () => {
        page = await browser.open("previewModal", PANEL);
        await page.eval("t.open()");
        await page.waitFor(`document.querySelector('[role="dialog"]')?.getAttribute("aria-label") === "notes.md"`, "the dialog");
        // the way in is PaperModal's: the dialog is animating as it opens
        expect(await page.eval(`document.getAnimations().length > 0`)).toBe(true);
        await page.waitFor(`[...document.querySelectorAll('[role="dialog"] h1')].some((h) => h.textContent === "Release notes")`, "the markdown inside");
        const buttons = await page.eval<string[]>(`[...document.querySelectorAll('[role="dialog"] button')].map((b) => b.innerText.trim())`);
        expect(buttons.some((b) => b.endsWith("Save"))).toBe(true);
        await page.eval(`[...document.querySelectorAll('[role="dialog"] button')].find((b) => b.innerText.trim().endsWith("Close")).id = "close"`);
        await page.click("#close");
        expect(await page.eval("t.closes")).toBe(1);
    });

    test("text dragged out of a sheet is a selection, not a press that closes", async () => {
        page = await browser.open("previewModal", PANEL);
        await page.eval("t.open()");
        await page.waitFor(`[...document.querySelectorAll('[role="dialog"] h1')].some((h) => h.textContent === "Release notes")`, "the markdown");
        await page.waitFor(`document.getAnimations().every((a) => a.playState !== "running")`, "the dialog to come to rest");
        const from = await page.center('[role="dialog"] h1');
        const corner = await page.eval<{ x: number; y: number }>(`(() => { const r = document.querySelector('[role="dialog"] [data-kind]').getBoundingClientRect(); return { x: r.left + 2, y: r.bottom - 2 }; })()`);
        await page.mouse("mousePressed", from);
        // a drag: the button stays down as the pointer leaves the sheet
        for (const step of [0.25, 0.5, 0.75, 1]) {
            const x = from.x + (corner.x - from.x) * step;
            const y = from.y + (corner.y - from.y) * step;
            await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "left", buttons: 1 });
        }
        await page.mouse("mouseReleased", corner);
        await page.frames();
        expect(await page.eval("t.closes")).toBe(0);
        expect(await page.eval(`document.getSelection().toString().length > 0`)).toBe(true);
    });

    test("it keeps showing the file while it leaves, though the host forgets it", async () => {
        page = await browser.open("previewModal", PANEL);
        await page.eval("t.open()");
        await page.waitFor(`[...document.querySelectorAll('[role="dialog"] h1')].some((h) => h.textContent === "Release notes")`, "the markdown");
        const during = await page.eval<{ kind?: string; label: string | null }>(`(() => {
            t.closeAndClear();
            const dialog = document.querySelector('[role="dialog"]');
            return { kind: dialog.dataset.kind, label: dialog.getAttribute("aria-label") };
        })()`);
        expect(during).toEqual({ kind: "markdown", label: "notes.md" });
    });

    test("a press on the space around the file closes it", async () => {
        page = await browser.open("previewModal", PANEL);
        await page.eval(`t.open({ name: "tone.wav", src: "/audio/tone.wav" })`);
        await page.waitFor(`document.querySelector('[role="dialog"]')?.dataset.kind === "audio"`, "the player");
        await page.waitFor(`document.getAnimations().every((a) => a.playState !== "running")`, "the dialog to come to rest");
        // the corner of the preview, far from the player in its middle
        const corner = await page.eval<{ x: number; y: number }>(`(() => { const r = document.querySelector('[role="dialog"] [data-kind]').getBoundingClientRect(); return { x: r.left + 2, y: r.top + 2 }; })()`);
        await page.clickAt(corner);
        expect(await page.eval("t.closes")).toBe(1);
    });
});

// Inventory: Templates — thumbnails are small PNGs, made once and shared.
describe("paperPreviewThumbnail", () => {
    test("a picture's longer edge is the size asked for, and its shape is kept", async () => {
        page = await browser.open("previewThumbnail", PANEL);
        expect(await page.eval(`t.make({ src: "/files/photo.png", name: "photo.png" }, 160)`)).toEqual({ type: "image/png", width: 160, height: 100 });
        // never enlarged past its own size
        expect(await page.eval(`t.make({ src: "/files/photo.png", name: "photo.png" }, 4000)`)).toEqual({ type: "image/png", width: 800, height: 500 });
    });

    test("films, recordings, text, tables and fonts each draw one; a file with no picture has none", async () => {
        page = await browser.open("previewThumbnail", PANEL);
        const video = await page.eval<{ width: number; height: number }>(`t.make({ src: "/files/clip.webm", name: "clip.webm" }, 128)`);
        expect(video).toMatchObject({ type: "image/png", width: 128, height: 72 });
        expect(await page.eval(`t.make({ src: "/audio/tone.wav", name: "tone.wav" }, 64)`)).toEqual({ type: "image/png", width: 64, height: 64 });
        for (const [src, name] of [["/files/notes.md", "notes.md"], ["/files/greet.ts", "greet.ts"], ["/files/table.csv", "table.csv"], ["/files/sample.woff2", "sample.woff2"]]) {
            expect(await page.eval(`t.make({ src: ${JSON.stringify(src)}, name: ${JSON.stringify(name)} }, 128)`)).toEqual({ type: "image/png", width: 100, height: 128 });
        }
        expect(await page.eval(`t.make({ src: "/files/archive.zip", name: "archive.zip" }, 128)`)).toBe(null);
    });

    test("asking twice answers with the same picture; a caller that stops waiting is let go", async () => {
        page = await browser.open("previewThumbnail", PANEL);
        expect(await page.eval("t.same()")).toBe(true);
        expect(await page.eval("t.abort()")).toBe("AbortError");
        expect(await page.eval("t.failure()")).toContain("isn't a picture this browser can open");
    });

    test("PaperPreviewThumbnail shows the picture, a symbol for a file with none, and says when it fails", async () => {
        page = await browser.open("previewThumbnail", PANEL);
        await page.waitFor(`document.querySelector("#photo img")?.complete`, "the photo's thumbnail");
        expect(await page.eval(`document.querySelector("#photo img").src.startsWith("blob:")`)).toBe(true);
        expect(await page.eval(`document.querySelector("#zip").innerText.trim()`)).toBe("draft");
        await page.waitFor(`t.errors.length === 1`, "the broken one's error");
        expect(await page.eval(`document.querySelector("#broken").innerText.trim()`)).toBe("broken_image");
    });
});
