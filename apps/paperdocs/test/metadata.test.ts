import { expect, test } from "bun:test";
import { siteMetadata } from "../scripts/site-metadata.mjs";

test("metadata advertises the actual page URL, Paperboard logo, and matching social descriptions", () => {
    const html = siteMetadata({ title: "Minecraft server manager | Paperboard", description: "Manage Minecraft & automate it." }, "/game-server/");
    expect(html).toContain('rel="icon" type="image/png" href="/paperboard.png"');
    expect(html).toContain('property="og:url" content="https://paperboard.dev/game-server/"');
    expect(html).toContain('name="twitter:description" content="Manage Minecraft &amp; automate it."');
    const json = JSON.parse(html.match(/<script type="application\/ld\+json">(.+)<\/script>/)![1]);
    expect(json["@graph"][1].url).toBe("https://paperboard.dev/game-server/");
    expect(json["@graph"][1].description).toBe("Manage Minecraft & automate it.");
    expect(html).not.toContain('name="robots"');
    expect(siteMetadata({ title: "Not found", description: "No page" }, "/404.html")).toContain('content="noindex"');
});

test("metadata escapes HTML without corrupting structured data", () => {
    const html = siteMetadata({ title: '</script><script>alert("x")</script>', description: '"quoted" & useful' }, "/ai/");
    expect(html).not.toContain('</script><script>');
    const json = JSON.parse(html.match(/<script type="application\/ld\+json">(.+)<\/script>/)![1]);
    expect(json["@graph"][1].name).toContain('</script>');
});

test("a page with its own image shares it as a large social card", () => {
    const html = siteMetadata({ title: "Beta 1", description: "Out now", image: { src: "/pictures/blog/beta-1/hero.png", alt: "Beta 1" } }, "/blog/beta-1/");
    expect(html).toContain('property="og:image" content="https://paperboard.dev/pictures/blog/beta-1/hero.png"');
    expect(html).toContain('name="twitter:image" content="https://paperboard.dev/pictures/blog/beta-1/hero.png"');
    expect(html).toContain('name="twitter:card" content="summary_large_image"');
    expect(html).toContain('property="og:type" content="article"');
    expect(html).not.toContain('og:image:width');
    expect(siteMetadata({ title: "x", description: "y" }, "/")).toContain('name="twitter:card" content="summary"');
});
