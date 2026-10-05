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
});
