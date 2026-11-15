// The setup guide as a person goes through it: each step starts at the top,
// so only the step's body changes, and a token Discord refused is never shown
// as half good.
import { afterAll, afterEach, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import * as fs from "node:fs";
import { panelBrowser, servePanel, type Page } from "./helpers/browser";
import { startFakeDiscord, type FakeDiscord } from "./helpers/discord";
import { savedBots, startService, stopServices } from "./helpers/service";

setDefaultTimeout(60_000);

const browser = panelBrowser();

let discord: FakeDiscord;
beforeAll(() => {
    discord = startFakeDiscord();
});
afterAll(() => discord.stop());
afterEach(stopServices);

// the shown step's heading, by where it sits on the screen
const headingTop = (page: Page) =>
    page.evaluate<{ text: string; top: number }>(`(() => {
        const h = [...document.querySelectorAll("h2")].find((el) => el.getClientRects().length > 0 && el.getBoundingClientRect().left >= 0 && el.getBoundingClientRect().right <= innerWidth + 1);
        return { text: h.innerText, top: Math.round(h.getBoundingClientRect().top) };
    })()`);
const pressButton = (page: Page, text: string) =>
    page.evaluate(`[...document.querySelectorAll("button")].find((b) => b.getClientRects().length > 0 && b.innerText.includes(${JSON.stringify(text)})).click()`);

describe("the setup guide", () => {
    test("keeps every step's heading in one place, and a refused token shows only the refusal", async () => {
        await savedBots([]);
        await startService({ discordApi: discord.api });
        const served = await servePanel();
        const page = await browser.open(served.url);
        try {
            await page.waitFor(`document.body.innerText.includes("Set up your first bot")`, "the guide");
            const titles = ["Make an application", "Open the Bot tab", "Reset the token", "Turn on the intents", "Paste the token"];
            const tops: number[] = [];
            for (const [i, title] of titles.entries()) {
                await page.waitFor(`[...document.querySelectorAll("h2")].some((h) => h.innerText === ${JSON.stringify(title)} && h.getBoundingClientRect().left >= 0 && h.getBoundingClientRect().right <= innerWidth + 1) && [...document.querySelectorAll("img")].every((img) => img.complete)`, `step "${title}"`);
                // the step has slid into place
                await page.evaluate(`Promise.all(document.getAnimations().map((a) => a.finished))`);
                const shown = await headingTop(page);
                expect(shown.text).toBe(title);
                tops.push(shown.top);
                if (process.env.BOT_SHOTS) fs.writeFileSync(`${process.env.BOT_SHOTS}/step${i}.png`, await page.screenshot());
                if (i < titles.length - 1) await pressButton(page, "Next");
            }
            expect(new Set(tops).size).toBe(1);

            // a token that reads as one, which Discord refuses
            const appId = "123456789012345678";
            await page.type('input[type="password"]', `${Buffer.from(appId).toString("base64url")}.AAAAAA.${"x".repeat(27)}`);
            await page.waitFor(`document.body.innerText.includes(${JSON.stringify(appId)})`, "the application the token names");
            await pressButton(page, "Add bot");
            await page.waitFor(`document.querySelector("[role=alert]")?.innerText.includes("Bot not added")`, "the refusal");
            // the only callout is the refusal: the token's application is named, never marked good
            expect(await page.evaluate<string[]>(`[...document.querySelectorAll("[class*=PaperQuote]")].map((q) => q.innerText)`)).toEqual([
                expect.stringContaining("Bot not added"),
            ]);
            expect(await page.evaluate<string>("document.body.innerText")).toContain(`Application ID: ${appId}`);
            if (process.env.BOT_SHOTS) fs.writeFileSync(`${process.env.BOT_SHOTS}/refused.png`, await page.screenshot());
            expect(page.exceptions).toEqual([]);
        } finally {
            await page.close();
            served.stop();
        }
    });
});
