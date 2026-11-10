import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { Client, GatewayIntentBits } from "discord.js";
import { syncSlashCommands } from "../src/session";
import { GLOBAL_SCOPE, type SlashCommandDefinition } from "../src/types";
import { guild, snowflake, type RecordedRequest } from "./helpers/discord";
import { recordedSession, useFakeDiscord } from "./helpers/session";

// each wait below has its own bound; a test as a whole may take longer than bun's 5 s default
setDefaultTimeout(60_000);

const discord = useFakeDiscord();

function command(name: string, scope: string, extra: Partial<SlashCommandDefinition> = {}): SlashCommandDefinition {
    return { id: crypto.randomUUID(), name, description: `The ${name} command`, scope, options: [], userInstall: false, ...extra };
}

const puts = (since: number, appId: string) =>
    discord()
        .requests.slice(since)
        .filter((r) => r.method === "PUT" && r.path.startsWith(`/applications/${appId}/`));
const scopeOf = (req: RecordedRequest) => req.path.split("/")[4] ?? GLOBAL_SCOPE;

// Sync is declarative and reports what it couldn't do.
describe("sync is declarative and reports what it couldn't do", () => {
    test("each scope is set to exactly its stored list, with explicit integration types", async () => {
        const home = guild("Home");
        const away = guild("Away");
        const fake = discord().addBot({ guilds: [home, away] });
        const bot = recordedSession("b-sync");
        bot.session.commands = [
            command("ping", GLOBAL_SCOPE, { userInstall: true, options: [{ id: "o1", name: "target", description: "Who", type: "user", required: true }] }),
            command("status", GLOBAL_SCOPE),
            command("hello", home.id),
        ];
        await bot.session.start(fake.token);
        const login = await discord().request((r) => r.method === "PUT" && r.path === `/applications/${fake.appId}/guilds/${home.id}/commands`, "the guild's commands");
        const global = await discord().request((r) => r.method === "PUT" && r.path === `/applications/${fake.appId}/commands`, "the global commands");
        expect(global.body).toEqual([
            { type: 1, name: "ping", description: "The ping command", options: [{ type: 6, name: "target", description: "Who", required: true }], integration_types: [0, 1] },
            { type: 1, name: "status", description: "The status command", options: [], integration_types: [0] },
        ].map((c) => expect.objectContaining(c)));
        expect(login.body).toEqual([expect.objectContaining({ name: "hello", integration_types: [0] })]);
        // a guild with no commands and no reason to clear is left alone
        expect(puts(0, fake.appId).map(scopeOf).sort()).toEqual([GLOBAL_SCOPE, home.id].sort());
        expect(bot.session.health().commandSyncError).toBeNull();

        // the last command of a scope removed: that scope is set to empty, the rest in full
        const before = discord().requests.length;
        bot.session.commands = bot.session.commands.filter((c) => c.scope === GLOBAL_SCOPE && c.name === "ping");
        expect(await bot.session.syncAfterMutation([home.id])).toEqual({ registered: true, syncError: null });
        const after = puts(before, fake.appId);
        expect(after.map(scopeOf).sort()).toEqual([GLOBAL_SCOPE, home.id].sort());
        expect(after.find((r) => scopeOf(r) === home.id)!.body).toEqual([]);
        expect(after.find((r) => scopeOf(r) === GLOBAL_SCOPE)!.body.map((c: any) => c.name)).toEqual(["ping"]);
    });

    test("an unknown guild is an error naming it while the other scopes still sync", async () => {
        const home = guild("Home");
        const gone = snowflake();
        const fake = discord().addBot({ guilds: [home] });
        const bot = recordedSession("b-unknown-guild");
        await bot.session.start(fake.token);
        await bot.until(() => bot.session.connected(), "the bot to connect");
        const before = discord().requests.length;
        bot.session.commands = [command("ping", GLOBAL_SCOPE), command("hello", home.id), command("lost", gone)];
        const result = await bot.session.syncAfterMutation();
        const message = `Guild ${gone} is not in this bot's server list; its commands were not registered.`;
        expect(result).toEqual({ registered: false, syncError: message });
        expect(bot.session.health().commandSyncError).toBe(message);
        expect(puts(before, fake.appId).map(scopeOf).sort()).toEqual([GLOBAL_SCOPE, home.id].sort());
    });

    test("a scope Discord refuses is reported with Discord's reason", async () => {
        const home = guild("Home");
        const fake = discord().addBot({ guilds: [home] });
        const bot = recordedSession("b-refused");
        await bot.session.start(fake.token);
        await bot.until(() => bot.session.connected(), "the bot to connect");
        // the bot was removed from the server on Discord's side; its cache still lists it
        fake.guilds = [];
        bot.session.commands = [command("hello", home.id)];
        expect(await bot.session.syncAfterMutation()).toEqual({ registered: false, syncError: "Guild Home: Missing Access" });
    });

    test("a client without an application rejects instead of reporting success", async () => {
        const client = new Client({ intents: [GatewayIntentBits.Guilds] });
        try {
            await expect(syncSlashCommands(client, [command("ping", GLOBAL_SCOPE)])).rejects.toThrow(
                "Discord application is not available on this client; commands were not registered.",
            );
        } finally {
            await client.destroy();
        }
    });

    test("a bot that is offline reports its commands as not registered, without an error", async () => {
        const bot = recordedSession("b-offline");
        bot.session.commands = [command("ping", GLOBAL_SCOPE)];
        const before = discord().requests.length;
        expect(await bot.session.syncAfterMutation()).toEqual({ registered: false, syncError: null });
        expect(discord().requests.length).toBe(before);
    });
});
