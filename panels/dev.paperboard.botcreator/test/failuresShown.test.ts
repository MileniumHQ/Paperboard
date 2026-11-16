import { afterAll, afterEach, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import type { BotsServiceState } from "../src/bots";
import { GLOBAL_SCOPE } from "../src/types";
import { errorButton, errorButtonAt, errorFills, errorShows, panelBrowser, paperError, servePanel, TOASTS, toastShows, type Page } from "./helpers/browser";
import { testDaemon } from "./helpers/daemon";
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
        const page = await browser.open(served.url);
        const configs = path.join((await testDaemon()).dataDir, "configs");
        try {
            // an invite link that can't be made says so where the link would be, instead of "Generating…"
            await page.waitFor(`document.body.innerText.includes("Nameless")`, "the bot list");
            await clickText(page, "[class*=card], [class*=Card]", "Nameless");
            await openTab(page, "invite");
            await page.waitFor(errorShows("Couldn't make the invite link", "Cannot build an invite URL: no application ID is known."), "the invite failure, in place");
            expect(await body(page)).not.toContain("Generating invite link…");
            expect(await page.evaluate<string>(`${errorButton("Couldn't make the invite link")}?.innerText ?? ""`)).toBe("Try again");
            // the install link has no application ID to name either
            await page.waitFor(errorShows("Couldn't make the install link"), "the install link failure, in place");
            expect(await body(page)).not.toContain("Generating user install link…");
            await openTab(page, "home");

            // a delete the service refuses keeps the bot, the modal and the reason
            await clickText(page, "[class*=card], [class*=Card]", "Keeper");
            await openTab(page, "config");
            await clickText(page, "button", "Delete");
            await page.waitFor(`document.querySelector("[role=dialog]")?.innerText.includes("Delete bot?")`, "the delete confirmation");
            fs.chmodSync(configs, 0o555);
            try {
                await clickText(page, "[role=dialog] button", "Delete");
                await page.waitFor(toastShows("Couldn't delete Keeper", "Couldn't save the bot list"), "the refused delete");
            } finally {
                fs.chmodSync(configs, 0o755);
            }
            // the toast says why, and the dialog stays for another try
            expect(await page.evaluate<string>(`${TOASTS}.join(" ")`)).toMatch(/EACCES|permission denied/i);
            expect(await page.evaluate<string>(`document.querySelector("[role=dialog]")?.innerText ?? ""`)).toContain("Delete bot?");
            expect((await stateWhere<BotsServiceState>(PANEL_ID, () => true, "the bots")).bots.map((b) => b.id)).toContain("b-keep");
            await clickText(page, "[role=dialog] button", "Cancel");
            await page.waitFor(`!document.querySelector("[role=dialog]")?.innerText.includes("Delete bot?")`, "the modal to close");
            await openTab(page, "home");

            // with the service gone, health can't be read: the panel says why
            // instead of showing an offline bot or a table of zeros
            await service.stop();
            await clickText(page, "[class*=card], [class*=Card]", "Keeper");
            await page.waitFor(errorShows("Couldn't check health", "dev.paperboard.botcreator"), "the failed health read, in its card");
            const overview = await body(page);
            expect(overview).not.toContain("Gateway status");
            expect(overview).not.toContain("Checking health…");
            // with no reading to keep, the card says it couldn't check instead of going blank, with Try again
            expect(await page.evaluate<string>(`${errorButton("Couldn't check health")}?.innerText ?? ""`)).toBe("Try again");
            expect(page.exceptions).toEqual([]);
        } finally {
            await page.close();
            served.stop();
        }
    });

    test("an offline bot's Delete says its commands come off Discord, and a refusal offers Delete anyway", async () => {
        const home = guild("Home");
        const fake = discord.addBot({ username: "Revoked", guilds: [home] });
        // reset in the Developer Portal: the saved token names the application but Discord refuses it
        const revoked = `${fake.token.slice(0, -1)}${fake.token.endsWith("x") ? "y" : "x"}`;
        const hello = { id: "c-hello", name: "hello", description: "Says hello", scope: home.id, options: [], userInstall: false };
        await savedBots([{ stored: storedBot("b-revoked", fake.appId, { name: "Revoked", enabled: false, commands: [hello] }), token: revoked }]);
        await startService({ discordApi: discord.api });
        await stateWhere<BotsServiceState>(PANEL_ID, (s) => s.bots[0]?.name === "Revoked", "Revoked");
        const served = await servePanel();
        const page = await browser.open(served.url);
        const dialog = () => page.evaluate<string>(`document.querySelector("[role=dialog]")?.innerText ?? ""`);
        try {
            await page.waitFor(`document.body.innerText.includes("Revoked")`, "the bot list");
            await clickText(page, "[class*=card], [class*=Card]", "Revoked");
            await openTab(page, "config");
            await clickText(page, "button", "Delete");
            await page.waitFor(`document.querySelector("[role=dialog]")?.innerText.includes("Delete bot?")`, "the delete confirmation");
            // off, it is cleared with its token all the same
            expect(await dialog()).toContain("Revoked's slash commands are removed from Discord, it goes offline, and its token is deleted from Paperboard.");
            expect(await dialog()).not.toContain("stay on Discord");

            await clickText(page, "[role=dialog] button", "Delete");
            await page.waitFor(quoteShows("Discord kept its slash commands", "401: Unauthorized"), "the refusal");
            expect(await dialog()).toContain("Delete anyway removes the bot from Paperboard, and its slash commands stay on Discord.");
            expect((await stateWhere<BotsServiceState>(PANEL_ID, () => true, "the bots")).bots.map((b) => b.id)).toEqual(["b-revoked"]);

            await clickText(page, "[role=dialog] button", "Delete anyway");
            await page.waitFor(`!document.querySelector("[role=dialog]")?.innerText.includes("Delete bot?")`, "the modal to close");
            expect((await stateWhere<BotsServiceState>(PANEL_ID, (s) => s.bots.length === 0, "the bot to go")).bots).toEqual([]);
            expect(page.exceptions).toEqual([]);
        } finally {
            await page.close();
            served.stop();
        }
    });

    test("an offline bot's last server command that Discord won't clear says it is still on Discord, until it is dismissed", async () => {
        const home = guild("Home");
        const fake = discord.addBot({ username: "Napper", guilds: [home] });
        const revoked = `${fake.token.slice(0, -1)}${fake.token.endsWith("x") ? "y" : "x"}`;
        const hello = { id: "c-hello", name: "hello", description: "Says hello", scope: home.id, options: [], userInstall: false };
        await savedBots([{ stored: storedBot("b-nap", fake.appId, { name: "Napper", enabled: false, commands: [hello] }), token: revoked }]);
        await startService({ discordApi: discord.api });
        await stateWhere<BotsServiceState>(PANEL_ID, (s) => s.bots[0]?.name === "Napper", "Napper");
        const served = await servePanel();
        const page = await browser.open(served.url);
        try {
            await page.waitFor(`document.body.innerText.includes("Napper")`, "the bot list");
            await clickText(page, "[class*=card], [class*=Card]", "Napper");
            await openTab(page, "commands");
            await page.waitFor(`document.body.innerText.includes("/hello")`, "the command list");
            await page.click(`button[title="Delete command"]`);
            await clickText(page, "[role=dialog] button", "Delete");
            await page.waitFor(toastShows("/hello is still on Discord", "401: Unauthorized"), "the kept command");
            expect(await body(page)).toContain("/hello stays on Discord.");
            // read, it can be put away
            await page.click(`[aria-label=Notifications] button[aria-label="Close"]`);
            await page.waitFor(`!document.body.innerText.includes("/hello is still on Discord")`, "the notice to go");
            expect(page.exceptions).toEqual([]);
        } finally {
            await page.close();
            served.stop();
        }
    });

    test("saved bots that can't be read say why in place of the list, instead of No bots yet", async () => {
        const fake = discord.addBot({ username: "Damaged" });
        const ping = { id: "c-ping", name: "ping", description: "Pong", scope: GLOBAL_SCOPE, options: [], userInstall: false };
        await savedBots([{ stored: storedBot("b-damaged", fake.appId, { commands: [ping, { ...ping, id: "c-again" }] }), token: fake.token }]);
        await startService({ discordApi: discord.api });
        await stateWhere<BotsServiceState>(PANEL_ID, (s) => Boolean(s.botsError), "the refusal");
        const served = await servePanel();
        const page = await browser.open(served.url);
        try {
            await page.waitFor(errorShows("Couldn't read the saved bots", "/ping is saved twice"), "the list's place saying why");
            // nothing else shows: it fills the list's place
            expect(await page.evaluate<boolean>(errorFills("Couldn't read the saved bots"))).toBe(true);
            const shown = await body(page);
            expect(shown).not.toContain("No bots yet");
            expect(shown).not.toContain("Set up your first bot");
            expect(await page.evaluate<number>(`document.querySelectorAll("[class*=PaperQuote]").length`)).toBe(0);
            expect(await page.evaluate<boolean>(`[...document.querySelectorAll("button")].find((b) => b.innerText.includes("New bot")).disabled`)).toBe(true);
            expect(page.exceptions).toEqual([]);
        } finally {
            await page.close();
            served.stop();
        }
    });

    test("Try again on the saved bots' failure reads them again: still damaged, it says why and stays; mended, the bots come", async () => {
        const fake = discord.addBot({ username: "Mended" });
        const ping = { id: "c-ping", name: "ping", description: "Pong", scope: GLOBAL_SCOPE, options: [], userInstall: false };
        await savedBots([{ stored: storedBot("b-mended", fake.appId, { commands: [ping, { ...ping, id: "c-again" }] }), token: fake.token }]);
        await startService({ discordApi: discord.api });
        await stateWhere<BotsServiceState>(PANEL_ID, (s) => Boolean(s.botsError), "the refusal");
        const served = await servePanel();
        const page = await browser.open(served.url);
        const tryAgain = errorButton("Couldn't read the saved bots");
        try {
            await page.waitFor(`${tryAgain}?.innerText === "Try again"`, "Try again on the failure");
            expect(await body(page)).not.toContain("Restart Paperboard");
            await page.click(errorButtonAt("Couldn't read the saved bots"));
            // the read again goes, and the failure still stands, saying why, with its button back
            await page.waitFor(`${tryAgain}?.disabled === false && ${errorShows("Couldn't read the saved bots", "/ping is saved twice")}`, "the failure saying it still can't");
            expect(await page.evaluate<boolean>(`Boolean(${tryAgain})`), "Try again went away with the bots still unread").toBe(true);

            const file = path.join((await testDaemon()).dataDir, "configs", `${PANEL_ID}.json`);
            fs.writeFileSync(file, JSON.stringify({ version: 2, bots: [storedBot("b-mended", fake.appId, { commands: [ping] })] }));
            await page.click(errorButtonAt("Couldn't read the saved bots"));
            await page.waitFor(`document.body.innerText.includes("Bot b-mended")`, "the bot read again");
            expect(await page.evaluate<boolean>(`${paperError("Couldn't read the saved bots")} === null`)).toBe(true);
            expect(page.exceptions).toEqual([]);
        } finally {
            await page.close();
            served.stop();
        }
    });
});
