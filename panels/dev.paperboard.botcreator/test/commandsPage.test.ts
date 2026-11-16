// The Commands tab in a real browser follows the bot's commands however they
// change: a Blocks flow adding or deleting one shows in an open tab without
// leaving it, the rows that didn't change keep their place, and another bot's
// open tab, in another window, is left alone. Its Create form takes a name as
// it is typed in Discord and refuses one Discord wouldn't.
import { afterAll, afterEach, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { blocksApi } from "@mileniumhq/paperapi";
import type { BotsServiceState } from "../src/bots";
import type { SlashCommandDefinition } from "../src/types";
import { panelBrowser, servePanel, type Page } from "./helpers/browser";
import { guild, startFakeDiscord, type FakeDiscord } from "./helpers/discord";
import { PANEL_ID, savedBots, startService, stopServices, storedBot } from "./helpers/service";
import { stateWhere } from "./helpers/wait";

// each wait below has its own bound; a test as a whole may take longer than bun's 5 s default
setDefaultTimeout(60_000);

const browser = panelBrowser();

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

/** The open dialog's field labelled `label`. */
const field = (label: string) =>
    `document.getElementById([...document.querySelectorAll("[role=dialog] label")].find((l) => l.textContent.trim() === ${JSON.stringify(label)})?.htmlFor)`;
/** The open dialog's button whose text includes `text`. */
const dialogButton = (text: string) => `[...document.querySelectorAll("[role=dialog] button")].find((b) => b.innerText.includes(${JSON.stringify(text)}))`;

/** What the dialog's field labelled `label` says is wrong with it, as its screen-reader description: "" when it says nothing. */
const said = (label: string) =>
    `(${field(label)}.getAttribute("aria-describedby") ?? "").split(" ").map((id) => document.getElementById(id)?.innerText ?? "").join(" ").trim()`;

/** Replaces what the dialog's field labelled `label` holds with `text`, typed as a keyboard would. */
async function fill(page: Page, label: string, text: string): Promise<void> {
    await page.evaluate(`(${field(label)}).select()`);
    await page.send("Input.insertText", { text });
}

describe("the Commands tab", () => {
    test("Create takes /Name as Discord has it, and refuses a name Discord wouldn't", async () => {
        const fake = discord.addBot({ username: "Former", guilds: [guild("Home")] });
        await savedBots([{ stored: storedBot("b-former", fake.appId, { name: "Former" }), token: fake.token }]);
        await startService({ discordApi: discord.api });
        await stateWhere<BotsServiceState>(PANEL_ID, (s) => Boolean(s.bots[0]?.connected), "Former to connect");
        const served = await servePanel();
        const page = await browser.open(served.url);
        try {
            await openCommands(page, "Former");
            await page.evaluate(`[...document.querySelectorAll("button")].find((b) => b.innerText.includes("Create command")).dataset.test = "new"`);
            await page.click(`[data-test="new"]`);
            await page.waitFor(`${field("Command")} !== null`, "the Create Slash Command form");

            // Discord names have no spaces: the field says so and Create stays off
            await fill(page, "Command", "ping pong");
            await fill(page, "Description", "Check the bot");
            await page.waitFor(`${field("Command")}.getAttribute("aria-invalid") === "true"`, "the name marked wrong");
            expect(await page.evaluate<boolean>(`${dialogButton("Create")}.disabled`)).toBe(true);
            // and says why under itself, where the field points to it
            expect(await page.evaluate<string>(said("Command"))).toContain("Names are 1–32 lowercase characters");

            // a name typed as in Discord is the lowercase command
            await fill(page, "Command", "/Ping");
            await page.waitFor(`!${dialogButton("Create")}.disabled`, "Create to be pressable");
            expect(await page.evaluate<string | null>(`${field("Command")}.getAttribute("aria-invalid")`)).toBeNull();
            expect(await page.evaluate<string>(said("Command"))).toBe("");
            await page.evaluate(`${dialogButton("Create")}.dataset.test = "create"`);
            await page.click(`[data-test="create"]`);
            await page.waitFor(`${row("ping")} !== null`, "the new /ping in the list");
            const state = await stateWhere<BotsServiceState>(PANEL_ID, (s) => s.bots[0]?.commands.length === 1, "the saved command");
            expect(state.bots[0].commands[0]).toMatchObject({ name: "ping", description: "Check the bot", scope: fake.guilds[0].id });

            // the same name again in the same server is refused before it is sent
            await page.click(`[data-test="new"]`);
            await page.waitFor(`${field("Command")} !== null`, "the form again");
            await fill(page, "Command", "ping");
            await fill(page, "Description", "Again");
            await page.waitFor(`${field("Command")}.getAttribute("aria-invalid") === "true"`, "the taken name marked wrong");
            expect(await page.evaluate<boolean>(`${dialogButton("Create")}.disabled`)).toBe(true);
            expect(await page.evaluate<string>(said("Command"))).toBe("A command with this name already exists in this scope.");
            expect(page.exceptions).toEqual([]);
        } finally {
            await page.close();
            served.stop();
        }
    });

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
        const page = await browser.open(served.url);
        const other = await browser.open(served.url);
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

    test("the servers a command is scoped to follow the bot: a renamed server shows its new name in the open tab", async () => {
        const home = guild("Home");
        const fake = discord.addBot({ username: "Gamma", guilds: [home] });
        await savedBots([{ stored: storedBot("b-gamma", fake.appId, { name: "Gamma", commands: [{ ...command("c-wave", "wave"), scope: home.id }] }), token: fake.token }]);
        await startService({ discordApi: discord.api });
        await stateWhere<BotsServiceState>(PANEL_ID, (s) => Boolean(s.bots[0]?.connected), "Gamma to connect");
        const served = await servePanel();
        const page = await browser.open(served.url);
        try {
            await openCommands(page, "Gamma");
            const badge = `(${row("wave")}?.closest("[class*=SettingItem]")?.textContent ?? "")`;
            await page.waitFor(`${badge}.includes("Home")`, "/wave scoped to Home");
            await page.evaluate(`window.waveRow = ${row("wave")}`);

            // the same number of servers, one of them renamed: nothing but the list itself says so
            discord.dispatch(fake, "GUILD_UPDATE", { id: home.id, name: "Hearth", icon: null, owner_id: fake.appId, features: [] });
            await page.waitFor(`${badge}.includes("Hearth")`, "the renamed server in the open tab");
            expect(await page.evaluate<boolean>(`window.waveRow.isConnected && window.waveRow === ${row("wave")}`)).toBe(true);

            // and a new command offers it by its new name
            await page.evaluate(`[...document.querySelectorAll("button")].find((b) => b.innerText.includes("Create command")).dataset.test = "new"`);
            await page.click(`[data-test="new"]`);
            await page.waitFor(`document.querySelector("[role=dialog]")?.textContent.includes("Hearth (this server only)")`, "the renamed server among the scopes");
            expect(await page.evaluate<string>(`document.querySelector("[role=dialog]").textContent`)).not.toContain("Home (this server only)");
            expect(page.exceptions).toEqual([]);
        } finally {
            await page.close();
            served.stop();
        }
    });
});
