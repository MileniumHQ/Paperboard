import { afterAll, afterEach, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { blocksApi } from "@mileniumhq/paperapi";
import { commandEventId } from "../src/blocks/events";
import type { BotsServiceState } from "../src/bots";
import { GLOBAL_SCOPE, type CommandMutationResult } from "../src/types";
import { guild, slashCommand, startFakeDiscord, type FakeDiscord } from "./helpers/discord";
import { call, PANEL_ID, savedBots, startService, stopServices, storedBot } from "./helpers/service";
import { nextEvent as nextEventOf, stateWhere } from "./helpers/wait";

// each wait below has its own bound; a test as a whole may take longer than bun's 5 s default
setDefaultTimeout(60_000);

let discord: FakeDiscord;
beforeAll(() => {
    discord = startFakeDiscord();
});
afterAll(() => discord.stop());
afterEach(stopServices);

const BOT = "b-triggers";

async function registered(event: string): Promise<any | undefined> {
    return (await blocksApi.list(PANEL_ID)).find((b) => b.entry === `${BOT}/event.${event}`);
}

const nextEvent = (event: string) => nextEventOf(PANEL_ID, event, BOT);

// Command events stay bound.
describe("command events stay bound", () => {
    test("a command's event is keyed by scope and name, survives delete and recreate, and resolves guild before global", async () => {
        const home = guild("Home");
        const away = guild("Away");
        const fake = discord.addBot({ username: "Dice", guilds: [home, away] });
        await savedBots([{ stored: storedBot(BOT, fake.appId), token: fake.token }]);
        await startService({ discordApi: discord.api });
        await stateWhere<BotsServiceState>(PANEL_ID, (s) => Boolean(s.bots[0]?.connected), "the bot to connect");

        const roll = { bot: BOT, name: "roll", description: "Roll a die", options: [{ name: "sides", description: "How many sides", type: "integer" as const, required: true }] };
        const globalRoll = commandEventId({ scope: GLOBAL_SCOPE, name: "roll" });
        const homeRoll = commandEventId({ scope: home.id, name: "roll" });
        const first = await call.createCommand(roll);
        expect(first).toMatchObject({ registered: true, syncError: null, triggerError: null });
        const event = await registered(globalRoll);
        expect(event).toBeDefined();
        // each parameter is its own typed value a flow reads directly
        expect(event.schema.values["option-sides"]).toMatchObject({ type: "number", name: "sides" });
        expect(event.schema.values.interaction).toMatchObject({ type: `${PANEL_ID}:interaction` });

        // deleting and recreating keeps the event id, so flows bound to it keep working
        await call.deleteCommand({ bot: BOT, id: first.command.id });
        expect(await registered(globalRoll)).toBeUndefined();
        const again = await call.createCommand(roll);
        expect(again.command.id).not.toBe(first.command.id);
        expect(await registered(globalRoll)).toBeDefined();

        // the same name in one server: that server's invocations are its own
        await call.createCommand({ ...roll, scope: home.id });
        expect(await registered(homeRoll)).toBeDefined();
        const inHome = nextEvent(homeRoll);
        await inHome.ready;
        discord.dispatch(fake, "INTERACTION_CREATE", slashCommand(fake, { guild: home, name: "roll", options: [{ name: "sides", type: 4, value: 6 }] }));
        expect(await inHome.payload).toMatchObject({ server: home.id, "option-sides": 6 });
        const inAway = nextEvent(globalRoll);
        await inAway.ready;
        discord.dispatch(fake, "INTERACTION_CREATE", slashCommand(fake, { guild: away, name: "roll", options: [{ name: "sides", type: 4, value: 20 }] }));
        expect(await inAway.payload).toMatchObject({ server: away.id, "option-sides": 20 });
    });
});
