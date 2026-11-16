import { afterAll, afterEach, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import type { BotsServiceState } from "../src/bots";
import { errorButton, errorButtonAt, errorFills, errorShows, panelBrowser, paperError, servePanel, TOASTS, type Page } from "./helpers/browser";
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

const body = (page: Page) => page.evaluate<string>("document.body.innerText");

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

/** whether the first expression's element comes before the second's on the page */
const before = (first: string, second: string) => `Boolean(${first}.compareDocumentPosition(${second}) & Node.DOCUMENT_POSITION_FOLLOWING)`;

const openTab = (page: Page, tab: string) => page.click(`input[name=botMenu][value="${tab}"]`);

// A failure that stands is said where it happens, and stays while it does:
// never a toast, which goes by itself.
describe("failures that stand are said in place", () => {
    test("commands Discord won't take say so above the commands, which stay listed", async () => {
        const home = guild("Home");
        const fake = discord.addBot({ username: "Herald", guilds: [home] });
        // scoped to a server the bot was removed from: it can't be registered there
        const away = { id: "c-away", name: "away", description: "For a server it left", scope: guild("Gone").id, options: [], userInstall: false };
        await savedBots([{ stored: storedBot("b-herald", fake.appId, { name: "Herald", commands: [away] }), token: fake.token }]);
        await startService({ discordApi: discord.api });
        await stateWhere<BotsServiceState>(PANEL_ID, (s) => Boolean(s.bots[0]?.connected && s.bots[0].commandSyncError), "the refused sync");
        const served = await servePanel();
        const page = await browser.open(served.url);
        const title = "Couldn't register the commands with Discord";
        try {
            await page.waitFor(`document.body.innerText.includes("Herald")`, "the bot list");
            await clickText(page, "[class*=card], [class*=Card]", "Herald");
            await openTab(page, "commands");
            await page.waitFor(errorShows(title, "is not in this bot's server list"), "the refused sync, above the commands");
            const row = `[...document.querySelectorAll("*")].find((el) => el.children.length === 0 && el.textContent === "/away")`;
            expect(await page.evaluate<boolean>(`Boolean(${row})`)).toBe(true);
            expect(await page.evaluate<boolean>(before(paperError(title), row))).toBe(true);
            expect(await page.evaluate<boolean>(errorFills(title))).toBe(false);
            expect(await page.evaluate<string>(`${TOASTS}.join(" ")`)).not.toContain("is not in this bot's server list");
            expect(page.exceptions).toEqual([]);
        } finally {
            await page.close();
            served.stop();
        }
    });

    test("a server that can't be read again stands above what was read of it; one never read fills its page", async () => {
        const home = guild("Home");
        const den = guild("Den");
        const fake = discord.addBot({ username: "Scout", guilds: [home, den] });
        await savedBots([{ stored: storedBot("b-scout", fake.appId, { name: "Scout" }), token: fake.token }]);
        const service = await startService({ discordApi: discord.api });
        await stateWhere<BotsServiceState>(PANEL_ID, (s) => Boolean(s.bots[0]?.connected), "Scout to connect");
        const served = await servePanel();
        const page = await browser.open(served.url);
        const title = "Couldn't load this server";
        try {
            await page.waitFor(`document.body.innerText.includes("Scout")`, "the bot list");
            await clickText(page, "[class*=card], [class*=Card]", "Scout");
            await openTab(page, "servers");
            await clickText(page, "[class*=card], [class*=Card]", "Home");
            await page.waitFor(`document.body.innerText.includes("Channels")`, "Home's channels");

            // the service goes: Refresh can't read the server, and what was read stays under the failure
            await service.stop();
            await clickText(page, "button", "Refresh");
            await page.waitFor(errorShows(title, "dev.paperboard.botcreator"), "the failed refresh, in place");
            const channels = `[...document.querySelectorAll("*")].find((el) => el.children.length === 0 && el.textContent === "Channels")`;
            expect(await page.evaluate<boolean>(`Boolean(${channels})`)).toBe(true);
            expect(await page.evaluate<boolean>(before(paperError(title), channels))).toBe(true);
            expect(await page.evaluate<boolean>(errorFills(title))).toBe(false);
            expect(await page.evaluate<string>(`${errorButton(title)}?.innerText ?? ""`)).toBe("Try again");

            // a search that can't be asked says so in the members' card, under the search
            await clickText(page, "button", "Search");
            await page.waitFor(errorShows("Couldn't search the members", "dev.paperboard.botcreator"), "the failed search, in place");
            expect(await page.evaluate<boolean>(before(`document.querySelector('input[placeholder="Member"]')`, paperError("Couldn't search the members")))).toBe(true);

            // another server, never read: nothing else shows, so the failure fills its page
            await clickText(page, "button", "All servers");
            await clickText(page, "[class*=card], [class*=Card]", "Den");
            await page.waitFor(`${errorShows(title, "dev.paperboard.botcreator")} && !document.body.innerText.includes("Channels")`, "the failed read of Den");
            expect(await page.evaluate<boolean>(errorFills(title))).toBe(true);
            expect(await body(page)).not.toContain("Loading server…");
            // pressing Try again asks again, and the failure still stands, saying why
            await page.click(errorButtonAt(title));
            await page.waitFor(`${errorButton(title)}?.disabled === false && ${errorShows(title, "dev.paperboard.botcreator")}`, "the failure again");
            expect(await page.evaluate<string>(`${TOASTS}.join(" ")`)).not.toContain(title);
            expect(page.exceptions).toEqual([]);
        } finally {
            await page.close();
            served.stop();
        }
    });

    test("an Overview that can't read the bot says so above its card", async () => {
        const fake = discord.addBot({ username: "Lookout", guilds: [guild("Home")] });
        await savedBots([{ stored: storedBot("b-look", fake.appId, { name: "Lookout" }), token: fake.token }]);
        const service = await startService({ discordApi: discord.api });
        await stateWhere<BotsServiceState>(PANEL_ID, (s) => Boolean(s.bots[0]?.connected), "Lookout to connect");
        const served = await servePanel();
        const page = await browser.open(served.url);
        const title = "Couldn't read the bot's details";
        try {
            await page.waitFor(`document.body.innerText.includes("Lookout")`, "the bot list");
            await service.stop();
            await clickText(page, "[class*=card], [class*=Card]", "Lookout");
            await page.waitFor(errorShows(title, "dev.paperboard.botcreator"), "the failed read, in place");
            const health = `[...document.querySelectorAll("*")].find((el) => el.children.length === 0 && el.textContent === "Health")`;
            expect(await page.evaluate<boolean>(before(paperError(title), health))).toBe(true);
            expect(await page.evaluate<string>(`${errorButton(title)}?.innerText ?? ""`)).toBe("Try again");
            expect(await page.evaluate<string>(`${TOASTS}.join(" ")`)).not.toContain(title);
            expect(page.exceptions).toEqual([]);
        } finally {
            await page.close();
            served.stop();
        }
    });
});
