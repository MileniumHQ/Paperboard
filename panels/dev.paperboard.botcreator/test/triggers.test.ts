import { afterAll, afterEach, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { actionsApi } from "@mileniumhq/paperapi";
import type { BotsServiceState } from "../src/bots";
import type { CommandMutationResult } from "../src/types";
import { guild, slashCommand, startFakeDiscord, type FakeDiscord } from "./helpers/discord";
import { call, PANEL_ID, savedBots, startService, stopServices, storedBot } from "./helpers/service";
import { stateWhere, within } from "./helpers/wait";

// each wait below has its own bound; a test as a whole may take longer than bun's 5 s default
setDefaultTimeout(60_000);

let discord: FakeDiscord;
beforeAll(() => {
    discord = startFakeDiscord();
});
afterAll(() => discord.stop());
afterEach(stopServices);

const BOT = "b-triggers";

async function registered(id: string): Promise<any | undefined> {
    return (await actionsApi.list(PANEL_ID)).find((a) => a.action === id);
}

function nextTrigger(trigger: string): Promise<any> {
    let off = () => {};
    return within(
        `${trigger} to fire`,
        new Promise((resolve) => {
            off = actionsApi.onTrigger(PANEL_ID, trigger, (output) => resolve(output));
        }),
    ).finally(() => off());
}

// Command triggers stay bound.
describe("command triggers stay bound", () => {
    test("a command's trigger is keyed by scope and name, survives delete and recreate, and resolves guild before global", async () => {
        const home = guild("Home");
        const away = guild("Away");
        const fake = discord.addBot({ username: "Dice", guilds: [home, away] });
        await savedBots([{ stored: storedBot(BOT, fake.appId), token: fake.token }]);
        await startService({ discordApi: discord.api });
        await stateWhere<BotsServiceState>(PANEL_ID, (s) => Boolean(s.bots[0]?.connected), "the bot to connect");

        const roll = { bot: BOT, name: "roll", description: "Roll a die", options: [{ name: "sides", description: "How many sides", type: "integer", required: true }] };
        const first = await call<CommandMutationResult & { event: string }>("create-command", roll);
        expect(first).toMatchObject({ registered: true, syncError: null, triggerError: null });
        const trigger = await registered(`${BOT}/command:global:roll`);
        expect(trigger).toBeDefined();
        // each parameter is its own typed field a flow reads directly
        const fields = trigger.schema.outputFields;
        expect(fields["values.sides"]).toEqual({ type: "number", label: "sides", typeName: "Integer" });
        expect(fields.interactionId).toMatchObject({ type: "discord-interaction" });

        // deleting and recreating keeps the trigger id, so flows bound to it keep working
        await call("delete-command", { bot: BOT, id: first.command.id });
        expect(await registered(`${BOT}/command:global:roll`)).toBeUndefined();
        const again = await call<CommandMutationResult>("create-command", roll);
        expect(again.command.id).not.toBe(first.command.id);
        expect(await registered(`${BOT}/command:global:roll`)).toBeDefined();

        // the same name in one server: that server's invocations are its own
        await call("create-command", { ...roll, scope: home.id });
        expect(await registered(`${BOT}/command:${home.id}:roll`)).toBeDefined();
        const inHome = nextTrigger(`${BOT}/command:${home.id}:roll`);
        discord.dispatch(fake, "INTERACTION_CREATE", slashCommand(fake, { guild: home, name: "roll", options: [{ name: "sides", type: 4, value: 6 }] }));
        expect(await inHome).toMatchObject({ commandName: "roll", scope: home.id, guildId: home.id, values: { sides: 6 } });
        const inAway = nextTrigger(`${BOT}/command:global:roll`);
        discord.dispatch(fake, "INTERACTION_CREATE", slashCommand(fake, { guild: away, name: "roll", options: [{ name: "sides", type: 4, value: 20 }] }));
        expect(await inAway).toMatchObject({ commandName: "roll", scope: "global", guildId: away.id, values: { sides: 20 } });
    });
});
