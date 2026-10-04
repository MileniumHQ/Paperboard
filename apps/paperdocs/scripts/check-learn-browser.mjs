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
        assert.equal(await page.locator('link[rel="icon"]').getAttribute('href'), '/paperboard.png');
        assert.equal(await page.locator('meta[property="og:url"]').getAttribute('content'), `https://paperboard.dev/${slug}/`);
        assert.equal(await page.locator('meta[name="twitter:description"]').getAttribute('content'), await page.locator('meta[name="description"]').getAttribute('content'));
        assert.equal(await page.locator('.site-topbar__item-text').first().evaluate(element => getComputedStyle(element).textAlign), 'left');
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
        "4px",
    );
    assert.equal(await page.locator(".card-slide").count(), 6);
    assert.equal(await page.locator(".preview-card").evaluate(element => getComputedStyle(element, "::before").transform), "matrix(1, 0, 0, 1, 14, 16)");
    assert.equal(await page.locator(".dots-bar .dot").count(), 6);
    await page.locator(".showcase-section").scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    const captionBefore = await page.locator('.card-caption').boundingBox();
    await page.locator(".dots-bar .dot").nth(3).click();
    await page.waitForTimeout(75);
    const captionDuring = await page.locator('.card-caption').evaluate(element => ({
        box: element.getBoundingClientRect().toJSON(),
        transform: getComputedStyle(element).transform,
        textTransform: getComputedStyle(element.querySelector('.caption-title')).transform,
    }));
    assert.equal(captionDuring.transform, 'none', 'The caption background must not move when the slide changes');
    assert.ok(captionDuring.textTransform !== 'none', 'Only the caption text should animate');
    assert.ok(Math.abs(captionBefore.y - captionDuring.box.y) < 0.5, 'The caption surface must stay fixed during a real slide change');
    await page.waitForFunction(
        () => document.querySelector(".caption-title").textContent === "Local AI",
    );
    assert.ok(
        await page
            .locator(".card-slides-track")
            .evaluate((element) => getComputedStyle(element).transform !== "none"),
    );
    console.log("verified main landing carousel: six slides, text-only caption animation, AI caption, and working selection");
    for (const [width, height] of [
        [2560, 720],
        [1920, 1080],
        [1440, 900],
        [1280, 720],
        [1024, 768],
        [768, 1024],
        [844, 390],
        [390, 844],
        [320, 568],
    ]) {
        await page.setViewportSize({ width, height });
        await page.goto(`${origin}/`);
        await page.waitForFunction(() => window.__aioStage?.companions.length === 4);
        await page.evaluate(() => window.scrollTo(0, innerHeight));
        await page.waitForTimeout(550);
        const progress = await page.locator('.dots-bar').evaluate(element => ({
            height: element.getBoundingClientRect().height,
            dots: [...element.querySelectorAll('.dot')].map(dot => ({
                active: dot.classList.contains('active'),
                width: dot.getBoundingClientRect().width,
                height: dot.getBoundingClientRect().height,
            })),
        }));
        assert.equal(progress.height, 48, `Carousel indicator must keep its height at ${width} × ${height}`);
        assert.ok(progress.dots.every(dot => dot.height === 12 && Math.abs(dot.width - (dot.active ? 58 : 12)) < 0.5), `Carousel dots must not shrink at ${width} × ${height}`);
        await page.evaluate(() => window.scrollTo(0, innerHeight * 2));
        await page.waitForFunction(() =>
            window.__aioStage.companions.every((entry) => entry.obj.visible),
        );
        const connector = await page.locator('.stage-dash').evaluate(element => ({
            transform: getComputedStyle(element).transform,
            width: element.getBoundingClientRect().width,
            left: element.getBoundingClientRect().left,
            right: element.getBoundingClientRect().right,
            y: element.getBoundingClientRect().top,
            visible: getComputedStyle(element).visibility,
        }));
        assert.equal(connector.transform, 'none', `The data line must be horizontal at ${width} × ${height}`);
        assert.equal(connector.visible, 'visible');
        assert.ok(connector.width >= 24, `The data line needs a legible run at ${width} × ${height}: ${connector.width}`);
        const devices = await page.evaluate(() => {
            const stage = window.__aioStage;
            return [{ id: 'imac', object: stage.group }, ...stage.companions.map((entry) => ({ id: entry.id, object: entry.obj }))].map(({ id, object }) => {
                const box = new stage.THREE.Box3().setFromObject(object);
                const corners = [];
                for (const x of [box.min.x, box.max.x])
                    for (const y of [box.min.y, box.max.y])
                        for (const z of [box.min.z, box.max.z])
                            corners.push(new stage.THREE.Vector3(x, y, z).project(stage.camera));
                return {
                    id,
                    visible: object.visible,
                    min: box.min, max: box.max,
                    corners: corners.map((point) => ({ x: point.x, y: point.y })),
                };
            });
        });
        assert.equal(devices.length, 5);
        const station = devices.find(device => device.id === 'battlestation');
        const stationLeft = Math.min(...station.corners.map(point => point.x));
        assert.ok(devices.filter(device => device !== station).every(device =>
            Math.max(...device.corners.map(point => point.x)) < stationLeft,
        ), `Every other device must stay left of the battlestation at ${width} × ${height}`);
        assert.ok(devices.every(device => {
            const xs = device.corners.map(point => (point.x + 1) * width / 2);
            const ys = device.corners.map(point => (1 - point.y) * height / 2);
            return connector.right <= Math.min(...xs) || connector.left >= Math.max(...xs)
                || connector.y <= Math.min(...ys) || connector.y >= Math.max(...ys);
        }), `The horizontal line must stay clear of devices at ${width} × ${height}`);
        for (const [index, a] of devices.entries()) for (const b of devices.slice(index + 1)) {
            assert.ok(a.max.x < b.min.x || b.max.x < a.min.x || a.max.y < b.min.y || b.max.y < a.min.y || a.max.z < b.min.z || b.max.z < a.min.z, `Models must not intersect at ${width} × ${height}`);
        }
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
        const safeArea = await page.evaluate(() => ({
            top: document.querySelector('.site-topbar__bar').getBoundingClientRect().bottom + 8,
            bottom: document.querySelector('.stage-copy').getBoundingClientRect().top - 8,
        }));
        assert.ok(devices.every(device => device.corners.every(point => {
            const y = (1 - point.y) * height / 2;
            return y > safeArea.top && y < safeArea.bottom;
        })), `Models need space between navigation and copy at ${width} × ${height}`);
        for (const fraction of [1.55, 1.7, 1.85, 1.92, 2]) {
            await page.evaluate(s => scrollTo(0, innerHeight * s), fraction);
            await page.waitForTimeout(80);
            assert.ok(await page.evaluate(() => {
                const stage = window.__aioStage;
                const boxes = [stage.group, ...stage.companions.filter(entry => entry.obj.visible).map(entry => entry.obj)]
                    .map(obj => new stage.THREE.Box3().setFromObject(obj));
                return boxes.every((box, index) => boxes.slice(index + 1).every(other => !box.intersectsBox(other)));
            }), `Moving models must not intersect at stage ${fraction}`);
        }
    }
    // Change orientation while the stage is visible, without navigating away.
    for (const [width, height] of [[844, 390], [390, 844], [768, 1024], [1024, 768]]) {
        await page.setViewportSize({ width, height });
        await page.evaluate(() => scrollTo(0, innerHeight * 2));
        await page.waitForFunction(() => window.__aioStage.companions.every(entry => entry.obj.visible));
        const points = await page.evaluate(() => {
            const stage = window.__aioStage;
            return [stage.group, ...stage.companions.map(entry => entry.obj)].map(obj => {
                const centre = new stage.THREE.Box3().setFromObject(obj).getCenter(new stage.THREE.Vector3()).project(stage.camera);
                return { x: (centre.x + 1) * innerWidth / 2, y: (1 - centre.y) * innerHeight / 2 };
            });
        });
        for (const point of points) {
            await page.mouse.move(point.x, point.y);
            await page.waitForTimeout(120);
            assert.ok(await page.evaluate(() => {
                const stage = window.__aioStage;
                const boxes = [stage.group, ...stage.companions.map(entry => entry.obj)].map(obj => new stage.THREE.Box3().setFromObject(obj));
                return boxes.every((box, index) => boxes.slice(index + 1).every(other => !box.intersectsBox(other)));
            }), `No hover or orientation-change intersections at ${width} × ${height}`);
        }
    }
    console.log("verified compact left device group and right battlestation across nine viewport sizes, live orientation changes, transition and hover");
    // Exercise real hover input and prove the renderer sleeps both when hidden
    // and when the visible scene has settled, then wakes for a hover turn.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${origin}/`);
    await page.waitForFunction(() => window.__aioStage?.companions.length === 4);
    await page.waitForTimeout(300);
    const hiddenRenders = await page.evaluate(() => window.__aioStage.renders);
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => window.__aioStage.renders), hiddenRenders);
    await page.evaluate(() => scrollTo(0, innerHeight * 2));
    await page.waitForTimeout(800);
    const settledRenders = await page.evaluate(() => window.__aioStage.renders);
    assert.ok(settledRenders > hiddenRenders);
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => window.__aioStage.renders), settledRenders);
    const hoverPosition = await page.evaluate(() => {
        const stage = window.__aioStage;
        const point = new stage.THREE.Box3().setFromObject(stage.group).getCenter(new stage.THREE.Vector3()).project(stage.camera);
        return { x: (point.x + 1) * innerWidth / 2, y: (1 - point.y) * innerHeight / 2 };
    });
    await page.mouse.move(hoverPosition.x, hoverPosition.y);
    await page.waitForFunction(() => window.__aioStage.renders > 0 && window.__aioStage.groupHover > 0.05);
    await page.waitForTimeout(800);
    assert.ok(await page.evaluate(previous => window.__aioStage.renders > previous, settledRenders));
    assert.ok(await page.evaluate(() => {
        const s = window.__aioStage;
        const boxes = [s.group, ...s.companions.map(entry => entry.obj)].map(obj => new s.THREE.Box3().setFromObject(obj));
        return boxes.every((box, index) => boxes.slice(index + 1).every(other => !box.intersectsBox(other)));
    }), 'Hover turns must not collide with neighbours');
    console.log('verified sleeping GPU rendering and live hover without model intersections');

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
