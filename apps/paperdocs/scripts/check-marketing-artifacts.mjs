import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
const dist = new URL("../dist/", import.meta.url);
const read = (name) => readFile(new URL(name, dist), "utf8");
// Whitespace is collapsed before matching so a disclaimer sentence that the
// JSX compiler wraps across source lines still matches as one string.
const flatten = (html) => html.replace(/\s+/g, " ");
const sitemap = await read("sitemap.xml");

// Each marketing page's footer disclaims the trademarks its own copy names
// (src/site/trademarks.ts), so the notice differs from page to page.
const INDEPENDENT = "Paperboard is an independent project. It is not affiliated with, endorsed by, or sponsored by";
const notice = (html) => {
    const start = html.indexOf('<div class="site-footer__legal">');
    return start < 0 ? "" : html.slice(start, html.indexOf("</div>", start));
};
function assertNotice(name, html, { owners, absent = [] }) {
    const legal = notice(html);
    assert.ok(!legal.includes(".."), `${name}'s notice must not double a full stop`);
    assert.ok(legal.includes(INDEPENDENT), `${name} must say Paperboard is independent`);
    for (const owner of owners) assert.ok(legal.includes(owner), `${name} must disclaim ${owner}`);
    for (const owner of absent) assert.ok(!legal.includes(owner), `${name} names no ${owner} product, so it must not disclaim one`);
}
const NOTICES = {
    landing: { owners: ["Mojang Studios, Microsoft, Re-Logic, Pocketpair, Valve, or Discord Inc."], absent: ["Anthropic", "Rinth, Inc."] },
    "game-server": { owners: ["Mojang Studios", "Re-Logic", "Pocketpair", "Valve", "Rinth, Inc."], absent: ["Discord Inc.", "Anthropic"] },
    "bot-creator": { owners: ["Discord Inc."], absent: ["Mojang Studios", "Valve"] },
    agents: { owners: ["OpenAI", "Anthropic", "Anomaly"], absent: ["Valve", "Discord Inc."] },
    actions: { owners: ["Discord Inc."], absent: ["Mojang Studios", "Valve"] },
};

const landing = flatten(await read("index.html"));
assertNotice("the landing page", landing, NOTICES.landing);
assert.ok(
    landing.includes("Minecraft, Terraria, Palworld, Team Fortress 2, and Discord are trademarks of their respective owners."),
    "the landing page must name the trademarks it disclaims",
);

// The docs use their own footer (src/components/Footer.tsx); the notice
// belongs to the marketing footer only.
const docs = flatten(await read("docs/index.html"));
assert.ok(!docs.includes(INDEPENDENT), "the docs pages must not carry the marketing notice");

// The decorative heading, button, and overlay elements must be defined in
// the head, so they render as the parser creates them instead of painting
// their fallbacks first and swapping in after the body has loaded.
const ELEMENT_SCRIPTS = ["/js/bg-overlay.js", "/js/styled-text.js", "/js/paper-button.js"];
function assertElementsInHead(name, raw) {
    const head = raw.slice(0, raw.indexOf("<body"));
    for (const script of ELEMENT_SCRIPTS) {
        assert.ok(head.includes(`<script src="${script}"></script>`), `${name} must define ${script} in its head`);
    }
}
assertElementsInHead("the landing", await read("index.html"));

// Images reserve their box before they load (no layout shift), only the one
// largest above-the-fold screenshot is fetched eagerly at high priority, and
// every responsive copy a page offers is in the build.
async function assertImages(name, raw) {
    // The lightbox <img> has no source until a screenshot opens in it.
    const images = (raw.match(/<img\b[^>]*>/g) || []).filter((img) => /\ssrc="/.test(img));
    assert.ok(images.length > 0, `${name} renders images`);
    for (const img of images) {
        assert.match(img, /\swidth="\d+"/, `${name}: every image declares its width: ${img}`);
        assert.match(img, /\sheight="\d+"/, `${name}: every image declares its height: ${img}`);
    }
    const priority = images.filter((img) => img.includes('fetchpriority="high"'));
    assert.equal(priority.length, 1, `${name} prioritizes exactly one image`);
    assert.ok(!priority[0].includes('loading="lazy"'), `${name}'s priority image is not lazy`);
    // Screenshots and device renders are the large images: only the one
    // above the fold may load before the reader scrolls to the rest.
    const large = images.filter((img) => /marketing-(screenshot|render)/.test(img));
    assert.ok(
        large.filter((img) => !img.includes('loading="lazy"')).length === 1,
        `${name} loads only its first screenshot or render eagerly`,
    );
    for (const match of raw.matchAll(/\ssrcset="([^"]+)"/g)) {
        for (const candidate of match[1].split(",")) {
            const url = candidate.trim().split(/\s+/)[0];
            assert.ok(url.startsWith("/img/") && url.endsWith(".webp"), `${name}: srcset offers WebP copies (${url})`);
            await readFile(new URL(`.${url}`, dist));
        }
    }
}
await assertImages("the landing", await read("index.html"));

// The landing is static: no WebGL stage, models or scroll choreography ship,
// so it renders the same on every browser, screen and GPU.
{
    const raw = await read("index.html");
    for (const gone of ["three", "aio-stage", "flight.js", "card-scroll.js", "dots-bar.js", "cta.js", "data-reveal", "<canvas", "importmap"]) {
        assert.ok(!raw.includes(gone), `the landing must not ship ${gone}`);
    }
    for (const name of ["hero", "laptop", "mini-pc", "dev-board", "desktop"]) {
        assert.ok(raw.includes(`/renders/${name}.png`), `the landing shows the ${name} render`);
    }
    for (const dir of ["models", "js/vendor"]) {
        await readdir(new URL(`${dir}/`, dist)).then(
            () => assert.fail(`dist/${dir} must not ship: the models render offline (scripts/renders/)`),
            (error) => assert.equal(error.code, "ENOENT"),
        );
    }
}

// A learn page that moved leaves a redirect behind, out of the sitemap, so
// old links still land on the panel.
{
    const moved = await read("ai/index.html");
    assert.ok(moved.includes('content="0; url=/agents/"'), "/ai/ redirects to /agents/");
    assert.ok(!moved.includes('class="learn-page"'), "/ai/ is no longer a page of its own");
    assert.ok(!sitemap.includes("https://paperboard.dev/ai/"), "/ai/ is not in the sitemap");
}

for (const slug of ["actions", "game-server", "bot-creator", "agents"]) {
    const raw = await read(`${slug}/index.html`);
    assertElementsInHead(slug, raw);
    await assertImages(slug, raw);
    const html = flatten(raw);
    assert.ok(raw.includes('class="learn-page"'), `${slug} must render its marketing page`);
    assert.equal((html.match(/<h1\b/g) || []).length, 1, `${slug} needs one semantic headline`);
    assert.ok(
        !html.includes("learn-kicker") && !html.includes("learn-eyebrow"),
        `${slug} omits editorial labels`,
    );
    assert.ok(html.includes('href="/css/learn.css"'), `${slug} needs its styles`);
    assert.ok(!html.includes("learn-reveal.js"), `${slug} must not hide content behind a reveal script`);
    assert.ok(html.includes('src="/js/learn-lightbox.js"'), `${slug} needs full-screen screenshots`);
    assert.ok(!html.includes('src="/js/card-scroll.js"'), `${slug} must not capture scrolling`);
    assertNotice(slug, html, NOTICES[slug]);
    assert.ok(
        html.includes(`href="https://paperboard.dev/${slug}/"`),
        `${slug} needs its own canonical URL`,
    );
    assert.ok(
        sitemap.includes(`<loc>https://paperboard.dev/${slug}/</loc>`),
        `${slug} must be in the sitemap`,
    );
    for (const match of raw.matchAll(/(?:src|href)="(\/(?:screens|css|js|html)\/[^"#?]+)"/g)) {
        await readFile(new URL(`.${match[1]}`, dist));
    }
}
// Every image a docs page points at is in the build: a section logo or icon
// that 404s shows as a broken image in the top bar.
async function docsPages(dir) {
    const pages = [];
    for (const entry of await readdir(new URL(dir, dist), { withFileTypes: true })) {
        if (entry.isDirectory()) pages.push(...(await docsPages(`${dir}${entry.name}/`)));
        else if (entry.name === "index.html") pages.push(`${dir}${entry.name}`);
    }
    return pages;
}
for (const page of await docsPages("docs/")) {
    const raw = await read(page);
    for (const match of raw.matchAll(/<img\b[^>]*\ssrc="(\/[^"#?]+)"/g)) {
        await readFile(new URL(`.${match[1]}`, dist)).catch(() => {
            throw new Error(`${page} shows ${match[1]}, which is not in the build`);
        });
    }
}

console.log("verified the landing, learn and docs documents, their disclaimers, published assets, metadata, and scroll scripts");
