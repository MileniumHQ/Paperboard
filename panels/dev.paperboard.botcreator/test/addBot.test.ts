// Adding a bot and replacing its token: the page saves the token in the
// vault under the bot's id and the service keeps the bot once it logs in.
// A token that isn't kept (not a bot token, a bot that already runs, a
// login Discord refuses) is forgotten with everything made for it.
import { afterAll, afterEach, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { blocksApi, secretsApi } from "@mileniumhq/paperapi";
import { tokenName, type BotsServiceState } from "../src/bots";
import { startFakeDiscord, type FakeDiscord } from "./helpers/discord";
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

/** What the page does to add a bot: the token in the vault, then the call. */
async function add(id: string, token: string) {
    await secretsApi.set(tokenName(id), token, PANEL_ID);
    return call("addBot", { bot: id });
}

/** Nothing is left of a bot that wasn't added: no token and no Blocks project. */
async function forgotten(id: string) {
    expect((await secretsApi.get(tokenName(id), PANEL_ID)).found).toBe(false);
    expect((await blocksApi.projects(PANEL_ID)).map((p) => p.id)).not.toContain(id);
}

describe("adding a bot", () => {
    test("a bot that logs in is kept, and refused ones leave nothing behind", async () => {
        await savedBots([]);
        await startService({ discordApi: discord.api });

        await expect(add("b-garbage", "not a token")).rejects.toThrow("That isn't a Discord bot token.");
        await forgotten("b-garbage");

        // shaped like a bot token, for an application Discord doesn't know
        const unknown = `${Buffer.from("1234567890123456789").toString("base64url")}.AAAAAA.${"x".repeat(27)}`;
        await expect(add("b-refused", unknown)).rejects.toThrow("Discord login failed");
        await forgotten("b-refused");

        const fake = discord.addBot({ username: "Newcomer" });
        const added = await add("b-new", fake.token);
        expect(added).toMatchObject({ id: "b-new", name: "Newcomer", applicationId: fake.appId, connected: true, hasToken: true });
        expect((await blocksApi.projects(PANEL_ID)).map((p) => p.id)).toEqual(["b-new"]);

        await expect(add("b-twin", fake.token)).rejects.toThrow("Newcomer already uses this bot. One bot can only run once.");
        await forgotten("b-twin");
        // the bot that runs keeps its own token
        expect(await secretsApi.get(tokenName("b-new"), PANEL_ID)).toMatchObject({ found: true, value: fake.token });

        const state = await stateWhere<BotsServiceState>(PANEL_ID, (s) => s.bots.length === 1, "the one bot");
        expect(state.bots.map((b) => b.id)).toEqual(["b-new"]);
    });

    test("the same token added twice at once is added once", async () => {
        await savedBots([]);
        await startService({ discordApi: discord.api });
        const fake = discord.addBot({ username: "Doubled" });

        const results = await Promise.allSettled([add("b-first", fake.token), add("b-second", fake.token)]);
        const kept = results.filter((r) => r.status === "fulfilled");
        const refused = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
        expect(kept).toHaveLength(1);
        expect(refused).toHaveLength(1);
        expect(String(refused[0]!.reason)).toContain("One bot can only run once.");

        const state = await stateWhere<BotsServiceState>(PANEL_ID, (s) => s.bots.length > 0 && s.bots.every((b) => b.connected), "the added bot");
        expect(state.bots).toHaveLength(1);
        expect((await blocksApi.projects(PANEL_ID)).map((p) => p.id)).toEqual([state.bots[0]!.id]);
    });
});

describe("replacing a bot's token", () => {
    test("a bot with no token connects once a new one is saved", async () => {
        const fake = discord.addBot({ username: "Lost Key" });
        await savedBots([{ stored: storedBot("b-lost", fake.appId, { name: "Lost Key" }) }]);
        await startService({ discordApi: discord.api });
        await stateWhere<BotsServiceState>(PANEL_ID, (s) => s.bots[0]?.lastError === "No token is saved for this bot. Replace its token in Configuration.", "the missing token");

        await secretsApi.set(tokenName("b-lost"), fake.token, PANEL_ID);
        await call("replaceToken", { bot: "b-lost" });
        const state = await stateWhere<BotsServiceState>(PANEL_ID, (s) => Boolean(s.bots[0]?.connected), "the bot to connect");
        expect(state.bots[0]).toMatchObject({ hasToken: true, lastError: null });
    });
});
