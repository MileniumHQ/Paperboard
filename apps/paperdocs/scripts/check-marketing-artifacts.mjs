import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const dist = new URL("../dist/", import.meta.url);
const read = (name) => readFile(new URL(name, dist), "utf8");
// Whitespace is collapsed before matching so a disclaimer sentence that the
// JSX compiler wraps across source lines still matches as one string.
const flatten = (html) => html.replace(/\s+/g, " ");
const sitemap = await read("sitemap.xml");

const MINECRAFT_DISCLAIMER =
    "It is not affiliated with, endorsed by, or sponsored by Mojang Studios, Microsoft, or Minecraft.";
const DISCORD_DISCLAIMER =
    "Paperboard is not affiliated with, endorsed by, or sponsored by Discord Inc.";

const landing = flatten(await read("index.html"));
assert.ok(
    landing.includes(MINECRAFT_DISCLAIMER),
    "the landing page must disclaim Minecraft affiliation",
);
assert.ok(
    landing.includes(DISCORD_DISCLAIMER),
    "the landing page must disclaim Discord affiliation",
);

// The docs use their own footer (src/components/Footer.tsx); the disclaimers
// belong to the marketing footer only.
const docs = flatten(await read("docs/index.html"));
assert.ok(
    !docs.includes(MINECRAFT_DISCLAIMER) && !docs.includes(DISCORD_DISCLAIMER),
    "the docs pages must not carry the marketing disclaimers",
);

for (const slug of ["actions", "game-server", "bot-creator", "ai"]) {
    const raw = await read(`${slug}/index.html`);
    const html = flatten(raw);
    assert.ok(raw.includes('class="learn-page"'), `${slug} must render its marketing page`);
    assert.equal((html.match(/<h1\b/g) || []).length, 1, `${slug} needs one semantic headline`);
    assert.ok(
        !html.includes("learn-kicker") && !html.includes("learn-eyebrow"),
        `${slug} omits editorial labels`,
    );
    assert.ok(html.includes('href="/css/learn.css"'), `${slug} needs its styles`);
    assert.ok(html.includes('src="/js/learn-reveal.js"'), `${slug} needs ordinary scroll reveals`);
    assert.ok(html.includes('src="/js/learn-lightbox.js"'), `${slug} needs full-screen screenshots`);
    assert.ok(!html.includes('src="/js/card-scroll.js"'), `${slug} must not capture scrolling`);
    assert.ok(
        html.includes(MINECRAFT_DISCLAIMER),
        `${slug} must disclaim Minecraft affiliation`,
    );
    assert.ok(
        html.includes(DISCORD_DISCLAIMER),
        `${slug} must disclaim Discord affiliation`,
    );
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
console.log("verified the landing and learn documents, their disclaimers, published assets, metadata, and scroll scripts");
