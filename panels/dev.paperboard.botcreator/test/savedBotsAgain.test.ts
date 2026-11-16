// Reading the saved bots again after they couldn't be read at the start.
import { afterAll, afterEach, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import type { BotsServiceState } from "../src/bots";
import { GLOBAL_SCOPE } from "../src/types";
import { testDaemon } from "./helpers/daemon";
import { startFakeDiscord, type FakeDiscord } from "./helpers/discord";
import { call, PANEL_ID, savedBots, startService, stopServices, storedBot } from "./helpers/service";
import { stateWhere } from "./helpers/wait";

setDefaultTimeout(60_000);

let discord: FakeDiscord;
beforeAll(() => {
    discord = startFakeDiscord();
});
afterAll(() => discord.stop());
afterEach(stopServices);

const configFile = async () => path.join((await testDaemon()).dataDir, "configs", `${PANEL_ID}.json`);
const command = (name: string) => ({ id: `c-${name}`, name, description: `The ${name} command`, scope: GLOBAL_SCOPE, options: [], userInstall: false });

describe("the saved bots read again", () => {
    test("reading the saved bots again keeps the refusal while they are damaged, and once mended brings the bots up as at a start", async () => {
        const fake = discord.addBot({ username: "Mended" });
        const damaged = storedBot("b-mended", fake.appId, { commands: [command("ping"), { ...command("ping"), id: "c-again" }] });
        await savedBots([{ stored: damaged, token: fake.token }]);
        const file = await configFile();
        const before = fs.readFileSync(file, "utf8");

        await startService({ discordApi: discord.api });
        await stateWhere<BotsServiceState>(PANEL_ID, (s) => Boolean(s.botsError), "the refusal");
        await expect(call.readBotsAgain()).rejects.toThrow("/ping is saved twice");
        expect((await stateWhere<BotsServiceState>(PANEL_ID, () => true, "the state")).botsError).toContain("/ping is saved twice");
        expect(fs.readFileSync(file, "utf8")).toBe(before);

        fs.writeFileSync(file, JSON.stringify({ version: 2, bots: [storedBot("b-mended", fake.appId, { commands: [command("ping")] })] }));
        await call.readBotsAgain();
        const state = await stateWhere<BotsServiceState>(PANEL_ID, (s) => !s.botsError && Boolean(s.bots[0]?.connected), "the bot read again and connected");
        expect(state.bots.map((b) => b.id)).toEqual(["b-mended"]);
        // read: nothing more to do, and the bots work as after any start
        await call.readBotsAgain();
        await call.markSetupGuideSeen();
    });
});
