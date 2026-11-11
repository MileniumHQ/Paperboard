import { describe, expect, test } from "vitest";
import { render } from "@solidjs/testing-library";
import { PaperMarkdown } from "../index";

const anchors = (text: string) =>
    [...render(() => <PaperMarkdown text={text} />).container.querySelectorAll<HTMLElement>("[data-anchor]")].map(
        (el) => el.dataset.anchor,
    );

// a README's links are written against GitHub's slugs, so they must match
describe("PaperMarkdown heading anchors", () => {
    test("headings get GitHub's slugs: lower case, punctuation dropped, markup read as its text, repeats numbered", () => {
        expect(
            anchors(
                [
                    "# Changes and New Works License",
                    "## What's **new** in `v2.0`?",
                    "## Café & Crème",
                    "## snake_case and--hyphens",
                    "## Notices",
                    "## Notices",
                    "> ## Notices",
                    "- ## In a list",
                ].join("\n\n"),
            ),
        ).toEqual([
            "changes-and-new-works-license",
            "whats-new-in-v20",
            "café--crème",
            "snake_case-and--hyphens",
            "notices",
            "notices-1",
            "notices-2",
            "in-a-list",
        ]);
    });

    test("no heading takes a document id from the text", () => {
        const { container } = render(() => <PaperMarkdown text={"## Root\n\n## Main"} />);
        expect(container.querySelectorAll("[id]").length).toBe(0);
    });
});
