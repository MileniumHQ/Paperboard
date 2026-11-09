// @vitest-environment node
import { randomUUID } from "node:crypto";
import { describe, expect, test } from "vitest";
import { type Page, useBrowser } from "./support/chrome";

const browser = useBrowser();
let page: Page;

const PLAY = 'button[aria-label="Play"]';
const ALERT = '[role="alert"]';
const alertText = () => page.eval<string | null>(`document.querySelector('${ALERT}')?.textContent ?? null`);
const retry = () => page.eval(`[...document.querySelectorAll('${ALERT} button')].find((b) => b.textContent.includes("Retry")).click()`);
const loaded = () =>
    page.waitFor(`document.querySelector("audio").readyState >= 1 && !document.querySelector('${ALERT}')`, "the clip to load");

// Inventory: Content, files and console — Failures are shown, not swallowed (PaperAudio).
describe("PaperAudio failures", () => {
    test("a refused play() is shown with Retry and reported to onError", async () => {
        page = await browser.open("audio", { query: "src=/audio/tone.wav" });
        await loaded();

        // a script press carries no user activation: Chrome refuses to play
        await page.eval(`document.querySelector('${PLAY}').click()`);
        await page.waitFor(`document.querySelector('${ALERT}')`, "the refusal to show");
        expect(await alertText()).toContain("Playback blocked");
        expect(await page.eval("t.errors")).toEqual(["Playback blocked"]);
        expect(await page.eval(`document.querySelector('${PLAY}').disabled`)).toBe(true);

        await retry();
        await loaded();
        expect(await page.eval(`document.querySelector('${PLAY}').disabled`)).toBe(false);
    });

    test("a media error is shown with a Retry that loads the clip again", async () => {
        page = await browser.open("audio", { query: `src=${encodeURIComponent(`/audio/flaky.wav?id=${randomUUID()}`)}` });
        await page.waitFor(`document.querySelector('${ALERT}')`, "the load failure to show");
        expect(await alertText()).toContain("Can't load audio");
        expect(await page.eval("t.errors")).toEqual(["Can't load audio"]);

        await retry();
        await loaded();
        expect(await page.eval("t.errors")).toEqual(["Can't load audio"]);
        expect(await page.eval(`document.querySelector('${PLAY}').disabled`)).toBe(false);
    });
});
