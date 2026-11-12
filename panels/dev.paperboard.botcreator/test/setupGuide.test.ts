// The setup guide for making a Discord application shows once: until it is
// finished or skipped, and never to a computer that already has a bot.
import { afterAll, afterEach, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { serviceApi } from "@mileniumhq/paperapi";
import type { BotsServiceState } from "../src/bots";
import { testDaemon } from "./helpers/daemon";
import { startFakeDiscord, type FakeDiscord } from "./helpers/discord";
import { PANEL_ID, savedBots, startService, stopServices, storedBot } from "./helpers/service";
import { stateWhere } from "./helpers/wait";

setDefaultTimeout(60_000);

let discord: FakeDiscord;
beforeAll(() => {
    discord = startFakeDiscord();
});
afterAll(() => discord.stop());
afterEach(stopServices);

const state = () => stateWhere<BotsServiceState>(PANEL_ID, () => true, "the bots");
const configFile = async () => JSON.parse(fs.readFileSync(path.join((await testDaemon()).dataDir, "configs", `${PANEL_ID}.json`), "utf8"));

describe("the setup guide shows once", () => {
    test("a computer with no bots sees it until it is skipped, and skipping lasts across restarts", async () => {
        await savedBots([]);
        await startService({ discordApi: discord.api });
        expect((await state()).setupGuideSeen).toBe(false);

        await serviceApi.call(PANEL_ID, "markSetupGuideSeen", {});
        expect((await stateWhere<BotsServiceState>(PANEL_ID, (s) => s.setupGuideSeen, "the guide to be seen")).bots).toEqual([]);
        expect((await configFile()).setupGuideSeen).toBe(true);

        await stopServices();
        await startService({ discordApi: discord.api });
        expect((await state()).setupGuideSeen).toBe(true);
    });

    test("a computer that already has a bot has been through it, and that is saved for the day it has none", async () => {
        await savedBots([{ stored: storedBot("b-old", "123456789012345678") }]);
        await startService({ discordApi: discord.api });
        expect((await state()).setupGuideSeen).toBe(true);
        expect((await configFile()).setupGuideSeen).toBe(true);
    });
});
