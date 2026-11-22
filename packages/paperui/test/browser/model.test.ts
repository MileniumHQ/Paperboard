// @vitest-environment node
import { describe, expect, test } from "vitest";
import { type Page, useBrowser } from "./support/browser";

const browser = useBrowser();
let page: Page;

const ALERT = '[role="alert"]';
const MODELS = "/files/models";
// a panel's policy, and no entrance, so a model is drawn as soon as it's shown
const PANEL = "csp=panel&motion=reduced";

const alertText = () => page.eval<string | null>(`document.querySelector('${ALERT}')?.textContent ?? null`);
const hasButton = (label: string, root = "body") => page.eval<boolean>(`Boolean(document.querySelector(${JSON.stringify(`${root} button[aria-label="${label}"]`)}))`);
/** the viewer in `root` has shown its model: nothing loading, nothing failed, the controls up */
const shown = (root = "#box") =>
    page.waitFor(
        `document.querySelector('${root} [aria-busy="false"]') && !document.querySelector('${root} ${ALERT}') && document.querySelector('${root} [role="toolbar"]')`,
        "the model to show",
    );
const failed = () => page.waitFor(`document.querySelector('${ALERT}')`, "the failure to show");

/**
 * What the canvas in `root` shows on screen, from a screenshot of it: the
 * share of its pixels unlike its corner (the surface behind the model), and
 * their mean color.
 */
async function drawn(root = "#box") {
    await page.frames();
    const clip = await page.eval<{ x: number; y: number; width: number; height: number }>(`(() => {
        const r = document.querySelector('${root} canvas').getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
    })()`);
    const { data } = await page.send<{ data: string }>("Page.captureScreenshot", { format: "png", clip: { ...clip, scale: 1 } });
    return page.eval<{ share: number; color: [number, number, number] }>(`(async () => {
        const image = new Image();
        image.src = "data:image/png;base64,${data}";
        await image.decode();
        const canvas = new OffscreenCanvas(image.width, image.height);
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0);
        const px = context.getImageData(0, 0, image.width, image.height).data;
        const bg = [px[0], px[1], px[2]];
        let count = 0;
        const sum = [0, 0, 0];
        for (let i = 0; i < px.length; i += 4) {
            if (Math.abs(px[i] - bg[0]) + Math.abs(px[i + 1] - bg[1]) + Math.abs(px[i + 2] - bg[2]) <= 30) continue;
            count++;
            sum[0] += px[i]; sum[1] += px[i + 1]; sum[2] += px[i + 2];
        }
        return { share: count / (px.length / 4), color: sum.map((s) => Math.round(s / Math.max(count, 1))) };
    })()`);
}

const open = (src: string, query = PANEL) => browser.open("model", { query: `src=${encodeURIComponent(src)}&${query}` });

// Inventory: Content, files and console — Previews show what's in a file (PaperModel).
describe("PaperModel draws", () => {
    test.each([
        ["a GLB", "cube.glb"],
        ["a glTF with a texture beside it", "textured.gltf"],
        ["an animated GLB", "spin.glb"],
        ["a Draco-compressed GLB, decoded without WebAssembly under a panel's policy", "draco.glb"],
        ["a huge model far from the origin", "far.glb"],
        ["an ASCII STL", "block.stl"],
        ["an OBJ without materials", "ico.obj"],
        ["a PLY with vertex colors", "cylinder.ply"],
        ["a 3MF", "plate.3mf"],
        ["a Collada file", "box.dae"],
        ["a USDZ", "box.usdz"],
    ])("%s", async (_, file) => {
        page = await open(`${MODELS}/${file}`);
        await shown();
        const { share } = await drawn();
        // fitted to the view: the model fills a good part of it, and none of it is cut off
        expect(share).toBeGreaterThan(0.05);
        expect(share).toBeLessThan(0.9);
        expect(await page.eval("t.errors")).toEqual([]);
    });

    // a panel's policy refuses WebAssembly (no 'wasm-unsafe-eval'): these decoders run only on a page that allows it
    test.each([
        ["a Meshopt-compressed GLB", "meshopt.glb"],
        ["a Draco-compressed GLB, decoded in WebAssembly", "draco.glb"],
    ])("%s, where WebAssembly may run", async (_, file) => {
        page = await open(`${MODELS}/${file}`, "motion=reduced");
        await shown();
        expect((await drawn()).share).toBeGreaterThan(0.05);
        expect(await page.eval<string[]>("t.requests")).toContainEqual(expect.stringMatching(file === "draco.glb" ? /draco_decoder-[\w-]+\.wasm$/ : /meshopt\.glb$/));
    });

    test("a texture on the model's own origin is loaded, through an <img>", async () => {
        page = await open(`${MODELS}/textured.gltf`);
        await shown();
        expect(await page.eval<string[]>("t.requests")).toContainEqual(expect.stringMatching(/\/files\/models\/checker\.png$/));
    });

    test("a blob: URL with a format draws", async () => {
        page = await browser.open("model", { query: `${PANEL}&format=stl` });
        await page.eval(`fetch("${MODELS}/block.stl").then((r) => r.blob()).then((b) => t.setSrc(URL.createObjectURL(b)))`);
        await shown();
        expect((await drawn()).share).toBeGreaterThan(0.05);
    });
});

describe("PaperModel refuses what a file reaches for", () => {
    test("a texture on another site is never requested, and the model shows without it", async () => {
        page = await open(`${MODELS}/external.gltf`);
        await shown();
        expect(await page.eval<string[]>("t.requests")).not.toContainEqual(expect.stringContaining("example.com"));
        expect((await drawn()).share).toBeGreaterThan(0.05);
        expect(await page.eval("t.errors")).toEqual([]);
    });

    test("geometry on another site fails the model, unrequested", async () => {
        page = await open(`${MODELS}/external-buffer.gltf`);
        await failed();
        expect(await alertText()).toContain("on another site");
        expect(await page.eval<string[]>("t.requests")).not.toContainEqual(expect.stringContaining("example.com"));
        expect(await page.eval<string[]>("t.errors")).toHaveLength(1);
    });
});

describe("PaperModel failures", () => {
    test("a corrupt file is said in place and reported, with no Retry", async () => {
        page = await open(`${MODELS}/corrupt.glb`);
        await failed();
        expect(await alertText()).toContain("Can't read this 3D model");
        expect(await page.eval("t.errors")).toEqual(["Can't read this 3D model"]);
        expect(await page.eval(`[...document.querySelectorAll('${ALERT} button')].length`)).toBe(0);
    });

    test("a missing file offers Retry", async () => {
        page = await open(`${MODELS}/gone.glb`);
        await failed();
        expect(await alertText()).toContain("The model isn't there anymore");
        expect(await page.eval(`[...document.querySelectorAll('${ALERT} button')].some((b) => b.textContent.includes("Retry"))`)).toBe(true);
    });

    test("a file of no format it knows fails before anything loads", async () => {
        page = await open("/files/notes.md");
        await failed();
        expect(await alertText()).toContain("Can't tell which kind of 3D file this is");
        expect(await page.eval("t.errors")).toEqual(["Can't tell which kind of 3D file this is"]);
    });

    test("a lost WebGL context is said in place, and Retry brings the view back", async () => {
        page = await open(`${MODELS}/cube.glb`);
        await shown();
        await page.eval(`document.querySelector("#box canvas").getContext("webgl2").getExtension("WEBGL_lose_context").loseContext()`);
        await failed();
        expect(await alertText()).toContain("The 3D view stopped");
        await page.eval(`[...document.querySelectorAll('${ALERT} button')].find((b) => b.textContent.includes("Retry")).click()`);
        await shown();
        expect((await drawn()).share).toBeGreaterThan(0.05);
        expect(await page.eval("document.querySelectorAll('#box canvas').length")).toBe(1);
    });
});

describe("PaperModel replaces and lets go", () => {
    test("a new src replaces the model, and an older answer never lands", async () => {
        page = await open(`${MODELS}/cube.glb`);
        await shown();
        const red = await drawn();
        expect(red.color[0] - red.color[1]).toBeGreaterThan(40);

        // a slower file, then at once a different one: only the last shows
        await page.eval(`t.setSrc("${MODELS}/far.glb"); t.setSrc("${MODELS}/block.stl")`);
        await shown();
        await page.frames();
        const gray = await drawn();
        expect(Math.abs(gray.color[0] - gray.color[1])).toBeLessThan(20);
        expect(await page.eval("document.querySelectorAll('#box canvas').length")).toBe(1);
        expect(await page.eval("t.errors")).toEqual([]);
    });

    // Chrome keeps 16 WebGL contexts and loses the oldest for a 17th: had
    // the passing viewers kept theirs, the 17th would take the kept one's.
    // Every mount builds its viewer's lighting (a PMREM), which a GPU does in
    // a few milliseconds but these suites' software renderer (--disable-gpu)
    // in about 0.75 s here and 2.5 s on a CI runner; letting go takes 2 ms.
    // The kept viewer and sixteen that pass are the fewest that prove it,
    // and they need longer than the suites' usual 30 s on CI.
    test("a viewer that goes gives its WebGL context back at once", { timeout: 90_000 }, async () => {
        page = await browser.open("modelMany", { query: PANEL });
        await shown("#kept");
        const lost: boolean[] = [];
        for (let i = 0; i < 16; i++) {
            await page.eval("t.setShown(true)");
            await page.waitFor(`document.querySelector("#passing canvas")`, "the second viewer's canvas");
            await page.eval(`window.passing = document.querySelector("#passing canvas"); t.setShown(false)`);
            lost.push(await page.eval<boolean>(`window.passing.getContext("webgl2").isContextLost()`));
        }
        expect(lost.every(Boolean)).toBe(true);
        // had the others stayed, this one would be the oldest, and lost
        expect(await page.eval(`document.querySelector("#kept canvas").getContext("webgl2").isContextLost()`)).toBe(false);
        expect(await page.eval(`document.querySelector('#kept ${ALERT}')`)).toBe(null);
        expect(await page.eval("t.errors")).toEqual([]);
        expect((await drawn("#kept")).share).toBeGreaterThan(0.05);
    });
});

describe("PaperModel draws on demand", () => {
    test("a model at rest draws nothing more", async () => {
        page = await open(`${MODELS}/cube.glb`);
        await shown();
        await page.frames();
        const before = await page.eval<number>("t.draws()");
        for (let i = 0; i < 5; i++) await page.frames();
        expect(await page.eval<number>("t.draws()")).toBe(before);
    });

    test("an animated model plays until paused", async () => {
        page = await open(`${MODELS}/spin.glb`);
        await shown();
        expect(await hasButton("Pause")).toBe(true);
        const playing = await page.eval<number>("t.draws()");
        await page.frames();
        expect(await page.eval<number>("t.draws()")).toBeGreaterThan(playing);

        await page.click('button[aria-label="Pause"]');
        expect(await hasButton("Play")).toBe(true);
        await page.frames();
        const paused = await page.eval<number>("t.draws()");
        for (let i = 0; i < 5; i++) await page.frames();
        expect(await page.eval<number>("t.draws()")).toBe(paused);
    });

    test("Reset view puts the camera back after a drag", async () => {
        page = await open(`${MODELS}/block.stl`);
        await shown();
        const home = await drawn();
        const center = await page.center("#box canvas");
        await page.mouse("mouseMoved", center);
        await page.mouse("mousePressed", center);
        for (let i = 1; i <= 8; i++) await page.mouse("mouseMoved", { x: center.x + i * 20, y: center.y + i * 6 });
        await page.mouse("mouseReleased", { x: center.x + 160, y: center.y + 48 });
        const turned = await drawn();
        expect(Math.abs(turned.share - home.share)).toBeGreaterThan(0.005);

        await page.click('button[aria-label="Reset view"]');
        for (let i = 0; i < 3; i++) await page.frames();
        const back = await drawn();
        expect(Math.abs(back.share - home.share)).toBeLessThan(0.002);
    });
});

describe("renderModelThumbnail", () => {
    test("draws a square PNG with a transparent background, every one on one shared context", async () => {
        page = await browser.open("modelThumbnails", { query: "csp=panel" });
        const [cube, block, ico] = await Promise.all([
            page.eval<Record<string, number | string>>(`t.thumb("${MODELS}/cube.glb", "glb", 96)`),
            page.eval<Record<string, number | string>>(`t.thumb("${MODELS}/block.stl", "stl", 128)`),
            page.eval<Record<string, number | string>>(`t.thumb("${MODELS}/ico.obj", "obj", 64)`),
        ]);
        expect(cube).toMatchObject({ type: "image/png", width: 96, height: 96, corner: 0 });
        expect(block).toMatchObject({ type: "image/png", width: 128, height: 128, corner: 0 });
        expect(ico).toMatchObject({ type: "image/png", width: 64, height: 64, corner: 0 });
        for (const thumb of [cube, block, ico]) expect(thumb.opaque).toBeGreaterThan(0.05);
        expect(await page.eval("t.contexts()")).toBe(1);
    });

    test("an aborted request draws nothing and rejects as aborted", async () => {
        page = await browser.open("modelThumbnails", { query: "csp=panel" });
        const reason = await page.eval<string>(`t.thumb("${MODELS}/cube.glb", "glb", 64, true).then(() => "drawn", (err) => err.name)`);
        expect(reason).toBe("AbortError");
        expect(await page.eval<string[]>("t.requests")).not.toContainEqual(expect.stringContaining("cube.glb"));
    });

    test("a corrupt model rejects with the reason PaperModel shows", async () => {
        page = await browser.open("modelThumbnails", { query: "csp=panel" });
        const reason = await page.eval<string>(`t.thumb("${MODELS}/corrupt.glb", "glb", 64).then(() => "drawn", (err) => err.message)`);
        expect(reason).toBe("Can't read this 3D model");
    });
});
