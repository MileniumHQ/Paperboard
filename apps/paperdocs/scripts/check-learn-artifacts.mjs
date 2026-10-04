import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const dist = new URL("../dist/", import.meta.url);
const sitemap = await readFile(new URL("sitemap.xml", dist), "utf8");
for (const slug of ["actions", "game-server", "bot-creator", "ai"]) {
    const html = await readFile(new URL(`${slug}/index.html`, dist), "utf8");
    assert.ok(html.includes('class="learn-page"'), `${slug} must render its marketing page`);
    assert.equal((html.match(/<h1\b/g) || []).length, 1, `${slug} needs one semantic headline`);
    assert.ok(
        !html.includes("learn-kicker") && !html.includes("learn-eyebrow"),
        `${slug} omits editorial labels`,
    );
    assert.ok(html.includes('href="/css/learn.css"'), `${slug} needs its styles`);
    assert.ok(html.includes('src="/js/learn-reveal.js"'), `${slug} needs ordinary scroll reveals`);
    assert.ok(!html.includes('src="/js/card-scroll.js"'), `${slug} must not capture scrolling`);
    assert.ok(
        html.includes(`href="https://paperboard.dev/${slug}/"`),
        `${slug} needs its own canonical URL`,
    );
    assert.ok(
        sitemap.includes(`<loc>https://paperboard.dev/${slug}/</loc>`),
        `${slug} must be in the sitemap`,
    );
    for (const match of html.matchAll(/(?:src|href)="(\/(?:screens|css|js|html)\/[^"#?]+)"/g)) {
        await readFile(new URL(`.${match[1]}`, dist));
    }
}
console.log("verified all learn pages, their published assets, metadata, and scroll scripts");
