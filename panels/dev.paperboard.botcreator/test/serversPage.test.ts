import { afterAll, afterEach, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { BotsServiceState } from "../src/bots";
import { panelBrowser, servePanel, TOASTS, type Page } from "./helpers/browser";
import { guild, startFakeDiscord, type FakeDiscord } from "./helpers/discord";
import { PANEL_ID, savedBots, startService, stopServices, storedBot } from "./helpers/service";
import { stateWhere } from "./helpers/wait";

// each wait below has its own bound; a test as a whole may take longer than bun's 5 s default
setDefaultTimeout(60_000);

const browser = panelBrowser();

let discord: FakeDiscord;
beforeAll(() => {
    discord = startFakeDiscord();
});
afterAll(() => discord.stop());
afterEach(stopServices);

/** Clicks, as a mouse would, the innermost `selector` element whose text includes `text`. */
async function clickText(page: Page, selector: string, text: string): Promise<void> {
    const tag = `t${Math.random().toString(36).slice(2)}`;
    const found = await page.evaluate<boolean>(`(() => {
        const all = [...document.querySelectorAll(${JSON.stringify(selector)})].filter((el) => el.innerText?.includes(${JSON.stringify(text)}));
        const inner = all.filter((el) => !all.some((other) => other !== el && el.contains(other)));
        if (!inner[0]) return false;
        inner[0].dataset.test = ${JSON.stringify(tag)};
        return true;
    })()`);
    if (!found) throw new Error(`Nothing matching ${selector} shows "${text}"`);
    await page.click(`[data-test="${tag}"]`);
}

// The server explorer asks the service for the bot it is showing.
describe("the server explorer", () => {
    test("Send a message sends as the bot whose server is open", async () => {
        const home = guild("Home");
        const fake = discord.addBot({ username: "Keeper", guilds: [home] });
        await savedBots([{ stored: storedBot("b-keep", fake.appId, { name: "Keeper" }), token: fake.token }]);
        await startService({ discordApi: discord.api });
        await stateWhere<BotsServiceState>(PANEL_ID, (s) => Boolean(s.bots.find((b) => b.id === "b-keep")?.connected), "Keeper to connect");
        const served = await servePanel();
        const page = await browser.open(served.url);
        try {
            await page.waitFor(`document.body.innerText.includes("Keeper")`, "the bot list");
            await clickText(page, "[class*=card], [class*=Card]", "Keeper");
            await page.click(`input[name=botMenu][value="servers"]`);
            await page.waitFor(`document.body.innerText.includes("Home")`, "the server list");
            await clickText(page, "[class*=card], [class*=Card]", "Home");
            await page.waitFor(`document.body.innerText.includes("Send a message")`, "the server's page");
            // the field starts empty, its placeholder naming what goes in it
            const MESSAGE = `document.querySelector('input[placeholder="Message"]')`;
            expect(await page.evaluate<string>(`${MESSAGE}.value`)).toBe("");
            await page.evaluate(`${MESSAGE}.focus()`);
            await page.send("Input.insertText", { text: "Hello from Paperboard!" });
            await clickText(page, "button", "Send");
            const sent = await discord.request((r) => r.method === "POST" && r.path === `/channels/${home.channels[0]!.id}/messages`, "the message to reach Discord");
            expect(sent.bot).toBe(fake.token);
            expect(sent.body.content).toBe("Hello from Paperboard!");
            // the confirmation is a toast, not a quote that stands in the server's page
            await page.waitFor(`${TOASTS}.some((t) => t.includes("Message sent") && t.includes("Posted to #general"))`, "the confirmation toast");
            expect(await page.evaluate<boolean>(`[...document.querySelectorAll("[class*=PaperCard]")].some((c) => c.innerText.includes("Send a message") && c.innerText.includes("Posted to"))`)).toBe(false);
            expect(page.exceptions).toEqual([]);
        } finally {
            await page.close();
            served.stop();
        }
    });
});
