// The Commands tab in a real browser follows the bot's commands however they
// change: a Blocks flow adding or deleting one shows in an open tab without
// leaving it, the rows that didn't change keep their place, and another bot's
// open tab, in another window, is left alone.
import { afterAll, afterEach, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { blocksApi } from "@mileniumhq/paperapi";
import type { BotsServiceState } from "../src/bots";
import type { SlashCommandDefinition } from "../src/types";
import { openPage, servePanel, type Page } from "./helpers/browser";
import { guild, startFakeDiscord, type FakeDiscord } from "./helpers/discord";
import { PANEL_ID, savedBots, startService, stopServices, storedBot } from "./helpers/service";
import { stateWhere } from "./helpers/wait";

// each wait below has its own bound; a test as a whole may take longer than bun's 5 s default
setDefaultTimeout(60_000);

const run = <T = any>(command: string, inputs: Record<string, unknown>) => blocksApi.run<T>(PANEL_ID, command, inputs);

let discord: FakeDiscord;
beforeAll(() => {
    discord = startFakeDiscord();
});
afterAll(() => discord.stop());
afterEach(stopServices);

function command(id: string, name: string): SlashCommandDefinition {
    return { id, name, description: `The ${name} command`, scope: "global", options: [], userInstall: false };
}

/** Opens `bot`'s Commands tab from the home screen. */
async function openCommands(page: Page, bot: string): Promise<void> {
    await page.waitFor(`document.body.innerText.includes(${JSON.stringify(bot)})`, "the bot list");
    const tag = `t${Math.random().toString(36).slice(2)}`;
    const found = await page.evaluate<boolean>(`(() => {
        const all = [...document.querySelectorAll("[class*=card], [class*=Card]")].filter((el) => el.innerText?.includes(${JSON.stringify(bot)}));
        const inner = all.filter((el) => !all.some((other) => other !== el && el.contains(other)));
        if (!inner[0]) return false;
        inner[0].dataset.test = ${JSON.stringify(tag)};
        return true;
    })()`);
    if (!found) throw new Error(`No card shows ${bot}`);
    await page.click(`[data-test="${tag}"]`);
    await page.click(`input[name=botMenu][value="commands"]`);
    await page.waitFor(`document.body.innerText.includes("Slash commands this bot registers")`, "the Commands tab");
}

/** The element naming `/name` in the open tab's list, or null. */
const row = (name: string) => `([...document.querySelectorAll("[class*=SettingItem] *")].find((el) => el.children.length === 0 && el.textContent === "/${name}") ?? null)`;

describe("the Commands tab", () => {
    test("a command a Blocks flow adds or deletes shows in the open tab, and nothing else moves", async () => {
        const home = guild("Home");
        const alpha = discord.addBot({ username: "Alpha", guilds: [home] });
        const beta = discord.addBot({ username: "Beta" });
        await savedBots([
            { stored: storedBot("b-alpha", alpha.appId, { name: "Alpha", createdAt: 1, commands: [command("c-ping", "ping")] }), token: alpha.token },
            { stored: storedBot("b-beta", beta.appId, { name: "Beta", createdAt: 2, commands: [command("c-hello", "hello")] }), token: beta.token },
        ]);
        await startService({ discordApi: discord.api });
        await stateWhere<BotsServiceState>(PANEL_ID, (s) => s.bots.length === 2 && s.bots.every((b) => b.connected), "both bots to connect");
        const served = await servePanel();
        // two windows: Alpha's tab, where the flow's changes land, and Beta's
        const page = await openPage(served.url);
        const other = await openPage(served.url);
        try {
            await openCommands(page, "Alpha");
            await openCommands(other, "Beta");
            await page.waitFor(`${row("ping")} !== null`, "/ping in Alpha's list");
            await other.waitFor(`${row("hello")} !== null`, "/hello in Beta's list");
            await page.evaluate(`window.pingRow = ${row("ping")}`);
            await other.evaluate(`window.helloRow = ${row("hello")}`);

            const roll = await run("create-slash-command", { name: "roll", bot: "b-alpha", description: "Roll a die", dms: false });
            await page.waitFor(`${row("roll")} !== null`, "the flow's /roll in Alpha's open tab");
            // the row that didn't change is the same element, not a new one in its place
            expect(await page.evaluate<boolean>(`window.pingRow.isConnected && window.pingRow === ${row("ping")}`)).toBe(true);

            await run("delete-slash-command", { command: roll });
            await page.waitFor(`${row("roll")} === null`, "the deleted /roll to leave Alpha's open tab");
            expect(await page.evaluate<boolean>(`window.pingRow.isConnected && window.pingRow === ${row("ping")}`)).toBe(true);

            // Beta's open tab never heard of Alpha's command, and its row stayed put
            expect(await other.evaluate<boolean>(`window.helloRow.isConnected && window.helloRow === ${row("hello")}`)).toBe(true);
            expect(await other.evaluate<string>(`document.body.innerText`)).not.toContain("/roll");
            expect(page.exceptions).toEqual([]);
            expect(other.exceptions).toEqual([]);
        } finally {
            await page.close();
            await other.close();
            served.stop();
        }
    });
});
