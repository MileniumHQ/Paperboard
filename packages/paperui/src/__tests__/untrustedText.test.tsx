import { describe, expect, test } from "vitest";
import { render } from "@solidjs/testing-library";
import { PaperCode, PaperEditor, PaperMarkdown } from "../index";

// what a browser's URL parser makes of an href: tab and newline removed
// anywhere, C0 controls and spaces trimmed from both ends
const browserScheme = (href: string) =>
    href.replace(/[\t\n\r]/g, "").replace(/^[\x00-\x20]+|[\x00-\x20]+$/g, "").toLowerCase();

function markdown(text: string, options: { allowHtml?: boolean; allowImages?: boolean } = {}) {
    return render(() => <PaperMarkdown text={text} {...options} />).container;
}

// nothing in the rendered tree that runs: no script-bearing element, no
// event handler attribute, no javascript: target
function expectInert(root: Element) {
    expect(root.querySelectorAll("script, style, iframe, object, embed").length).toBe(0);
    for (const el of root.querySelectorAll("*")) {
        for (const attr of el.attributes) expect(attr.name.startsWith("on"), `${el.tagName} ${attr.name}`).toBe(false);
    }
    for (const a of root.querySelectorAll("a")) {
        expect(browserScheme(a.getAttribute("href") ?? "")).not.toMatch(/^(javascript|vbscript|data):/);
    }
}

const DISGUISED = [
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "java\tscript:alert(1)",
    "java\nscript:alert(1)",
    "\u0001javascript:alert(1)",
    " \u0000javascript:alert(1)",
];

// Inventory: Content, files and console — Rendered text never runs code.
describe("untrusted text renders inert", () => {
    test("javascript: links render as plain text, however the scheme is disguised", () => {
        for (const href of DISGUISED) {
            const md = markdown(`[click me](<${href}>)`);
            expect(md.textContent).toContain("click me");
            expect(md.querySelectorAll("a").length, JSON.stringify(href)).toBe(0);
            expectInert(md);

            const html = markdown(`<p><a href="${href.replace(/\t/g, "&#9;").replace(/\n/g, "&#10;")}">click html</a></p>`, { allowHtml: true });
            expect(html.textContent).toContain("click html");
            expect(html.querySelectorAll("a").length, JSON.stringify(href)).toBe(0);
            expectInert(html);
        }
        // a safe link still links
        expect(markdown("[docs](https://paperboard.dev)").querySelector("a")?.getAttribute("href")).toBe("https://paperboard.dev");
    });

    test("raw HTML shows as its source by default", () => {
        const root = markdown('Hello <b onclick="steal()">bold</b>\n\n<script>window.ran = true</script>');
        expect(root.querySelector("b, strong, script")).toBeNull();
        expect(root.textContent).toContain('<b onclick="steal()">');
        expect(root.textContent).toContain("<script>window.ran = true</script>");
        expectInert(root);
    });

    test("allowHtml rebuilds formatting with no scripts, styles, frames, handlers or javascript: targets", () => {
        const root = markdown(
            [
                '<p align="center" style="color:red" onclick="steal()"><b onmouseover="steal()">Bold</b> <a href="javascript:alert(1)" onclick="steal()">bad link</a> <a href="https://modrinth.com" onclick="steal()">good link</a></p>',
                "<script>window.ran = true</script>",
                "<style>body { display: none }</style>",
                '<iframe src="https://www.youtube.com/embed/x" onload="steal()"></iframe>',
            ].join("\n\n"),
            { allowHtml: true },
        );
        expectInert(root);
        expect(root.querySelector("strong")?.textContent).toBe("Bold");
        expect(root.textContent).toContain("bad link");
        expect(root.textContent).not.toContain("window.ran");
        expect(root.textContent).not.toContain("display: none");
        expect([...root.querySelectorAll("a")].map((a) => a.getAttribute("href"))).toEqual([
            "https://modrinth.com",
            // the frame becomes a link to what it embeds
            "https://www.youtube.com/embed/x",
        ]);
        expect(root.querySelector("[style*='red']")).toBeNull();

        const inline = markdown('Text <svg onload="steal()"><script>window.ran = true</script></svg> more', { allowHtml: true });
        expect(inline.querySelector("svg")).toBeNull();
        expectInert(inline);
    });

    test("images stay hidden unless allowImages", () => {
        const text = '![server banner](https://cdn.example/banner.png)\n\n<img src="https://cdn.example/b.png" alt="html banner" onerror="steal()">';
        const hidden = markdown(text, { allowHtml: true });
        expect(hidden.querySelector("img")).toBeNull();
        expect(hidden.textContent).toContain("server banner");
        expect(hidden.textContent).toContain("html banner");

        const shown = markdown(text, { allowHtml: true, allowImages: true });
        expect([...shown.querySelectorAll("img")].map((img) => img.getAttribute("src"))).toEqual([
            "https://cdn.example/banner.png",
            "https://cdn.example/b.png",
        ]);
        expectInert(shown);
        // a data: or javascript: image never loads, even when images are allowed
        expect(markdown("![x](data:image/png;base64,AAAA)\n\n![y](javascript:alert(1))", { allowImages: true }).querySelector("img")).toBeNull();
    });

    test("editor and code highlighting escape file text", () => {
        const file = '<img src=x onerror="window.ran = true">\n<script>window.ran = true</script>\nconst a = "<b>";';
        for (const language of ["markup", "javascript", "yaml", "text", undefined]) {
            const editor = render(() => <PaperEditor value={file} language={language} />).container;
            expect(editor.querySelector("img, script, b"), String(language)).toBeNull();
            expectInert(editor);
            const lines = [...editor.querySelectorAll("[aria-hidden='true']")].map((line) => line.textContent).join("\n");
            expect(lines).toContain('<img src=x onerror="window.ran = true">');

            const code = render(() => (
                <PaperCode block language={language}>
                    {file}
                </PaperCode>
            )).container;
            expect(code.querySelector("img, script, b"), String(language)).toBeNull();
            expectInert(code);
            expect(code.querySelector("pre")?.textContent).toContain("<script>window.ran = true</script>");
        }
    });
});
