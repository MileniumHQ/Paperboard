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
