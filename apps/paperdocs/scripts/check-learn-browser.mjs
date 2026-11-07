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
    ".webp": "image/webp",
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
    // each learn page's feature count, as src/site/learn/panels.ts lists them
    const FEATURES = { "game-server": 5, "bot-creator": 4, agents: 4, actions: 3 };
    const logoColors = new Set();
    const buttonShadows = new Set();
    for (const slug of ["actions", "game-server", "bot-creator", "agents"]) {
        assert.equal((await page.goto(`${origin}/${slug}/`)).status(), 200);
        assert.equal(await page.locator("h1").count(), 1);
        assert.equal(await page.locator('link[rel="icon"]').getAttribute('href'), '/paperboard.png');
        assert.equal(await page.locator('meta[property="og:url"]').getAttribute('content'), `https://paperboard.dev/${slug}/`);
        assert.equal(await page.locator('meta[name="twitter:description"]').getAttribute('content'), await page.locator('meta[name="description"]').getAttribute('content'));
        assert.equal(await page.locator('.site-topbar__item-text').first().evaluate(element => getComputedStyle(element).textAlign), 'left');
        assert.equal(await page.locator(".learn-kicker, .learn-eyebrow").count(), 0);
        assert.equal(await page.locator("h1.marketing-heading, .learn-feature h2.marketing-heading, .learn-outro h2.marketing-heading").count(), FEATURES[slug] + 2, "a headline, one per feature, and the outro");
        assert.ok(!(await page.locator("main").innerText()).includes("—"));
        assert.ok(await page.locator(".learn-outro h2").evaluate(element => element.classList.contains("marketing-heading")));
        assert.equal(await page.locator(".learn-outro h2 .marketing-heading-label").innerText(), `Get ${slug === "agents" ? "Agent" : slug === "game-server" ? "Game Server" : slug === "bot-creator" ? "Bot Creator" : "Actions"}`);
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
        // Mobile browsers paint the document canvas while their toolbars move.
        // It must be the panel field's deepest stop, never the landing blue.
        const canvas = await page.evaluate(() => {
            const probe = document.createElement("div");
            probe.style.background =
                "color-mix(in srgb, var(--paper-site-accent) 10%, var(--paper-marketing-ink))";
            document.querySelector(".learn-page").appendChild(probe);
            const field = getComputedStyle(probe).backgroundColor;
            probe.remove();
            return { field, html: getComputedStyle(document.documentElement).backgroundColor };
        });
        assert.equal(canvas.html, canvas.field, `The document canvas on ${slug} must match its page field`);
        assert.equal(await page.locator(".learn-feature").count(), FEATURES[slug]);
        // Reveals are scroll-driven CSS: the hero is shown on arrival, a
        // section below the fold waits for the reader to scroll to it.
        assert.equal(await page.locator(".learn-hero").evaluate(element => getComputedStyle(element).opacity), "1");
        assert.notEqual(await page.locator(".learn-outro").evaluate(element => getComputedStyle(element).opacity), "1");
        await page.locator(".learn-feature").first().scrollIntoViewIfNeeded();
        await page.waitForFunction(
            () => getComputedStyle(document.querySelector(".learn-feature")).opacity === "1",
        );
        await page.locator(".learn-outro").scrollIntoViewIfNeeded();
        // Wait for every image the next check reads, including the outro's
        // lazy related-panel icons, which can still be in flight here.
        await page
            .locator("main img")
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
    // The developer section shows the first-panel tutorial's real commands.
    // The prompt is drawn by CSS, so copying a line copies only the command.
    assert.deepEqual(
        await page.locator(".devs-command").allInnerTexts(),
        ["npm create @mileniumhq/panel", "cd dev.example.hello", "bun install", "bun run build"],
    );
    assert.equal(
        await page.locator(".devs-command").first().evaluate(element => getComputedStyle(element, "::before").userSelect),
        "none",
    );
    // The landing is static: real screenshots and pre-rendered device art,
    // no WebGL, so every browser and screen gets the same page.
    assert.equal(await page.locator("h1").count(), 1);
    assert.equal(await page.locator("canvas").count(), 0, "The landing must not draw with WebGL");
    assert.deepEqual(
        await page.locator(".panel-row-link").evaluateAll(links => links.map(link => link.getAttribute("href"))),
        ["/game-server/", "/bot-creator/", "/agents/", "/actions/"],
        "The landing walks through three panels, then the one that connects them, each linking to its page",
    );
    assert.deepEqual(
        await page.locator(".panel-row h3").allInnerTexts(),
        ["Minecraft, managed", "Give your bot something to do", "An agent you text", "Connect your panels"],
        "Panel rows reuse their learn page headlines",
    );
    assert.deepEqual(
        await page.locator(".device-label").allInnerTexts(),
        ["Your desktop", "An old laptop", "A mini PC", "A Raspberry Pi"],
    );
    assert.ok(!(await page.locator("main").innerText()).toLowerCase().includes("all-in-one"), "The landing must not call Paperboard an all-in-one toolkit");
    // Scroll the whole page so every lazy image loads, then prove each one
    // decoded, and that nothing fetched a model or the 3D engine.
    for (let y = 0; y < await page.evaluate(() => document.documentElement.scrollHeight); y += 600) {
        await page.evaluate(top => scrollTo(0, top), y);
        await page.waitForTimeout(60);
    }
    await page.locator("main img").evaluateAll(images => Promise.all(images.map(image => image.decode())));
    assert.deepEqual(
        await page.locator("main img").evaluateAll(images => images.filter(image => !image.complete || !image.naturalWidth).map(image => image.src)),
        [],
    );
    assert.deepEqual(
        await page.evaluate(() => performance.getEntriesByType("resource").map(entry => entry.name).filter(name => /\/models\/|\/js\/vendor\/|three|\.glb/.test(name))),
        [],
        "The landing must not download models or Three.js",
    );
    // The user owns the scroll: a wheel tick moves the page by its own delta.
    await page.evaluate(() => scrollTo(0, 0));
    await page.mouse.move(720, 450);
    await page.mouse.wheel(0, 100);
    await page.waitForFunction(() => scrollY === 100);
    console.log("verified the static landing: panels, device row, loaded art, no 3D engine, and native scrolling");

    // Every screen shape: nothing runs off the side, the hero heading keeps
    // one type size and shares the copy's left edge, the computer stands above
    // the fold beside the copy, panel screenshots never sit on their copy and
    // stay one screen tall, the device row fits without devices overlapping,
    // and the outro icons clear the copy.
    const overlaps = (a, b) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
    for (const [width, height] of [[2560, 1080], [1440, 900], [1280, 720], [1024, 768], [820, 1180], [844, 390], [390, 844], [360, 640], [320, 568]]) {
        const shapePage = await browser.newPage({ viewport: { width, height } });
        try {
            await shapePage.goto(`${origin}/`);
            await shapePage.evaluate(() => document.fonts.ready);
            assert.equal(await shapePage.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `No horizontal scroll at ${width} × ${height}`);
            const lineSizes = await shapePage.locator(".hero-section styled-text").evaluateAll(elements => elements.map(element => Math.round(element.shadowRoot.querySelector("svg").getBoundingClientRect().height)));
            assert.equal(new Set(lineSizes).size, 1, `Hero heading lines share one size at ${width} × ${height}: ${lineSizes}`);
            const hero = await shapePage.locator(".hero-render img").boundingBox();
            assert.ok(hero.x >= 0 && hero.x + hero.width <= width && hero.height <= height * 1.05, `The hero art fits the screen at ${width} × ${height}`);
            const heroLefts = await shapePage.locator(".hero-copy .marketing-heading-lines, .hero-sub, .hero-copy paper-button").evaluateAll(elements => elements.map(element => Math.round(element.getBoundingClientRect().left)));
            assert.ok(Math.max(...heroLefts) - Math.min(...heroLefts) <= 2, `The hero heading, copy and download share one left edge at ${width} × ${height}: ${heroLefts}`);
            if (width > 900) {
                const copy = await shapePage.locator(".hero-copy").boundingBox();
                assert.ok(hero.y >= 0 && hero.y + hero.height <= height, `The computer stands above the fold at ${width} × ${height}`);
                assert.ok(hero.x >= copy.x + copy.width, `The computer sits beside the hero copy at ${width} × ${height}`);
            }
            const rows = await shapePage.locator(".panel-row").evaluateAll(features => features.map(feature => ({
                shot: feature.querySelector(".panel-row-shot").getBoundingClientRect().toJSON(),
                copy: feature.querySelector(".panel-row-copy").getBoundingClientRect().toJSON(),
            })));
            assert.equal(rows.length, 4);
            // Screenshots may run off the right edge, never the left, and a
            // row's screenshot is never taller than the screen.
            assert.ok(rows.every(row => !overlaps(row.shot, row.copy) && row.shot.left >= 0 && row.shot.left < width && row.shot.height <= height), `Panel screenshots stay beside their copy at ${width} × ${height}`);
            const devices = await shapePage.locator(".device .marketing-render").evaluateAll(images => images.map(image => image.getBoundingClientRect().toJSON()));
            assert.equal(devices.length, 4);
            assert.ok(devices.every(box => box.left >= 0 && box.right <= width && box.height > 20), `The device row fits at ${width} × ${height}`);
            for (const [index, a] of devices.entries()) for (const b of devices.slice(index + 1)) {
                assert.ok(!overlaps(a, b), `Devices must not overlap at ${width} × ${height}`);
            }
            const link = await shapePage.locator(".device-link").boundingBox();
            assert.ok(link && Math.max(link.width, link.height) >= 24, `The dash between hosts and desktop needs a legible run at ${width} × ${height}`);
            await shapePage.locator("[data-play-field]").scrollIntoViewIfNeeded();
            const still = width <= 600;
            if (!still) {
                await shapePage.waitForFunction(() => [...document.querySelectorAll(".play-icon")].every(icon => icon.style.transform.includes("translate3d")));
            }
            const outro = await shapePage.evaluate(() => ({
                copy: [...document.querySelectorAll(".outro-copy .styled-text-host, .outro-copy .download-cta")].map(element => element.getBoundingClientRect().toJSON()),
                icons: [...document.querySelectorAll(".play-icon")].map(element => ({ box: element.getBoundingClientRect().toJSON(), transform: element.style.transform })),
                field: document.querySelector("[data-play-field]").getBoundingClientRect().toJSON(),
            }));
            if (still) assert.ok(outro.icons.every(icon => icon.transform === ""), `Phones show the icons as a still row at ${width} × ${height}`);
            assert.ok(outro.icons.every(icon => outro.copy.every(copy => !overlaps(icon.box, copy))), `Outro icons must clear the heading and download at ${width} × ${height}`);
            assert.ok(outro.icons.every(icon => icon.box.top >= outro.field.top - 1 && icon.box.bottom <= outro.field.bottom + 1), `Outro icons stay inside their section at ${width} × ${height}`);
        } finally { await shapePage.close(); }
    }
    console.log("verified the landing hero, panel rows, device row and outro icons across nine screen shapes");

    // The icons are solid against the copy: one thrown or dragged onto the
    // heading ends up beside it, and pushing one into another moves it.
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
    const heading = await page.locator(".outro-copy .marketing-heading-lines").boundingBox();
    const thrown = await icons.nth(2).boundingBox();
    await page.mouse.move(thrown.x + thrown.width / 2, thrown.y + thrown.height / 2);
    await page.mouse.down();
    await page.mouse.move(heading.x + heading.width / 2, heading.y + heading.height / 2, { steps: 16 });
    await page.mouse.up();
    await page.waitForTimeout(1500);
    const outroCopy = await page.evaluate(() => [...document.querySelectorAll(".outro-copy .styled-text-host, .outro-copy .download-cta")].map(element => element.getBoundingClientRect().toJSON()));
    const landed = await icons.evaluateAll(elements => elements.map(element => element.getBoundingClientRect().toJSON()));
    assert.ok(landed.every(icon => outroCopy.every(copy => !overlaps(icon, copy))), "An icon dragged onto the heading must end up beside it, not over it");
    console.log("verified dragging pushes icons apart and never leaves one over the copy");

    // Reduced motion: no toy, the icons sit in their still row.
    const calm = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
    try {
        await calm.goto(`${origin}/`);
        await calm.locator("[data-play-field]").scrollIntoViewIfNeeded();
        await calm.waitForTimeout(400);
        assert.ok(await calm.locator(".play-icon").evaluateAll(elements => elements.every(element => element.style.transform === "" && getComputedStyle(element).position === "static")), "Reduced motion leaves the icons still");
    } finally { await calm.close(); }
    console.log("verified reduced motion keeps the outro icons still");
    await page.setViewportSize({ width: 390, height: 844 });
    for (const slug of ["actions", "game-server", "bot-creator", "agents"]) {
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
        // The footer's 14px social marks carry padded touch targets.
        assert.ok(
            await page.locator(".site-footer__social, .site-footer__milenium-link").evaluateAll(links => links.every(link => {
                const box = link.getBoundingClientRect();
                return box.width >= 24 && box.height >= 24;
            })),
            "Footer icon links need at least a 24px touch target",
        );
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
    // The decorative headings and buttons render as the parser creates them.
    // When they waited on fetched templates, every heading sat blank (its
    // label already hidden) for a round trip on a slow connection, then
    // popped in and pushed the page down. Slow every subresource down and
    // watch each frame from the first paint.
    const slowPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
    try {
        await slowPage.route("**/*", async (route) => {
            if (route.request().resourceType() !== "document") await new Promise((resolve) => setTimeout(resolve, 250));
            await route.continue();
        });
        await slowPage.addInitScript(() => {
            window.__blankHeadings = [];
            const sample = () => {
                const main = document.querySelector("main");
                if (main && main.getBoundingClientRect().height > 0) {
                    for (const heading of document.querySelectorAll(".marketing-heading")) {
                        if (heading.getBoundingClientRect().height < 1) window.__blankHeadings.push(heading.textContent.trim());
                    }
                }
                requestAnimationFrame(sample);
            };
            requestAnimationFrame(sample);
        });
        for (const path of ["/", "/game-server/"]) {
            const templateFetches = [];
            const onRequest = (request) => { if (/\/html\/|\/css\/(styled-text|paper-button|bg-overlay)\.css/.test(request.url())) templateFetches.push(request.url()); };
            slowPage.on("request", onRequest);
            await slowPage.goto(`${origin}${path}`, { waitUntil: "load" });
            await slowPage.waitForTimeout(400);
            slowPage.off("request", onRequest);
            assert.deepEqual(await slowPage.evaluate(() => [...new Set(window.__blankHeadings)]), [], `No heading on ${path} may paint blank before its effect renders`);
            assert.deepEqual(templateFetches, [], `Decorative elements on ${path} must not fetch their templates`);
        }
    } finally { await slowPage.close(); }
    console.log("verified headings and buttons never paint blank on a slow connection");
    // PaperUI's site.css owns the font faces. The marketing stylesheet used to
    // declare the same families again from /fonts/, so the page downloaded
    // Nunito twice under two URLs.
    for (const path of ["/", "/game-server/"]) {
        const fontPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
        try {
            const fonts = [];
            fontPage.on("request", (request) => { if (request.resourceType() === "font") fonts.push(new URL(request.url()).pathname); });
            await fontPage.goto(`${origin}${path}`, { waitUntil: "load" });
            await fontPage.evaluate(() => document.fonts.ready);
            const nunito = fonts.filter((font) => /\/Nunito[-.]/.test(font));
            assert.equal(nunito.length, 1, `${path} must download Nunito once (${fonts.join(", ")})`);
            assert.ok(fonts.every((font) => font.startsWith("/assets/")), `${path} fonts come from PaperUI's build (${fonts.join(", ")})`);
        } finally { await fontPage.close(); }
    }
    console.log("verified marketing pages download each font face once");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`${origin}/actions/`);
    assert.ok(
        await page.locator("[data-reveal]").evaluateAll(elements => elements.every(element => getComputedStyle(element).animationName === "none" && getComputedStyle(element).opacity === "1")),
        "Reduced motion shows every section without a reveal",
    );
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
    await staticPage.goto(`${origin}/agents/`);
    assert.equal(
        await staticPage.locator(".learn-hero-shot .learn-shot-link").getAttribute("href"),
        await staticPage.locator(".learn-hero-shot img").getAttribute("src"),
        "Without JavaScript a screenshot still links to its full-size image",
    );
    assert.equal(await staticPage.locator("h1").innerText(), "An agent you text");
    assert.equal(
        (await staticPage.locator(".site-topbar__name").innerText()).trim(),
        "Paperboard",
        "Without JavaScript the wordmark must fall back to a single plain label",
    );
    // The reveal is scroll-driven CSS, so without JavaScript a section still
    // appears once the reader scrolls to it.
    await staticPage.locator(".learn-feature").first().scrollIntoViewIfNeeded();
    await staticPage.waitForTimeout(300);
    assert.equal(
        await staticPage.locator(".learn-feature").first().evaluate((element) => getComputedStyle(element).opacity),
        "1",
    );
    await staticPage.close();
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
