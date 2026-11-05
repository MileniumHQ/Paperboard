import { describe, it, expect } from "vitest";
import { render } from "@solidjs/testing-library";
import { PaperMarkdown } from "../components/PaperMarkdown";

describe("PaperMarkdown", () => {
    it("renders structure through PaperUI elements, not innerHTML", () => {
        const { container } = render(() => (
            <PaperMarkdown
                text={"# Title\n\nSome **bold** and *italic* text with `code`.\n\n- one\n- two\n\n> quoted\n\n```ts\nconst x = 1;\n```"}
            />
        ));

        expect(container.querySelector("h1")?.textContent).toContain("Title");
        expect(container.querySelector("strong")?.textContent).toBe("bold");
        expect(container.querySelector("em")?.textContent).toBe("italic");
        expect(container.querySelector("code")?.textContent).toContain("code");
        expect(container.querySelectorAll("li")).toHaveLength(2);
        expect(
            container.querySelector('[class*="PaperQuote"]')?.textContent,
        ).toContain("quoted");
        expect(container.querySelector("pre")?.textContent).toContain(
            "const x = 1;",
        );
    });

    it("renders links but refuses a javascript: href", () => {
        const { getByText, container } = render(() => (
            <PaperMarkdown
                text={"[safe](https://example.com) and [bad](javascript:alert(1))"}
            />
        ));

        const safe = getByText("safe");
        expect(safe.getAttribute("href")).toBe("https://example.com");
        expect(container.querySelector("a[href^='javascript']")).toBeNull();
        const anchors = container.querySelectorAll("a");
        expect(anchors).toHaveLength(1);
        expect(container.textContent).toContain("bad");
    });

    it("refuses a javascript: href hidden by characters the URL parser strips", () => {
        // marked keeps tabs and C0 controls inside <...> destinations; the
        // browser drops them before reading the scheme
        const { container } = render(() => (
            <PaperMarkdown
                text={"[tab](<java\tscript:alert(1)>) [ctl](<\u0001javascript:alert(1)>) [nl](<java\nscript:alert(1)>) [ok](/docs)"}
            />
        ));

        const anchors = [...container.querySelectorAll("a")];
        expect(anchors.map((a) => a.textContent)).toEqual(["ok"]);
        expect(container.textContent).toContain("tab");
        expect(container.textContent).toContain("ctl");
    });

    it("hides images unless the caller allows them", () => {
        const blocked = render(() => (
            <PaperMarkdown text={"![alt text](https://example.com/a.png)"} />
        ));
        expect(blocked.container.querySelector("img")).toBeNull();
        expect(blocked.getByText("alt text")).toBeTruthy();

        const allowed = render(() => (
            <PaperMarkdown
                allowImages
                text={"![alt text](https://example.com/a.png)"}
            />
        ));
        const img = allowed.container.querySelector("img");
        expect(img?.getAttribute("src")).toBe("https://example.com/a.png");
    });

    it("captions a titled image that stands alone in its paragraph", () => {
        const { container } = render(() => (
            <PaperMarkdown
                allowImages
                text={'![The panel](/a.png "Setting up a server")\n\nSee ![inline](/b.png "Tooltip") here.'}
            />
        ));

        const figures = container.querySelectorAll("figure");
        expect(figures).toHaveLength(1);
        const figure = figures[0];
        expect(figure.querySelector("img")?.getAttribute("alt")).toBe(
            "The panel",
        );
        expect(figure.querySelector("img")?.hasAttribute("title")).toBe(false);
        expect(figure.querySelector("figcaption")?.textContent).toBe(
            "Setting up a server",
        );
        // an image inside running text keeps its title as a tooltip
        const inline = container.querySelector('img[alt="inline"]');
        expect(inline?.closest("figure")).toBeNull();
        expect(inline?.getAttribute("title")).toBe("Tooltip");
    });

    it("never captions an image the caller did not allow", () => {
        const { container } = render(() => (
            <PaperMarkdown text={'![The panel](/a.png "Setting up a server")'} />
        ));

        expect(container.querySelector("figure")).toBeNull();
        expect(container.querySelector("img")).toBeNull();
        expect(container.textContent).toContain("The panel");
    });

    it("never renders raw HTML as markup", () => {
        const { container, getByText } = render(() => (
            <PaperMarkdown text={"<script>alert(1)</script>"} />
        ));

        expect(container.querySelector("script")).toBeNull();
        expect(getByText("<script>alert(1)</script>")).toBeTruthy();
    });

    it("renders tables through PaperTable", () => {
        const { container } = render(() => (
            <PaperMarkdown
                text={"| a | b |\n| - | - |\n| 1 | 2 |"}
            />
        ));

        expect(container.querySelector("table")).toBeTruthy();
        expect(container.querySelectorAll("th")).toHaveLength(2);
        expect(container.querySelectorAll("td")).toHaveLength(2);
    });

    it("renderImage draws the images it wants, any scheme, alone in a paragraph as a block; the rest fall back", () => {
        const seen: unknown[] = [];
        const { container } = render(() => (
            <PaperMarkdown
                text={"![a cat](attachment:abc123 \"Rex\")\n\ninline ![dot](attachment:def456) here\n\n![web](https://x.test/a.png)"}
                renderImage={(img) => {
                    seen.push(img);
                    if (!img.src.startsWith("attachment:")) return undefined;
                    return <video data-src={img.src} aria-label={img.alt} />;
                }}
            />
        ));
        expect(seen).toEqual([
            { src: "attachment:abc123", alt: "a cat", title: "Rex", block: true },
            { src: "attachment:def456", alt: "dot", title: null, block: false },
            { src: "https://x.test/a.png", alt: "web", title: null, block: true },
            { src: "https://x.test/a.png", alt: "web", title: null, block: false },
        ]);
        const videos = container.querySelectorAll("video");
        expect([...videos].map((v) => v.getAttribute("data-src"))).toEqual(["attachment:abc123", "attachment:def456"]);
        // the block one replaces its paragraph; the inline one stays in its sentence
        expect(videos[0]!.closest("p")).toBeNull();
        expect(videos[1]!.closest("p")?.textContent).toContain("inline");
        // without allowImages, a fallen-back image is still only its alt text
        expect(container.querySelector("img")).toBeNull();
        expect(container.textContent).toContain("web");
    });

    describe("allowHtml", () => {
        // the shape of a real Modrinth project body: HTML blocks between Markdown
        const body = [
            '<h2 align="center">Fast <b>Chunks</b></h2>',
            "",
            '<p align="center"><a href="https://modrinth.com/mod/x"><img src="https://cdn.modrinth.com/badge.png" alt="Badge" width="120" height="x"></a> &amp; friends</p>',
            "",
            "Plain **Markdown** with an <b>inline</b> tag and a<br>break.",
            "",
            "<ul>",
            "<li>first",
            "<li>second</li>",
            "</ul>",
            "",
            '<div onclick="alert(1)" style="color: red"><script>alert(1)</script><style>p { color: red }</style><!-- note -->Kept text</div>',
            "",
            '<a href="javascript:alert(1)">bad link</a> <iframe src="https://www.youtube.com/embed/abc"></iframe>',
        ].join("\n");

        it("draws HTML as PaperUI elements, with nothing that runs or styles", () => {
            const { container, getByText } = render(() => <PaperMarkdown text={body} allowHtml allowImages />);

            expect(container.textContent).not.toContain("<");
            expect(container.querySelector("h2")?.textContent).toBe("Fast Chunks");
            expect(container.querySelector("h2 strong")?.textContent).toBe("Chunks");
            expect(container.querySelector("h2")?.hasAttribute("align")).toBe(false);

            const badge = container.querySelector("img")!;
            expect(badge.getAttribute("src")).toBe("https://cdn.modrinth.com/badge.png");
            expect(badge.getAttribute("width")).toBe("120");
            expect(badge.hasAttribute("height")).toBe(false);
            expect(badge.closest("a")?.getAttribute("href")).toBe("https://modrinth.com/mod/x");
            expect(container.textContent).toContain("& friends");

            expect(getByText("inline").tagName).toBe("STRONG");
            expect(getByText("Markdown").tagName).toBe("STRONG");
            expect(container.querySelector("p br")).not.toBeNull();

            const items = [...container.querySelectorAll("li")].map((li) => li.textContent?.trim());
            expect(items).toEqual(["first", "second"]);

            expect(container.querySelector("script, style, iframe, [onclick], [style*='red']")).toBeNull();
            expect(container.textContent).not.toContain("alert");
            expect(container.textContent).not.toContain("note");
            expect(container.textContent).toContain("Kept text");

            expect(container.querySelector("a[href^='javascript']")).toBeNull();
            expect(container.textContent).toContain("bad link");
            expect(container.querySelector("a[href='https://www.youtube.com/embed/abc']")).not.toBeNull();
        });

        it("keeps an image's height when it gives no width", () => {
            const { container } = render(() => (
                <PaperMarkdown text={'<img src="https://cdn.modrinth.com/b.webp" alt="Badge" height="42">'} allowHtml allowImages />
            ));
            const image = container.querySelector("img")!;
            expect(image.style.height).toBe("42px");
            expect(image.style.width).toBe("auto");
        });

        it("still hides images the caller did not allow", () => {
            const { container } = render(() => <PaperMarkdown text={body} allowHtml />);
            expect(container.querySelector("img")).toBeNull();
            expect(container.textContent).toContain("Badge");
        });

        it("is off by default: HTML shows as its source", () => {
            const { container } = render(() => <PaperMarkdown text={'<h2 align="center">Title</h2>'} />);
            expect(container.querySelector("h2")).toBeNull();
            expect(container.textContent).toContain('<h2 align="center">Title</h2>');
        });
    });
});
