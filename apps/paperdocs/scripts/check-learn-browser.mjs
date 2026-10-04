import { chromium } from "playwright";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";

// Check the distributed static documents, not a Vite SPA fallback. The Worker
// routing has its own tests; this loopback server owns and tears down its sockets.
const dist = resolve(fileURLToPath(new URL("../dist/", import.meta.url)));
const mime = {
    ".html": "text/html",
    ".css": "text/css",
    ".js": "text/javascript",
    ".mjs": "text/javascript",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".woff2": "font/woff2",
};
const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    const target = resolve(dist, `.${path.endsWith("/") ? `${path}index.html` : path}`);
    if (!target.startsWith(`${dist}${sep}`)) {
        res.writeHead(403).end();
        return;
    }
    try {
        const data = await readFile(target);
        res.writeHead(200, {
            "Content-Type": mime[extname(target)] || "application/octet-stream",
        }).end(data);
    } catch (error) {
        if (error.code === "ENOENT") res.writeHead(404).end();
        else {
            console.error(error);
            res.writeHead(500).end();
        }
    }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
    browser = await chromium.launch({
        ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
        headless: true,
        args: ["--force-color-profile=srgb"],
    });
    const origin = `http://127.0.0.1:${server.address().port}`;
    const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
    const failures = [];
    page.on("pageerror", (error) => failures.push(error.message));
    page.on("response", (response) => {
        if (response.status() >= 400 && !response.url().endsWith("/favicon.ico"))
            failures.push(`${response.status()} ${response.url()}`);
    });
    const logoColors = new Set();
    const buttonShadows = new Set();
    for (const slug of ["actions", "game-server", "bot-creator", "ai"]) {
        assert.equal((await page.goto(`${origin}/${slug}/`)).status(), 200);
        assert.equal(await page.locator("h1").count(), 1);
        assert.equal(await page.locator(".learn-kicker, .learn-eyebrow").count(), 0);
        assert.equal(await page.locator("h1.marketing-heading, .learn-feature h2.marketing-heading, .learn-outro h2.marketing-heading").count(), slug === "game-server" ? 6 : 5);
        assert.ok(!(await page.locator("main").innerText()).includes("—"));
        assert.ok(await page.locator(".learn-outro h2").evaluate(element => element.classList.contains("marketing-heading")));
        assert.equal(await page.locator(".learn-outro h2 .marketing-heading-label").innerText(), `Get ${slug === "ai" ? "Local AI" : slug === "game-server" ? "Game Server" : slug === "bot-creator" ? "Bot Creator" : "Actions"}`);
        assert.ok(await page.locator(".learn-feature-copy").evaluateAll(elements => elements.every(element => getComputedStyle(element).textAlign === "center")));
        assert.ok(await page.locator(".site-topbar__trigger, .site-topbar__link, .site-topbar__item-text strong").evaluateAll(elements => elements.every(element => {
            const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1;
            const ctx = canvas.getContext("2d"); ctx.fillStyle = getComputedStyle(element).color; ctx.fillRect(0, 0, 1, 1);
            const rgb = ctx.getImageData(0, 0, 1, 1).data;
            return Math.max(rgb[0], rgb[1], rgb[2]) < 60;
        })), "Topbar links need dark ink on the frosted light surface");
        assert.equal(await page.locator(".learn-hero-shot").evaluate(element => getComputedStyle(element, "::before").transform), "matrix(1, 0, 0, 1, 14, 16)");
        assert.equal(
            await page.locator(".site-topbar__download .download-label").innerText(),
            "Download",
        );
        logoColors.add(
            await page
                .locator(".site-topbar__name")
                .evaluate((element) => getComputedStyle(element).color),
        );
        await page.waitForFunction(() =>
            document
                .querySelector(".download-cta paper-button")
                ?.shadowRoot?.querySelector(".PaperButton"),
        );
        buttonShadows.add(
            await page
                .locator(".download-cta paper-button")
                .first()
                .evaluate(
                    (element) =>
                        getComputedStyle(element.shadowRoot.querySelector(".PaperButton"))
                            .boxShadow,
                ),
        );
        assert.equal(await page.locator(".learn-feature").count(), slug === "game-server" ? 4 : 3);
        assert.ok((await page.locator(".is-pending").count()) > 0);
        await page.locator(".learn-feature").first().scrollIntoViewIfNeeded();
        await page.waitForFunction(
            () => getComputedStyle(document.querySelector(".learn-feature")).opacity === "1",
        );
        await page.locator(".learn-outro").scrollIntoViewIfNeeded();
        await page
            .locator(".learn-feature img")
            .evaluateAll((images) => Promise.all(images.map((image) => image.decode())));
        assert.deepEqual(
            await page
                .locator("main img")
                .evaluateAll((images) =>
                    images
                        .filter((image) => !image.complete || !image.naturalWidth)
                        .map((image) => image.src),
                ),
            [],
        );
        assert.equal(
            await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
            false,
        );
        assert.equal(await page.locator('script[src="/js/card-scroll.js"]').count(), 0);
        console.log(
            `verified desktop ${slug}: static content, loaded images, scrolling, and reveals`,
        );
    }
    assert.equal(
        logoColors.size,
        1,
        "Paperboard branding must keep the same color on every panel page",
    );
    assert.equal(buttonShadows.size, 4, "Download button shadows must follow each panel accent");
    await page.goto(`${origin}/`);
    assert.equal(await page.locator('.chart-section, script[src="/js/bar-chart.js"]').count(), 0);
    assert.equal(
        await page
            .locator(".cta-image")
            .evaluate((element) => getComputedStyle(element).borderRadius),
        "0px",
    );
    assert.equal(await page.locator(".card-slide").count(), 6);
    assert.equal(await page.locator(".preview-card").evaluate(element => getComputedStyle(element, "::before").transform), "matrix(1, 0, 0, 1, 14, 16)");
    assert.equal(await page.locator(".dots-bar .dot").count(), 6);
    await page.locator(".showcase-section").scrollIntoViewIfNeeded();
    await page.locator(".dots-bar .dot").nth(3).click();
    await page.waitForFunction(
        () => document.querySelector(".caption-title").textContent === "Local AI",
    );
    assert.ok(
        await page
            .locator(".card-slides-track")
            .evaluate((element) => getComputedStyle(element).transform !== "none"),
    );
    console.log("verified main landing carousel: six slides, AI caption, and working selection");
    for (const [width, height] of [
        [1440, 900],
        [1280, 720],
        [1024, 768],
        [390, 844],
    ]) {
        await page.setViewportSize({ width, height });
        await page.goto(`${origin}/`);
        await page.waitForFunction(() => window.__aioStage?.companions.length === 4);
        await page.evaluate(() => window.scrollTo(0, innerHeight * 2));
        await page.waitForFunction(() =>
            window.__aioStage.companions.every((entry) => entry.obj.visible),
        );
        const devices = await page.evaluate(() => {
            const stage = window.__aioStage;
            return [stage.group, ...stage.companions.map((entry) => entry.obj)].map((object) => {
                const box = new stage.THREE.Box3().setFromObject(object);
                const corners = [];
                for (const x of [box.min.x, box.max.x])
                    for (const y of [box.min.y, box.max.y])
                        for (const z of [box.min.z, box.max.z])
                            corners.push(new stage.THREE.Vector3(x, y, z).project(stage.camera));
                return {
                    visible: object.visible,
                    corners: corners.map((point) => ({ x: point.x, y: point.y })),
                };
            });
        });
        assert.equal(devices.length, 5);
        assert.ok(
            devices.every(
                (device) =>
                    device.visible &&
                    device.corners.every(
                        (point) => Math.abs(point.x) < 0.98 && Math.abs(point.y) < 0.98,
                    ),
            ),
            `All five devices must fit at ${width} × ${height}`,
        );
    }
    console.log("verified five visible devices without clipping at four viewport sizes");

    await page.setViewportSize({ width: 1440, height: 1080 });
    await page.goto(`${origin}/`);
    await page.locator("[data-play-field]").scrollIntoViewIfNeeded();
    await page.waitForFunction(() => [...document.querySelectorAll(".play-icon")].every(icon => icon.style.transform.includes("translate3d")));
    assert.equal(await page.locator('[data-play-state="unavailable"]').count(), 0);
    const icons = page.locator(".play-icon");
    const a = await icons.nth(0).boundingBox(), b = await icons.nth(1).boundingBox();
    assert.ok(a && b);
    const before = await icons.nth(1).getAttribute("style");
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
    await page.waitForFunction(previous => document.querySelectorAll(".play-icon")[1].getAttribute("style") !== previous, before);
    await page.mouse.up();
    console.log("verified actual artwork loads and dragging an icon pushes its neighbour");
    await page.setViewportSize({ width: 390, height: 844 });
    for (const slug of ["actions", "game-server", "bot-creator", "ai"]) {
        await page.goto(`${origin}/${slug}/`);
        assert.equal(
            await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
            false,
        );
        await page.getByRole("button", { name: "Open navigation" }).click();
        assert.equal(await page.locator("#site-mobile-menu").getAttribute("hidden"), null);
        assert.ok(await page.locator(".site-topbar__mobile-link").evaluateAll(elements => elements.every(element => getComputedStyle(element).color !== "rgb(255, 255, 255)")));
        await page.keyboard.press("Escape");
        assert.notEqual(await page.locator("#site-mobile-menu").getAttribute("hidden"), null);
        console.log(`verified mobile ${slug}: layout and navigation dismissal`);
    }
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`${origin}/actions/`);
    assert.equal(await page.locator(".is-pending").count(), 0);
    assert.equal(
        await page
            .locator(".learn-feature-shot")
            .first()
            .evaluate((element) => getComputedStyle(element).transform),
        "none",
    );
    const staticPage = await browser.newPage({ javaScriptEnabled: false });
    await staticPage.goto(`${origin}/ai/`);
    assert.equal(await staticPage.locator("h1").innerText(), "AI on your computer");
    assert.equal(
        await staticPage
            .locator(".learn-feature")
            .first()
            .evaluate((element) => getComputedStyle(element).opacity),
        "1",
    );
    assert.deepEqual(failures, []);
    console.log(
        "verified reduced motion, no-JavaScript content, and no failed assets/browser errors",
    );
} finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
}
