import { describe, expect, test } from "bun:test";
// @ts-expect-error: plain ESM build script without types
import { docsPageMarkdown, firstSentence, markdownPath } from "../scripts/docs-markdown.mjs";

const page = (body: string) =>
    `<div id="docs-root"><nav>Sidebar</nav><article class="docs-article">${body}</article></div>`;

describe("docs Markdown export", () => {
    test("headings, lead, code language, tables, lists and links", () => {
        const { title, description, markdown } = docsPageMarkdown(
            page(`
                <h1 data-preset="header">secretsApi</h1>
                <p data-preset="body">Stores credentials for a panel. Second sentence here.</p>
                <h2 data-preset="subheader" id="usage">Usage<button>Copy link</button></h2>
                <div><button>Copy code</button><pre data-language="tsx"><code><span class="token">const</span> a = 1;</code></pre></div>
                <table><thead><tr><th>Method</th><th>Returns</th></tr></thead>
                <tbody><tr><td><code>get</code></td><td>string | null</td></tr></tbody></table>
                <ul><li>One</li><li>Two <a href="/docs/paperui/">PaperUI</a></li></ul>`),
            "/docs/x/",
        );
        expect(title).toBe("secretsApi");
        expect(description).toBe("Stores credentials for a panel.");
        expect(markdown).toBe(
            [
                "# secretsApi",
                "Stores credentials for a panel. Second sentence here.",
                "## Usage",
                "```tsx\nconst a = 1;\n```",
                "| Method | Returns |\n| --- | --- |\n| `get` | string \\| null |",
                "- One\n- Two [PaperUI](https://paperboard.dev/docs/paperui/)",
            ].join("\n\n") + "\n",
        );
    });

    test("live demos and hidden icons are left out", () => {
        const { markdown } = docsPageMarkdown(
            page(`<h1>Title</h1><p>Lead.</p>
                <div data-docs-demo><span>Button</span></div>
                <span aria-hidden="true">north_east</span><p>After.</p>`),
            "/docs/x/",
        );
        expect(markdown).not.toContain("Button");
        expect(markdown).not.toContain("north_east");
        expect(markdown).toContain("After.");
    });

    test("a page without one h1 or without a lead fails the build", () => {
        expect(() => docsPageMarkdown(page("<p>No title.</p>"), "/docs/a/")).toThrow(/exactly one <h1>/);
        expect(() => docsPageMarkdown(page("<h1>T</h1><h2>Next</h2>"), "/docs/b/")).toThrow(/no lead/);
        expect(() => docsPageMarkdown("<div></div>", "/docs/c/")).toThrow(/no <article>/);
    });

    test("descriptions and paths", () => {
        expect(firstSentence("Run `papercrane` on a server. Then pair it.")).toBe("Run papercrane on a server.");
        expect(markdownPath("/docs/paperapi/secrets/")).toBe("/docs/paperapi/secrets.md");
    });
});
