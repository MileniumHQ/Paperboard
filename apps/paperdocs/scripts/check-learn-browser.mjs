import { chromium } from "playwright";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { checkDownloads } from './check-download-browser.mjs';
import { checkBlog } from './check-blog-browser.mjs';

// Perceived brightness of an "rgb(...)"/"color(srgb ...)" string, so a test can
// assert one layer actually sits darker than the field it rests on.
function luminance(color) {
    const values = color.match(/[\d.]+/g).slice(0, 3).map(Number);
    const [r, g, b] = color.startsWith("color(")
        ? values.map((value) => value * 255)
        : values;
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

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
        assert.ok(await page.locator(".site-topbar__trigger, .site-topbar__link").evaluateAll(elements => elements.every(element => {
            const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1;
            const ctx = canvas.getContext("2d"); ctx.fillStyle = getComputedStyle(element).color; ctx.fillRect(0, 0, 1, 1);
            const rgb = ctx.getImageData(0, 0, 1, 1).data;
            return Math.min(rgb[0], rgb[1], rgb[2]) > 180;
        })), "Topbar links need light ink on the smoked glass bar");
        assert.ok(await page.locator(".site-topbar__item-text strong").evaluateAll(elements => elements.every(element => {
            const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1;
            const ctx = canvas.getContext("2d"); ctx.fillStyle = getComputedStyle(element).color; ctx.fillRect(0, 0, 1, 1);
            const rgb = ctx.getImageData(0, 0, 1, 1).data;
            return Math.min(rgb[0], rgb[1], rgb[2]) > 180;
        })), "Dropdown items need light ink on the smoked glass menu");
        assert.ok(
            luminance(await page.locator(".site-topbar__dropdown").first().evaluate(element => getComputedStyle(element).backgroundColor)) < 40,
            "The dropdown must be the same smoked glass as the bar, not a white card",
        );
        assert.deepEqual(
            await page.locator(".site-topbar__bar").evaluate(element => [getComputedStyle(element).backdropFilter, getComputedStyle(element, "::before").backdropFilter.includes("blur"), getComputedStyle(element.querySelector(".site-topbar__dropdown")).backdropFilter.includes("blur")]),
            ["none", true, true],
            "The bar's glass must sit on its ::before layer: a backdrop-filter on the bar itself makes it the dropdowns' backdrop root, so they could not blur the page",
        );
        const heroTilt = await page.locator(".learn-hero-shot").evaluate(element => new DOMMatrix(getComputedStyle(element).transform));
        assert.ok(
            heroTilt.m11 === 1 && heroTilt.m12 === 0 && heroTilt.m13 === 0 && heroTilt.m23 > 0.05,
            "The hero screenshot only leans back",
        );
        const featureTilt = await page.locator(".learn-feature-shot").evaluateAll(elements => elements.map(element => new DOMMatrix(getComputedStyle(element).transform)));
        assert.ok(
            featureTilt.every((matrix, index) => matrix.m12 === 0 && matrix.m21 === 0 && matrix.m23 === 0 && (index % 2 ? matrix.m13 > 0.05 : matrix.m13 < -0.05)),
            "Feature screenshots turn on their vertical axis only, toward their copy, with no lean or skew",
        );
        assert.equal(await page.locator(".learn-hero-shot").evaluate(element => getComputedStyle(element, "::before").transform), "matrix(1, 0, 0, 1, 14, 16)");
        assert.equal(
            await page.locator(".site-topbar__download .download-label").innerText(),
            "Download",
        );
        await page.waitForFunction(() =>
            document
                .querySelector(".site-topbar__name styled-text")
                ?.shadowRoot?.querySelector("#mainText"),
        );
        logoColors.add(
            await page
                .locator(".site-topbar__name styled-text")
                .evaluate((element) =>
                    getComputedStyle(
                        element.shadowRoot.querySelector("#mainText"),
                    ).fill,
                ),
        );
        const wordmarkAccent = await page
            .locator(".site-topbar__name")
            .evaluate((element) => {
                const style = getComputedStyle(element);
                return {
                    accent: style
                        .getPropertyValue("--paper-site-accent")
                        .trim(),
                    primary: style.getPropertyValue("--paper-primary").trim(),
                };
            });
        assert.equal(
            wordmarkAccent.accent,
            wordmarkAccent.primary,
            "Wordmark must pin its accent to the landing blue instead of inheriting the panel accent",
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
        const backLayer = await page
            .locator(".download-cta paper-button")
            .first()
            .evaluate((element) =>
                getComputedStyle(
                    element.shadowRoot.querySelector(".PaperEffect"),
                    "::before",
                ).backgroundColor,
            );
        const pageField = await page.evaluate(() => {
            const field = document.querySelector(".learn-page");
            const probe = document.createElement("div");
            probe.style.background =
                "color-mix(in srgb, var(--paper-site-accent) 25%, var(--paper-marketing-ink))";
            field.appendChild(probe);
            const color = getComputedStyle(probe).backgroundColor;
            probe.remove();
            return color;
        });
        assert.ok(
            luminance(backLayer) < luminance(pageField),
            `The button back layer on ${slug} must sit darker than the page field`,
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
        "The Paperboard wordmark must render the same texture color on every panel page",
    );
    assert.equal(
        [...logoColors][0],
        "rgb(255, 255, 255)",
        "The wordmark must use the white header glyph texture, not a recolored fill",
    );
    assert.equal(buttonShadows.size, 4, "Download button shadows must follow each panel accent");
    await page.goto(`${origin}/`);
    await page.waitForFunction(() =>
        document
            .querySelector(".site-topbar__name styled-text")
            ?.shadowRoot?.querySelector("#mainText"),
    );
    assert.equal(
        await page
            .locator(".site-topbar__name styled-text")
            .evaluate((element) =>
                getComputedStyle(
                    element.shadowRoot.querySelector("#mainText"),
                ).fill,
            ),
        [...logoColors][0],
        "The landing wordmark must use the same blue as every panel page",
    );
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
    assert.ok(
        luminance(await page.locator(".dots-bar").evaluate(element => getComputedStyle(element).backgroundColor)) < 40,
        "The carousel dots sit on the topbar's smoked glass, not a white pill",
    );
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
        await page.evaluate(() => window.scrollTo(0, innerHeight));
        await page.waitForFunction(() => window.__aioStage?.companions.length === 4);
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
    await page.waitForTimeout(600);
    assert.equal(await page.evaluate(() => Boolean(window.__aioStage)), false, 'Opening screen must defer the 3D stage');
    assert.deepEqual(await page.evaluate(() => performance.getEntriesByType('resource').filter(entry => /\/js\/vendor\/|\/models\//.test(entry.name)).map(entry => entry.name)), [], 'No Three.js or model downloads before approaching the showcase');
    const openingTicks = await page.evaluate(() => window.__flight.ticks);
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => window.__flight.ticks), openingTicks);
    await page.evaluate(() => scrollTo(0, innerHeight * 2));
    await page.waitForFunction(() => window.__aioStage?.companions.length === 4);
    await page.waitForTimeout(800);
    const settledRenders = await page.evaluate(() => window.__aioStage.renders);
    assert.ok(settledRenders > 0);
    const settledFrames = await page.evaluate(() => window.__aioStage.frames);
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => window.__aioStage.renders), settledRenders);
    assert.equal(await page.evaluate(() => window.__aioStage.frames), settledFrames, 'Settled scene must stop animation callbacks as well as GPU rendering');
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

    const unavailableStage = await browser.newPage();
    try {
        await unavailableStage.route('**/js/vendor/three.module.js', route => route.abort());
        await unavailableStage.goto(`${origin}/`);
        await unavailableStage.evaluate(() => scrollTo(0, innerHeight * 2));
        await unavailableStage.getByRole('button', { name: 'Retry preview' }).waitFor();
        assert.equal(await unavailableStage.locator('#aio-stage').getAttribute('data-stage-state'), 'unavailable');
        await unavailableStage.unroute('**/js/vendor/three.module.js');
        const reloaded = unavailableStage.waitForEvent('load');
        await unavailableStage.getByRole('button', { name: 'Retry preview' }).click();
        await reloaded;
        await unavailableStage.evaluate(() => scrollTo(0, innerHeight * 2));
        await unavailableStage.waitForFunction(() => window.__aioStage?.companions.length === 4);
        assert.equal(await unavailableStage.locator('.stage-unavailable').count(), 0);
    } finally { await unavailableStage.close(); }
    console.log('verified failed 3D loading stays visibly unavailable and Retry loads a fresh working scene');

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
        assert.ok(await page.locator(".site-topbar__mobile-link").evaluateAll(elements => elements.every(element => {
            const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1;
            const ctx = canvas.getContext("2d"); ctx.fillStyle = getComputedStyle(element).color; ctx.fillRect(0, 0, 1, 1);
            const rgb = ctx.getImageData(0, 0, 1, 1).data;
            return Math.min(rgb[0], rgb[1], rgb[2]) > 180;
        })), "Mobile menu links need light ink on the smoked glass panel");
        await page.keyboard.press("Escape");
        assert.notEqual(await page.locator("#site-mobile-menu").getAttribute("hidden"), null);
        console.log(`verified mobile ${slug}: layout and navigation dismissal`);
    }
    for (const path of ["/", "/game-server/"]) {
        for (const width of [320, 390, 460, 500, 700, 900]) {
            await page.setViewportSize({ width, height: 800 });
            await page.goto(`${origin}${path}`);
            await page.waitForFunction(() => document.querySelector(".site-topbar__download paper-button")?.shadowRoot?.querySelector("a"));
            const bar = await page.evaluate(() => {
                const box = (selector) => document.querySelector(selector).getBoundingClientRect();
                return { bar: box(".site-topbar__bar"), toggle: box(".site-topbar__mobile-toggle"), download: box(".site-topbar__download paper-button") };
            });
            assert.ok(bar.toggle.width > 0 && bar.download.width > 0, `Menu toggle and Download both show at ${width}px on ${path}`);
            assert.ok(bar.download.left - bar.toggle.right >= 8, `Download needs space from the menu toggle at ${width}px on ${path} (${bar.download.left - bar.toggle.right}px)`);
            assert.ok(bar.download.right <= bar.bar.right && bar.bar.right <= width, `Download must stay inside the bar at ${width}px on ${path}`);
            await page.locator(".site-topbar__download paper-button").getByRole("link", { name: "Download" }).waitFor();
        }
    }
    console.log("verified the topbar keeps Download spaced from the menu toggle and inside the bar from 320px to 900px");
    await page.setViewportSize({ width: 1440, height: 1080 });
    await page.goto(`${origin}/game-server/`);
    const shot = page.locator(".learn-feature-shot").first();
    await shot.scrollIntoViewIfNeeded();
    const restingTilt = await shot.evaluate(element => new DOMMatrix(getComputedStyle(element).transform).m13);
    await shot.hover();
    await page.waitForTimeout(700);
    const hoverTilt = await shot.evaluate(element => new DOMMatrix(getComputedStyle(element).transform).m13);
    assert.ok(Math.abs(hoverTilt) < 0.01 && Math.abs(restingTilt) > 0.05, `Hover must turn the screenshot to face the camera (${restingTilt} -> ${hoverTilt})`);
    const shotLink = shot.locator(".learn-shot-link");
    const shotAlt = await shotLink.locator("img").getAttribute("alt");
    await shotLink.click();
    const lightbox = page.getByRole("dialog", { name: shotAlt });
    await lightbox.waitFor();
    assert.equal(page.url(), `${origin}/game-server/`, "Clicking a screenshot opens it in place instead of navigating");
    await page.waitForFunction(() => document.querySelector(".learn-lightbox-image").complete);
    const opened = await page.locator(".learn-lightbox-image").evaluate(element => {
        const box = element.getBoundingClientRect();
        return {
            src: element.getAttribute("src"),
            fills: box.width > innerWidth * 0.85 || box.height > innerHeight * 0.85,
            fits: box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight,
        };
    });
    assert.equal(opened.src, `${origin}${await shotLink.getAttribute("href")}`);
    assert.ok(opened.fills, "The opened screenshot must fill the viewport");
    assert.ok(opened.fits, "The opened screenshot must fit inside the viewport, never larger than it");
    assert.equal(await page.evaluate(() => document.activeElement?.className), "learn-lightbox-close");
    await page.keyboard.press("Escape");
    await lightbox.waitFor({ state: "hidden" });
    assert.ok(await shotLink.evaluate(element => element === document.activeElement), "Closing returns focus to the screenshot");
    await shotLink.click();
    await lightbox.waitFor();
    await page.mouse.click(8, 540);
    await lightbox.waitFor({ state: "hidden" });
    for (const [width, height] of [[390, 844], [844, 390], [2560, 720], [800, 2000]]) {
        await page.setViewportSize({ width, height });
        await page.locator(".learn-hero-shot .learn-shot-link").click();
        await page.getByRole("dialog").waitFor();
        await page.waitForFunction(() => document.querySelector(".learn-lightbox-image").complete);
        const box = await page.locator(".learn-lightbox-image").evaluate(element => element.getBoundingClientRect().toJSON());
        assert.ok(
            box.left >= 0 && box.top >= 0 && box.right <= width && box.bottom <= height && box.width > 0,
            `The opened screenshot must fit a ${width} × ${height} viewport (${JSON.stringify(box)})`,
        );
        await page.keyboard.press("Escape");
        await page.locator(".learn-lightbox").waitFor({ state: "hidden" });
    }
    await page.setViewportSize({ width: 1440, height: 1080 });
    console.log("verified learn screenshots: vertical tilt, hover facing the camera, and full-screen open/dismiss");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`${origin}/actions/`);
    assert.equal(await page.locator(".is-pending").count(), 0);
    await page.locator(".learn-hero-shot .learn-shot-link").click();
    await page.locator(".learn-lightbox").waitFor();
    await page.getByRole("button", { name: "Close" }).click();
    await page.locator(".learn-lightbox").waitFor({ state: "hidden" });
    assert.equal(
        await page
            .locator(".learn-feature-shot")
            .first()
            .evaluate((element) => getComputedStyle(element).transform),
        "none",
    );
    const staticPage = await browser.newPage({ javaScriptEnabled: false });
    await staticPage.goto(`${origin}/ai/`);
    assert.equal(
        await staticPage.locator(".learn-hero-shot .learn-shot-link").getAttribute("href"),
        await staticPage.locator(".learn-hero-shot img").getAttribute("src"),
        "Without JavaScript a screenshot still links to its full-size image",
    );
    assert.equal(await staticPage.locator("h1").innerText(), "AI on your computer");
    assert.equal(
        (await staticPage.locator(".site-topbar__name").innerText()).trim(),
        "Paperboard",
        "Without JavaScript the wordmark must fall back to a single plain label",
    );
    assert.equal(
        await staticPage
            .locator(".learn-feature")
            .first()
            .evaluate((element) => getComputedStyle(element).opacity),
        "1",
    );
    assert.deepEqual(failures, []);
    await checkDownloads(browser, origin);
    await checkBlog(browser, origin, dist);
    console.log(
        "verified reduced motion, no-JavaScript content, and no failed assets/browser errors",
    );
} finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
}
