import { chromium } from "playwright";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { SHOTS } from "./renders/shots.mjs";

// Renders the landing's device images (public/renders/*.png) from the
// low-poly models in scripts/renders/models, with real panel screenshots on their
// screens. The landing ships these PNGs instead of running Three.js, so it
// looks the same on every browser, screen and GPU. Run after changing a model,
// a screenshot or a shot in scripts/renders/shots.mjs:
//   bun run renders           every shot
//   bun run renders -- hero   only the named shots

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "public", "renders");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".png": "image/png", ".glb": "model/gltf-binary" };

const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    const target = resolve(root, `.${path}`);
    if (!target.startsWith(`${root}${sep}`)) return res.writeHead(403).end();
    let data;
    try {
        data = await readFile(target);
    } catch {
        return res.writeHead(404).end();
    }
    res.writeHead(200, { "Content-Type": MIME[extname(target)] || "application/octet-stream" }).end(data);
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));

const only = process.argv.slice(2);
const shots = only.length ? SHOTS.filter((shot) => only.includes(shot.name)) : SHOTS;
if (!shots.length) throw new Error(`render: no shot named ${only.join(", ")}`);

const browser = await chromium.launch({
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
    args: ["--force-color-profile=srgb", "--enable-unsafe-swiftshader", "--use-angle=swiftshader"],
});
try {
    await mkdir(out, { recursive: true });
    const manifest = join(root, "src", "site", "landing", "renders.json");
    const sizes = JSON.parse(await readFile(manifest, "utf8").catch(() => "{}"));
    for (const shot of shots) {
        const page = await browser.newPage();
        const failures = [];
        page.on("pageerror", (error) => failures.push(error.message));
        page.on("response", (response) => { if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`); });
        await page.goto(`http://127.0.0.1:${server.address().port}/scripts/renders/stage.html`);
        await page.waitForFunction(() => window.studioReady === true);
        const data = await page.evaluate((spec) => window.renderShot(spec), shot);
        if (failures.length) throw new Error(`render: ${shot.name} failed: ${failures.join("; ")}`);
        // Trim to the model and its shadow, so the page lays out the device
        // itself rather than the studio frame around it.
        const { data: png, info } = await sharp(Buffer.from(data.split(",")[1], "base64"))
            .trim({ threshold: 0 })
            .png({ compressionLevel: 9 })
            .toBuffer({ resolveWithObject: true });
        if (info.width < shot.minWidth) {
            throw new Error(`render: ${shot.name} trims to ${info.width}px wide, under its ${shot.minWidth}px; widen its frame`);
        }
        await writeFile(join(out, `${shot.name}.png`), png);
        sizes[shot.name] = { width: info.width, height: info.height };
        console.log(`rendered ${shot.name} (${info.width} x ${info.height})`);
        await page.close();
    }
    // The page reserves each image's box from these sizes before it loads.
    await writeFile(manifest, `${JSON.stringify(sizes, null, 4)}\n`);
} finally {
    await browser.close();
    server.close();
}
