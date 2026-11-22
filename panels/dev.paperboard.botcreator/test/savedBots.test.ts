// What the service saves is what a person has: a saved list it can't
// read is left as it is, and a switch whose save failed goes back.
import { afterAll, afterEach, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import type { BotsServiceState } from "../src/bots";
import { GLOBAL_SCOPE } from "../src/types";
import { testDaemon } from "./helpers/daemon";
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

const configFile = async () => path.join((await testDaemon()).dataDir, "configs", `${PANEL_ID}.json`);
const command = (name: string) => ({ id: `c-${name}`, name, description: `The ${name} command`, scope: GLOBAL_SCOPE, options: [], userInstall: false });

describe("the saved bots", () => {
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

describe("stopping the service", () => {
    test("a save still on its way when Paperboard stops the service lands before it exits", async () => {
        const fake = discord.addBot({ username: "Late Saver" });
        await savedBots([{ stored: storedBot("b-late-saver", fake.appId, { enabled: false }), token: fake.token }]);
        const service = await startService({ discordApi: discord.api, entry: path.join(import.meta.dir, "fixtures/heldSave.ts") });
        // the page's switch: the service saves the bot on, and is stopped mid-save
        // (the call itself ends with the service, whichever way: the switch's save is what's checked)
        const switched = call.connectBot({ bot: "b-late-saver" }).then(() => undefined, () => undefined);
        await service.heard("test:saving");
        await service.stop();
        expect(JSON.parse(fs.readFileSync(await configFile(), "utf8")).bots).toMatchObject([{ id: "b-late-saver", enabled: true }]);
        await switched;
    });
});
