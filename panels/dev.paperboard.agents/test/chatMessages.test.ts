// What goes into and out of a message, in the real chat (real browser):
// pressing Send sends once, a YouTube link's thumbnail comes through the
// service, and a slow history never puts another conversation in the chat. The chat runs over a stubbed service (fixtures/chatMessages.tsx).
import { describe, expect, test } from "bun:test";
import { runBrowserFixture, type FixtureResults } from "./browserFixture";

let results: Promise<FixtureResults> | undefined;
const fixture = async () => {
    results ??= runBrowserFixture("test/fixtures/chatMessages.html", { "@mileniumhq/paperapi": "test/fixtures/paperapiStub.ts" });
    const { checks, error } = await results;
    expect(error, "the fixture threw").toBe("");
    return checks;
};

const TIMEOUT = 180_000;

describe("a message", () => {
    test(
        "pressed twice, and Ctrl+Enter on top, is sent once, and what was typed meanwhile stays in the box",
        async () => {
            const { afterSend, uncaught } = await fixture();
            expect(afterSend.sends, "the message was sent more than once").toBe(1);
            expect(afterSend.text).toBe("Find me a recipe");
            expect(afterSend.left).toBe("and a wine");
            expect(uncaught).toEqual([]);
        },
        TIMEOUT,
    );

    test(
        "a YouTube link shows its thumbnail as the service fetched it, and the page asks YouTube for nothing",
        async () => {
            const { youTube, uncaught } = await fixture();
            expect(youTube.fetched).toEqual(["https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg"]);
            expect(youTube.src).toBe("blob");
            expect(youTube.link).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
            expect(youTube.askedYouTube).toEqual([]);
            expect(uncaught).toEqual([]);
        },
        TIMEOUT,
    );

    test(
        "switched twice, the chat shows the last conversation, even when the first one's history answers last",
        async () => {
            const { switched, uncaught } = await fixture();
            expect(switched.last, "the last conversation's history is gone").toBe(true);
            expect(switched.first, "the first conversation's late history replaced it").toBe(false);
            expect(uncaught).toEqual([]);
        },
        TIMEOUT,
    );
});
