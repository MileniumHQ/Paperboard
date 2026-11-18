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
        const h = [...document.querySelectorAll("[data-preset=title]")].find((el) => el.getClientRects().length > 0 && el.getBoundingClientRect().left >= 0 && el.getBoundingClientRect().right <= innerWidth + 1);
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
                await page.waitFor(`[...document.querySelectorAll("[data-preset=title]")].some((h) => h.innerText === ${JSON.stringify(title)} && h.getBoundingClientRect().left >= 0 && h.getBoundingClientRect().right <= innerWidth + 1) && [...document.querySelectorAll("img")].every((img) => img.complete)`, `step "${title}"`);
                // the step has slid into place
                await page.motionSettled();
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
            // the refusal is the token's: said under the field, which is marked wrong
            const TOKEN = `document.querySelector('input[type="password"]')`;
            await page.waitFor(`document.getElementById(${TOKEN}.getAttribute("aria-describedby"))?.innerText.includes("An invalid token was provided")`, "the refusal under the token");
            expect(await page.evaluate<boolean>(`${TOKEN}.getAttribute("aria-invalid") === "true"`)).toBe(true);
            // the only callout is the refusal, as the field's own words: the token's application is named, never marked good
            expect(await page.evaluate<number>(`document.querySelectorAll("[class*=PaperQuote]").length`)).toBe(0);
            expect(await page.evaluate<number>(`document.querySelectorAll("[role=alert]").length`)).toBe(0);
            expect(await page.evaluate<string>("document.body.innerText")).toContain(`Application ID: ${appId}`);
            if (process.env.BOT_SHOTS) fs.writeFileSync(`${process.env.BOT_SHOTS}/refused.png`, await page.screenshot());
            expect(page.exceptions).toEqual([]);
        } finally {
            await page.close();
            served.stop();
        }
    });
    test("sits in a centred column, not edge to edge, on a wide panel and on a phone", async () => {
        await savedBots([]);
        await startService({ discordApi: discord.api });
        const served = await servePanel();
        const page = await browser.open(served.url);
        // the box the shown step's title sits in, and the token field's, against the panel's width
        const widths = () =>
            page.evaluate<{ panel: number; column: number; field: number; left: number }>(`(() => {
                const title = [...document.querySelectorAll("[data-preset=title]")].find((el) => el.getClientRects().length > 0 && el.getBoundingClientRect().left >= 0 && el.getBoundingClientRect().right <= innerWidth + 1);
                const column = title.closest("[data-preset]").getBoundingClientRect();
                const input = document.querySelector('input[type="password"]');
                return { panel: innerWidth, column: Math.round(column.width), field: input ? Math.round(input.getBoundingClientRect().width) : 0, left: Math.round(title.getBoundingClientRect().left) };
            })()`);
        try {
            await page.waitFor(`document.body.innerText.includes("Make an application")`, "the guide");
            await page.resize(1200, 800);
            await page.waitFor(`document.querySelectorAll("[data-preset=large]").length > 0`, "the centred interface");
            for (let i = 0; i < 4; i++) await pressButton(page, "Next");
            await page.waitFor(`document.body.innerText.includes("Paste the token") && document.querySelector('input[type="password"]')?.getBoundingClientRect().left >= 0`, "the token step");
            await page.motionSettled();
            const wide = await widths();
            // a column of sensible width in the middle, with the field no wider than it
            expect(wide.field).toBeLessThan(wide.panel * 0.75);
            expect(wide.field).toBeLessThanOrEqual(wide.column);
            expect(wide.left).toBeGreaterThan(100);
            if (process.env.BOT_SHOTS) fs.writeFileSync(`${process.env.BOT_SHOTS}/wide-token.png`, await page.screenshot());

            await page.resize(390, 800);
            await page.motionSettled();
            const phone = await widths();
            // on a phone the column gives way to the screen: nothing runs off it
            expect(phone.field).toBeGreaterThan(200);
            expect(phone.left + phone.field).toBeLessThanOrEqual(phone.panel);
            if (process.env.BOT_SHOTS) fs.writeFileSync(`${process.env.BOT_SHOTS}/phone-token.png`, await page.screenshot());
            expect(page.exceptions).toEqual([]);
        } finally {
            await page.close();
            served.stop();
        }
    });

    test("keeps a step's title close to its text", async () => {
        await savedBots([]);
        await startService({ discordApi: discord.api });
        const served = await servePanel();
        const page = await browser.open(served.url);
        try {
            await page.waitFor(`document.body.innerText.includes("Make an application")`, "the guide");
            await page.motionSettled();
            const gaps = await page.evaluate<{ above: number; below: number }>(`(() => {
                const rect = (el) => el.getBoundingClientRect();
                const visible = (el) => el.getClientRects().length > 0 && rect(el).left >= 0 && rect(el).right <= innerWidth + 1;
                const heading = [...document.querySelectorAll("[data-preset=title]")].find((el) => visible(el) && el.innerText === "Make an application");
                const page = [...document.querySelectorAll("[data-preset=subheader]")].find((el) => el.innerText === "Set up your first bot");
                const text = [...document.querySelectorAll("[data-preset=body]")].find(visible);
                return { above: Math.round(rect(heading).top - rect(page).bottom), below: Math.round(rect(text).top - rect(heading).bottom) };
            })()`);
            // the step's heading is not pushed away from the page title or from its text
            expect(gaps.above).toBeLessThan(64);
            expect(gaps.below).toBeLessThan(16);
            expect(page.exceptions).toEqual([]);
        } finally {
            await page.close();
            served.stop();
        }
    });
});
