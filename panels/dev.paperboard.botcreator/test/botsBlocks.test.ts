// Bot Creator run from Blocks: the panel's own blocks turn bots on and off,
// and delete them and their slash commands, through the real service, its
// vault and a loopback Discord, the way the Blocks panel runs them. A bot is
// added the way Bot Creator adds one: its token straight to the vault.
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { blocksApi, secretsApi } from "@mileniumhq/paperapi";
import { createBotId, tokenName, type BotsServiceState } from "../src/bots";
import { testDaemon } from "./helpers/daemon";
import { guild, startFakeDiscord, type FakeBot, type FakeDiscord, type FakeGuild } from "./helpers/discord";
import { call, PANEL_ID, savedBots, startService, stopServices } from "./helpers/service";
import { stateWhere, within } from "./helpers/wait";

// each wait below has its own bound; a test as a whole may take longer than bun's 5 s default
setDefaultTimeout(60_000);

const type = (id: string) => `${PANEL_ID}:${id}`;
const run = <T = any>(command: string, inputs: Record<string, unknown> = {}) => blocksApi.run<T>(PANEL_ID, command, inputs);
const read = <T = any>(value: string, inputs?: Record<string, unknown>) => blocksApi.read<T>(PANEL_ID, value, inputs);
const field = <T = any>(bot: string, name: string) => blocksApi.property<T>(type("bot"), name, bot);

/** Every payload the panel's event fires from now on. */
async function heard(event: string): Promise<{ payloads: Record<string, unknown>[]; next: () => Promise<Record<string, unknown>>; off: () => void }> {
    const payloads: Record<string, unknown>[] = [];
    const off = blocksApi.onEvent(PANEL_ID, event, (payload) => payloads.push(payload));
    // a subscription reaches the daemon on its own; let it land first
    await new Promise((resolve) => setTimeout(resolve, 300));
    let seen = 0;
    const next = () =>
        within(`${event} to fire`, (async () => {
            while (payloads.length <= seen) await new Promise((resolve) => setTimeout(resolve, 20));
            return payloads[seen++]!;
        })());
    return { payloads, next, off };
}

describe("Bot Creator is run from Blocks by the panel's own blocks", () => {
    let discord: FakeDiscord;
    let fake: FakeBot;
    let other: FakeBot;
    let home: FakeGuild;
    beforeAll(async () => {
        discord = startFakeDiscord();
        home = guild("Home");
        fake = discord.addBot({ username: "Blocky", guilds: [home] });
        other = discord.addBot({ username: "Other" });
        await savedBots([]);
        await startService({ discordApi: discord.api });
    });
    afterAll(async () => {
        await stopServices();
        discord.stop();
    });

    test("a bot is added, driven, given a slash command and deleted, with its token only in the vault", async () => {
        expect(await read("bots")).toEqual([]);
        const added = await heard("bot-added");
        const online = await heard("bot-online");
        const offline = await heard("bot-offline");
        const deleted = await heard("bot-deleted");
        try {
            // no block takes a token: a flow would keep it as plain text
            const entries = (await blocksApi.list(PANEL_ID)).map((b) => b.entry);
            expect(entries).not.toContain("command.add-bot");
            expect(entries).not.toContain("command.replace-bot-token");

            // as Bot Creator adds one: the token to the vault, then the bot by its id
            const bot = createBotId();
            await secretsApi.set(tokenName(bot), fake.token, PANEL_ID);
            expect((await call<{ id: string }>("add-bot", { bot })).id).toBe(bot);
            expect(await added.next()).toEqual({ bot });
            expect(await online.next()).toEqual({ bot });
            expect(await read("bots")).toEqual([bot]);
            expect(await blocksApi.choices(PANEL_ID, "value.bot", "bot")).toEqual([{ label: "Blocky", value: bot }]);
            expect(await read("bot", { bot })).toBe(bot);

            // the token is in the vault, never in the saved bot list
            expect((await secretsApi.get(tokenName(bot), PANEL_ID)).value).toBe(fake.token);
            const saved = fs.readFileSync(path.join((await testDaemon()).dataDir, "configs", `${PANEL_ID}.json`), "utf8");
            expect(saved).toContain(bot);
            expect(saved).not.toContain(fake.token);

            expect(await field(bot, "name")).toBe("Blocky");
            expect(await field(bot, "online")).toBe(true);
            expect(await field(bot, "status")).toBe("online");
            expect(await field(bot, "user")).toBe(fake.appId);
            expect(await field(bot, "servers")).toEqual([home.id]);
            expect(await field(bot, "server-count")).toBe(1);
            expect(await read<string>("invite-link", { bot })).toContain(`client_id=${fake.appId}`);

            // a slash command made by a block is the bot's, on Discord, and gone once deleted by another
            const option = await run("create-command-option", { type: "integer", name: "sides", description: "How many sides", required: true });
            const command = await run("create-slash-command", { name: "roll", bot, description: "Roll a die", options: [option], dms: false });
            expect(command).toMatchObject({ bot, name: "roll", description: "Roll a die", server: null, "usable-in-dms": false });
            expect(await field(bot, "slash-commands")).toEqual([command]);
            const put = discord.requests.filter((r) => r.method === "PUT" && r.path === `/applications/${fake.appId}/commands`).at(-1);
            expect(put?.body).toMatchObject([{ name: "roll", options: [{ name: "sides", type: 4, required: true }] }]);
            await expect(run("create-slash-command", { name: "roll", bot, description: "Again", dms: false })).rejects.toThrow("A command named /roll already exists");
            await run("delete-slash-command", { command });
            expect(await field(bot, "slash-commands")).toEqual([]);

            await run("turn-off-bot", { bot });
            expect(await offline.next()).toEqual({ bot, error: null });
            expect(await field(bot, "online")).toBe(false);
            expect(await field(bot, "status")).toBe("turned off");
            await expect(run("restart-bot", { bot })).rejects.toThrow("Blocky is turned off. Turn it on instead.");
            await run("turn-on-bot", { bot });
            expect(await online.next()).toEqual({ bot });
            await stateWhere<BotsServiceState>(PANEL_ID, (s) => s.bots[0]?.enabled === true && s.bots[0]?.connected, "Blocky to be on");

            await run("delete-bot", { bot });
            expect(await deleted.next()).toEqual({ name: "Blocky" });
            expect(await read("bots")).toEqual([]);
            expect((await secretsApi.get(tokenName(bot), PANEL_ID)).found).toBe(false);
            expect(await blocksApi.projects(PANEL_ID)).toEqual([]);
            await expect(field(bot, "name")).rejects.toThrow(`There's no bot "${bot}" in Bot Creator`);
            await expect(run("turn-on-bot", { bot })).rejects.toThrow(`There's no bot "${bot}" in Bot Creator`);
        } finally {
            for (const listener of [added, online, offline, deleted]) listener.off();
        }
    });
});
