// A project's card on home shows its canvas in miniature (real browser, the
// whole panel over the real service: test/fixtures/projectsFixture.tsx).
import { expect, test } from "bun:test";
import { browserFixture } from "./browserFixture";

test(
    "a project's card draws each block of its flow whole, in the colour the block has on the canvas",
    async () => {
        const { checks, error } = await browserFixture("projects");
        expect(error, "the fixture threw").toBe("");
        expect(checks.uncaught, "the panel threw").toEqual([]);
        // When Run is clicked, the Log in it, and the text typed into Log
        expect(checks.onCanvas).toHaveLength(3);
        expect(checks.onCard).toEqual(checks.onCanvas);
        // none is cut by the card's frame: the hat's curve on top included
        expect(checks.outside).toBe(0);
        // a block dropped into another just before the editor closed is drawn where it landed
        expect(checks.nested).toBe(true);
    },
    180_000,
);
