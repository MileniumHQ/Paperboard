// What the service saves is what a person has: the bot from before several
// bots moves into the list token and commands alone, a saved list it can't
// read is left as it is, and a switch whose save failed goes back.
import { afterAll, afterEach, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { secretsApi } from "@mileniumhq/paperapi";
import { LEGACY_TOKEN_NAME, tokenName, type BotsServiceState } from "../src/bots";
import { GLOBAL_SCOPE } from "../src/types";
import { testDaemon } from "./helpers/daemon";
import { guild, startFakeDiscord, type FakeDiscord } from "./helpers/discord";
import { call, PANEL_ID, savedBots, startService, stopServices, storedBot } from "./helpers/service";
import { stateWhere } from "./helpers/wait";

// each wait below has its own bound; a test as a whole may take longer than bun's 5 s default
setDefaultTimeout(60_000);

let discord: FakeDiscord;
beforeAll(() => {
    discord = startFakeDiscord();
});
afterAll(() => discord.stop());
afterEach(stopServices);

const configFile = async () => path.join((await testDaemon()).dataDir, "configs", `${PANEL_ID}.json`);
const command = (name: string) => ({ id: `c-${name}`, name, description: `The ${name} command`, scope: GLOBAL_SCOPE, options: [], userInstall: false });

describe("the saved bots", () => {
    test("the bot from before several bots becomes the first bot, with its token and commands, and the old token goes", async () => {
        const fake = discord.addBot({ username: "Old Timer", guilds: [guild("Home")] });
        const file = await configFile();
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify({ configured: true, applicationId: fake.appId, commands: [command("ping")], theme: "kept" }));
        await secretsApi.set(LEGACY_TOKEN_NAME, fake.token, PANEL_ID);

        await startService({ discordApi: discord.api });
        const state = await stateWhere<BotsServiceState>(PANEL_ID, (s) => Boolean(s.bots[0]?.connected), "the moved bot to connect");
        expect(state.bots).toHaveLength(1);
        const [bot] = state.bots;
        expect(bot).toMatchObject({ name: "Old Timer", applicationId: fake.appId, enabled: true, hasToken: true });
        expect(bot.commands.map((c) => c.name)).toEqual(["ping"]);

        const saved = JSON.parse(fs.readFileSync(file, "utf8"));
        expect(saved).toMatchObject({ version: 2, theme: "kept", bots: [{ id: bot.id, applicationId: fake.appId, commands: [{ id: "c-ping", name: "ping" }] }] });
        expect(saved.configured).toBeUndefined();
        expect(await secretsApi.get(tokenName(bot.id), PANEL_ID)).toMatchObject({ found: true, value: fake.token });
        expect((await secretsApi.get(LEGACY_TOKEN_NAME, PANEL_ID)).found).toBe(false);
    });

    test("a move whose save fails leaves no copy of the token behind, and the next start moves it once", async () => {
        const fake = discord.addBot({ username: "Mover" });
        const file = await configFile();
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify({ configured: true, applicationId: fake.appId, commands: [] }));
        await secretsApi.set(LEGACY_TOKEN_NAME, fake.token, PANEL_ID);
        // the tokens earlier tests left in the suite's vault
        const others = (await secretsApi.list(PANEL_ID)).filter((name) => name !== LEGACY_TOKEN_NAME);
        const tokens = async () => (await secretsApi.list(PANEL_ID)).filter((name) => !others.includes(name));

        fs.chmodSync(path.dirname(file), 0o555);
        try {
            const service = await startService({ discordApi: discord.api });
            const state = await stateWhere<BotsServiceState>(PANEL_ID, (s) => Boolean(s.botsError), "the failed move");
            expect(state.botsError).toContain("Could not save the bots");
            expect(state.bots).toEqual([]);
            await service.stop();
        } finally {
            fs.chmodSync(path.dirname(file), 0o755);
        }
        expect(await tokens()).toEqual([LEGACY_TOKEN_NAME]);

        await startService({ discordApi: discord.api });
        const [bot] = (await stateWhere<BotsServiceState>(PANEL_ID, (s) => s.bots.length === 1, "the moved bot")).bots;
        expect(await tokens()).toEqual([tokenName(bot.id)]);
    });

    test("a saved command that is damaged refuses the saved bots, which are never written over", async () => {
        const fake = discord.addBot({ username: "Damaged" });
        await savedBots([{ stored: storedBot("b-damaged", fake.appId, { commands: [command("ping"), { ...command("ping"), id: "c-again" }] }), token: fake.token }]);
        const file = await configFile();
        const before = fs.readFileSync(file, "utf8");

        await startService({ discordApi: discord.api });
        const state = await stateWhere<BotsServiceState>(PANEL_ID, (s) => Boolean(s.botsError), "the refusal");
        expect(state.botsError).toContain("bot 1 in the saved list: saved command 2 (/ping) is damaged: /ping is saved twice");
        expect(state.bots).toEqual([]);
        await expect(call.markSetupGuideSeen()).rejects.toThrow("Bot Creator couldn't read its saved bots, so nothing is changed");
        expect(fs.readFileSync(file, "utf8")).toBe(before);
    });

    test("a switch whose save failed goes back, and the next save keeps the bot as it was", async () => {
        const fake = discord.addBot({ username: "Steady" });
        await savedBots([{ stored: storedBot("b-steady", fake.appId), token: fake.token }]);
        await startService({ discordApi: discord.api });
        await stateWhere<BotsServiceState>(PANEL_ID, (s) => Boolean(s.bots[0]?.connected), "the bot to connect");
        const file = await configFile();

        fs.chmodSync(path.dirname(file), 0o555);
        try {
            await expect(call.disconnectBot({ bot: "b-steady" })).rejects.toThrow("Could not save the bots");
        } finally {
            fs.chmodSync(path.dirname(file), 0o755);
        }
        // the next announcement and the next save both say what is saved: on
        await call.markSetupGuideSeen();
        const state = await stateWhere<BotsServiceState>(PANEL_ID, () => true, "the bots");
        expect(state.bots[0]).toMatchObject({ enabled: true, connected: true });
        expect(JSON.parse(fs.readFileSync(file, "utf8")).bots[0].enabled).toBe(true);
    });
});

// A deleted bot's commands don't outlive it on Discord: once its token is
// gone nothing can take them off the server's command picker.
describe("deleting a bot", () => {
    test("an online bot's slash commands are taken off Discord in every scope before it goes", async () => {
        const home = guild("Home");
        const fake = discord.addBot({ username: "Leaver", guilds: [home] });
        const commands = [command("ping"), { ...command("hello"), id: "c-home", scope: home.id }];
        await savedBots([{ stored: storedBot("b-leave", fake.appId, { name: "Leaver", commands }), token: fake.token }]);
        await startService({ discordApi: discord.api });
        await stateWhere<BotsServiceState>(PANEL_ID, (s) => Boolean(s.bots[0]?.connected), "Leaver to connect");
        const guildCommands = `/applications/${fake.appId}/guilds/${home.id}/commands`;
        await discord.request((r) => r.method === "PUT" && r.path === guildCommands, "the commands synced at login");

        const before = discord.requests.length;
        expect(await call.deleteBot({ bot: "b-leave" })).toEqual({ deleted: "b-leave" });
        const cleared = discord.requests.slice(before).filter((r) => r.method === "PUT" && r.path.startsWith(`/applications/${fake.appId}/`));
        expect(cleared.map((r) => [r.path, r.body]).sort()).toEqual([
            [`/applications/${fake.appId}/commands`, []],
            [guildCommands, []],
        ].sort());
    });

    test("a bot that is off has its commands cleared with its token alone, never logging in", async () => {
        const home = guild("Home");
        const fake = discord.addBot({ username: "Sleeper", guilds: [home] });
        const commands = [command("ping"), { ...command("hello"), id: "c-home", scope: home.id }];
        await savedBots([{ stored: storedBot("b-sleep", fake.appId, { name: "Sleeper", enabled: false, commands }), token: fake.token }]);
        await startService({ discordApi: discord.api });
        await stateWhere<BotsServiceState>(PANEL_ID, (s) => s.bots[0]?.name === "Sleeper", "Sleeper");

        const before = discord.requests.length;
        expect(await call.deleteBot({ bot: "b-sleep" })).toEqual({ deleted: "b-sleep" });
        const made = discord.requests.slice(before).filter((r) => r.bot === fake.token);
        expect(made.map((r) => [r.method, r.path, r.body]).sort()).toEqual([
            ["PUT", `/applications/${fake.appId}/commands`, []],
            ["PUT", `/applications/${fake.appId}/guilds/${home.id}/commands`, []],
        ].sort());
    });

    test("a bot whose token Discord refuses is kept, saying why, until it is deleted anyway", async () => {
        const home = guild("Home");
        const fake = discord.addBot({ username: "Revoked", guilds: [home] });
        // the token was reset in the Developer Portal: the saved one names the application but no longer works
        const revoked = `${fake.token.slice(0, -1)}${fake.token.endsWith("x") ? "y" : "x"}`;
        await savedBots([{ stored: storedBot("b-revoked", fake.appId, { name: "Revoked", enabled: false, commands: [{ ...command("hello"), scope: home.id }] }), token: revoked }]);
        await startService({ discordApi: discord.api });
        await stateWhere<BotsServiceState>(PANEL_ID, (s) => s.bots[0]?.name === "Revoked", "Revoked");

        expect(await call.deleteBot({ bot: "b-revoked" })).toEqual({ refused: `Guild ${home.id}: 401: Unauthorized` });
        expect((await stateWhere<BotsServiceState>(PANEL_ID, () => true, "the bots")).bots.map((b) => b.id)).toEqual(["b-revoked"]);
        expect((await secretsApi.get(tokenName("b-revoked"), PANEL_ID)).found).toBe(true);

        // anyway skips Discord: the bot, its token and its list entry go
        const before = discord.requests.length;
        expect(await call.deleteBot({ bot: "b-revoked", anyway: true })).toEqual({ deleted: "b-revoked" });
        expect(discord.requests.slice(before)).toEqual([]);
        expect((await stateWhere<BotsServiceState>(PANEL_ID, (s) => s.bots.length === 0, "the bot to go")).bots).toEqual([]);
        expect((await secretsApi.get(tokenName("b-revoked"), PANEL_ID)).found).toBe(false);
        expect(JSON.parse(fs.readFileSync(await configFile(), "utf8")).bots).toEqual([]);
    });
});

// A command deleted while its bot is off is gone from Discord: the next login
// sets only the scopes that still have commands.
describe("deleting a command while the bot is off", () => {
    test("a server's last command is cleared with the token at once, and stays gone when the bot logs in", async () => {
        const home = guild("Home");
        const fake = discord.addBot({ username: "Napper", guilds: [home] });
        const hello = { ...command("hello"), id: "c-home", scope: home.id };
        await savedBots([{ stored: storedBot("b-nap", fake.appId, { name: "Napper", enabled: false, commands: [command("ping"), hello] }), token: fake.token }]);
        await startService({ discordApi: discord.api });
        await stateWhere<BotsServiceState>(PANEL_ID, (s) => s.bots[0]?.name === "Napper", "Napper");
        const guildCommands = `/applications/${fake.appId}/guilds/${home.id}/commands`;

        expect(await call.deleteCommand({ bot: "b-nap", id: "c-home" })).toMatchObject({ registered: false, syncError: null, triggerError: null });
        const cleared = discord.requests.filter((r) => r.method === "PUT" && r.path === guildCommands);
        expect(cleared.map((r) => [r.bot, r.body])).toEqual([[fake.token, []]]);

        await call.connectBot({ bot: "b-nap" });
        await discord.request((r) => r.method === "PUT" && r.path === `/applications/${fake.appId}/commands`, "the commands synced at login");
        expect(discord.requests.filter((r) => r.method === "PUT" && r.path === guildCommands).map((r) => r.body)).toEqual([[]]);
    });
});
