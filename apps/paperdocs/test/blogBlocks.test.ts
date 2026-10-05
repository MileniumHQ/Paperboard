import { describe, expect, test } from "bun:test";
import { parsePostBlocks } from "../src/site/blogBlocks";

describe("post carousels", () => {
    test("a carousel block splits the markdown around it", () => {
        const blocks = parsePostBlocks(
            [
                "Before.",
                "",
                ":::carousel",
                '![Game Server](/screens/gameserver.png "Host a server.")',
                "",
                '![Bot Creator](https://paperboard.dev/b.png "Build a bot.")',
                ":::",
                "",
                "After.",
            ].join("\n"),
            "post.md",
        );

        expect(blocks).toEqual([
            { kind: "markdown", text: "Before." },
            {
                kind: "carousel",
                slides: [
                    { alt: "Game Server", src: "/screens/gameserver.png", caption: "Host a server." },
                    { alt: "Bot Creator", src: "https://paperboard.dev/b.png", caption: "Build a bot." },
                ],
            },
            { kind: "markdown", text: "After." },
        ]);
    });

    test("a carousel marker inside a code fence stays code", () => {
        const body = "```md\n:::carousel\n![a](/a.png \"A\")\n:::\n```";
        expect(parsePostBlocks(body, "post.md")).toEqual([
            { kind: "markdown", text: body },
        ]);
    });

    test("a malformed carousel fails the build with its location", () => {
        expect(() =>
            parsePostBlocks(':::carousel\n![a](/a.png "A")\n![b](/b.png "B")', "post.md"),
        ).toThrow("post.md:1 carousel is missing its closing :::");
        expect(() =>
            parsePostBlocks(':::carousel\n![a](/a.png "A")\nsome text\n:::', "post.md"),
        ).toThrow("post.md:3 carousel lines");
        // every slide needs alt text and a caption
        expect(() =>
            parsePostBlocks(':::carousel\n![a](/a.png "A")\n![](/b.png "B")\n:::', "post.md"),
        ).toThrow("post.md:3 carousel lines");
        expect(() =>
            parsePostBlocks(':::carousel\n![a](/a.png "A")\n![b](/b.png)\n:::', "post.md"),
        ).toThrow("post.md:3 carousel lines");
        expect(() =>
            parsePostBlocks(':::carousel\n![a](/a.png "A")\n![b](javascript:alert(1) "B")\n:::', "post.md"),
        ).toThrow("post.md:3 carousel lines");
        expect(() =>
            parsePostBlocks(':::carousel\n![a](/a.png "A")\n:::', "post.md"),
        ).toThrow("post.md:1 a carousel needs at least two slides");
    });
});
