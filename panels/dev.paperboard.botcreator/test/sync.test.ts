import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { GLOBAL_SCOPE, type SlashCommandDefinition } from "../src/types";
import { guild, type RecordedRequest } from "./helpers/discord";
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
        expect(bot.session.syncError()).toBeNull();

        // the last command of a scope removed: that scope is set to empty, the rest in full
        const before = discord().requests.length;
        bot.session.commands = bot.session.commands.filter((c) => c.scope === GLOBAL_SCOPE && c.name === "ping");
        expect(await bot.session.syncCommands([home.id])).toEqual({ registered: true, syncError: null });
        const after = puts(before, fake.appId);
        expect(after.map(scopeOf).sort()).toEqual([GLOBAL_SCOPE, home.id].sort());
        expect(after.find((r) => scopeOf(r) === home.id)!.body).toEqual([]);
        expect(after.find((r) => scopeOf(r) === GLOBAL_SCOPE)!.body.map((c: any) => c.name)).toEqual(["ping"]);
    });
});
