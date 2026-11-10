import { afterAll, afterEach, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { actionsApi } from "@mileniumhq/paperapi";
import type { BotsServiceState } from "../src/bots";
import { startFakeDiscord, type FakeDiscord } from "./helpers/discord";
import { PANEL_ID, savedBots, startService, stopServices, storedBot } from "./helpers/service";
import { stateWhere } from "./helpers/wait";

// each wait below has its own bound; a test as a whole may take longer than bun's 5 s default
setDefaultTimeout(60_000);

let discord: FakeDiscord;
beforeAll(() => {
    discord = startFakeDiscord();
});
afterAll(() => discord.stop());
afterEach(stopServices);

// Ready doesn't wait for Discord.
describe("ready doesn't wait for Discord", () => {
    test("the service is ready while a login never finishes; each bot reports its own start", async () => {
        const stuck = discord.addBot({ username: "Stuck", gateway: "rate-limited" });
        const fine = discord.addBot({ username: "Fine" });
        await savedBots([
            { stored: storedBot("b-stuck", stuck.appId), token: stuck.token },
            { stored: storedBot("b-broken", "223456789012345678"), token: "MjIzNDU2Nzg5MDEyMzQ1Njc4.unknown.token" },
            { stored: storedBot("b-fine", fine.appId), token: fine.token },
            { stored: storedBot("b-tokenless", "323456789012345678") },
        ]);
        const service = await startService({ discordApi: discord.api });
        // ready came while Discord still holds the stuck bot's login
        await discord.request((r) => r.path === "/gateway/bot" && r.bot === stuck.token, "the stuck bot's login");
        const registered = (await actionsApi.list(PANEL_ID)).map((a) => a.action);
        expect(registered).toContain("b-stuck/send-message");

        const state = await stateWhere<BotsServiceState>(
            PANEL_ID,
            (s) => {
                const bot = (id: string) => s.bots.find((b) => b.id === id);
                return Boolean(bot("b-fine")?.connected && bot("b-broken")?.lastError && bot("b-tokenless")?.lastError);
            },
            "the bots that can start to have started",
        );
        const byId = Object.fromEntries(state.bots.map((b) => [b.id, b]));
        expect(byId["b-stuck"]).toMatchObject({ connected: false, connecting: true, lastError: null });
        expect(byId["b-fine"]).toMatchObject({ connected: true, connecting: false, lastError: null, name: "Fine" });
        expect(byId["b-broken"]).toMatchObject({ connected: false, connecting: false, lastError: "An invalid token was provided." });
        expect(byId["b-tokenless"]).toMatchObject({ connected: false, connecting: false, hasToken: false, lastError: "No token is saved for this bot. Replace its token in Configuration." });
        expect(service.output()).toContain("Bot b-broken didn't connect: Discord login failed: An invalid token was provided.");
        // the stuck bot is still connecting: its login is Discord's to finish
        expect(await actionsApi.call(PANEL_ID, "get-bot-info", { bot: "b-stuck" })).toMatchObject({ connected: false, lastError: null });
    });
});
