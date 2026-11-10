import { afterAll, afterEach, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import type { BotsServiceState } from "../src/bots";
import { openPage, servePanel, type Page } from "./helpers/browser";
import { testDaemon } from "./helpers/daemon";
import { guild, startFakeDiscord, type FakeDiscord } from "./helpers/discord";
import { PANEL_ID, savedBots, startService, stopServices, storedBot } from "./helpers/service";
import { stateWhere } from "./helpers/wait";

// each wait below has its own bound; a test as a whole may take longer than bun's 5 s default
setDefaultTimeout(60_000);

let discord: FakeDiscord;
beforeAll(() => {
    discord = startFakeDiscord();
});
afterAll(() => discord.stop());
afterEach(stopServices);

const body = (page: Page) => page.evaluate<string>("document.body.innerText");
const quoteShows = (title: string, text: string) =>
    `[...document.querySelectorAll("[role=alert], [class*=PaperQuote], [class*=quote]")].some((q) => q.innerText.includes(${JSON.stringify(title)}) && q.innerText.includes(${JSON.stringify(text)}))`;

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
    if (!found) throw new Error(`Nothing matching ${selector} shows "${text}"; the page shows:\n${await body(page)}`);
    await page.click(`[data-test="${tag}"]`);
}

const openTab = (page: Page, tab: string) => page.click(`input[name=botMenu][value="${tab}"]`);

// Failures are shown, never guessed.
describe("failures are shown, never guessed", () => {
    test("a failed invite link, a refused delete and failed health reads say why", async () => {
        const home = guild("Home");
        const fake = discord.addBot({ username: "Keeper", guilds: [home] });
        await savedBots([
            // never logged in and no token: Discord has not told us its application id
            { stored: storedBot("b-unknown", "", { name: "Nameless", enabled: false }) },
            { stored: storedBot("b-keep", fake.appId, { name: "Keeper" }), token: fake.token },
        ]);
        const service = await startService({ discordApi: discord.api });
        await stateWhere<BotsServiceState>(PANEL_ID, (s) => Boolean(s.bots.find((b) => b.id === "b-keep")?.connected), "Keeper to connect");
        const served = await servePanel();
        const page = await openPage(served.url);
        const configs = path.join((await testDaemon()).dataDir, "configs");
        try {
            // an invite link that can't be made says so, instead of "Generating…"
            await page.waitFor(`document.body.innerText.includes("Nameless")`, "the bot list");
            await clickText(page, "[class*=card], [class*=Card]", "Nameless");
            await openTab(page, "invite");
            await page.waitFor(quoteShows("Couldn't make the invite link", "Cannot build an invite URL: no application ID is known."), "the invite failure");
            expect(await body(page)).toContain("No invite link");
            expect(await body(page)).not.toContain("Generating invite link…");
            await openTab(page, "home");

            // a delete the service refuses keeps the bot, the modal and the reason
            await clickText(page, "[class*=card], [class*=Card]", "Keeper");
            await openTab(page, "config");
            await clickText(page, "button", "Delete");
            await page.waitFor(`document.querySelector("[role=dialog]")?.innerText.includes("Delete bot?")`, "the delete confirmation");
            fs.chmodSync(configs, 0o555);
            try {
                await clickText(page, "[role=dialog] button", "Delete");
                await page.waitFor(quoteShows("Not deleted", "Couldn't save the bot list"), "the refused delete");
            } finally {
                fs.chmodSync(configs, 0o755);
            }
            expect(await page.evaluate<string>(`document.querySelector("[role=dialog]").innerText`)).toMatch(/EACCES|permission denied/i);
            expect((await stateWhere<BotsServiceState>(PANEL_ID, () => true, "the bots")).bots.map((b) => b.id)).toContain("b-keep");
            await clickText(page, "[role=dialog] button", "Cancel");
            await page.waitFor(`!document.querySelector("[role=dialog]")?.innerText.includes("Delete bot?")`, "the modal to close");
            await openTab(page, "home");

            // with the service gone, health can't be read: the panel says why
            // instead of showing an offline bot or a table of zeros
            await service.stop();
            await clickText(page, "[class*=card], [class*=Card]", "Keeper");
            await page.waitFor(quoteShows("Couldn't check health", "dev.paperboard.botcreator"), "the failed health read");
            const overview = await body(page);
            expect(overview).not.toContain("Gateway status");
            expect(overview).not.toContain("Checking health…");
            await openTab(page, "commands");
            await page.waitFor(quoteShows("Couldn't check the bot's connection", "dev.paperboard.botcreator"), "the failed connection check");
            expect(await body(page)).not.toContain("Bot offline");
            expect(page.exceptions).toEqual([]);
        } finally {
            await page.close();
            served.stop();
        }
    });
});
