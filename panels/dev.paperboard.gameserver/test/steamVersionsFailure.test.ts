// A Steam game's Updates page asks Steam for the newest build when it
// opens. When SteamCMD can't answer, the page says what failed where the
// check stands, on its first line, and keeps what SteamCMD printed under
// Details, to read and copy. It is never a toast: the failure stays.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { startTestDaemon, type TestDaemon } from "./helpers/crane";
import { openPage, servePanel } from "./helpers/browser";
import { freePort, installPalworld } from "./helpers/palworld";
import { fakeSteamcmd, STEAM_FIXTURES } from "./helpers/steamcmd";
import { PANEL_ID } from "../src/servers";
import { PALWORLD_APP_ID } from "../src/games/palworld";

let daemon: TestDaemon;
beforeAll(async () => {
    daemon = await startTestDaemon();
});
afterAll(async () => {
    await daemon?.stop();
});

const SERVERS = "servers-0123456789ab";
const configFile = () => path.join(daemon.dataDir, "configs", `${PANEL_ID}.json`);
const serverDir = () => path.join(daemon.dataDir, "files", PANEL_ID, SERVERS, "s-pal");
const TITLE = "Couldn't check Palworld for updates";
const failure = `document.querySelector(${JSON.stringify(`[data-paper-error][aria-label="${TITLE}"]`)})`;

describe("the Updates page when SteamCMD can't say the newest build", () => {
    test("the page says what failed in place, and SteamCMD's own output is under Details in full", async () => {
        fs.mkdirSync(path.dirname(configFile()), { recursive: true });
        fs.writeFileSync(configFile(), JSON.stringify({ version: 2, serversDirectory: SERVERS, servers: [{ id: "s-pal", name: "Pals", game: "palworld", directory: `${SERVERS}/s-pal`, createdAt: 0, settings: { configured: true, port: await freePort(), restPort: await freePort() } }] }));
        installPalworld(serverDir());
        // SteamCMD's answer is cut short: the reader throws, quoting what SteamCMD printed
        fakeSteamcmd({ appInfo: { [PALWORLD_APP_ID]: path.join(STEAM_FIXTURES, "palworld-app-info.txt") }, truncateInfo: true });
        const { gameServerService } = await import("../src/service");
        await gameServerService.ready;
        const served = await servePanel(daemon);
        const page = await openPage(`${served.url}/?server=s-pal`);
        try {
            await page.waitFor(`document.querySelector('input[name=serverMenu][value="versions"]')`, "the server menu");
            await page.click('input[name=serverMenu][value="versions"]');
            await page.waitFor(failure, "the failed check");
            expect(await page.evaluate<number>(`document.querySelectorAll("[data-paper-toasts] [role=alert]").length`)).toBe(0);
            const first = await page.evaluate<string>(`${failure}.querySelector("[data-preset=hint]").innerText`);
            expect(first).toBe(`Could not read the newest build of app ${PALWORLD_APP_ID}: ${first.split(": ").slice(1).join(": ")}`);
            expect(first).not.toContain("\n");
            await page.evaluate(`[...${failure}.querySelectorAll("button")].find((b) => b.innerText.includes("Details")).click()`);
            await page.waitFor(`${failure}.querySelector("button[aria-expanded=true]")`, "Details opened");
            const output = await page.evaluate<string>(`${failure}.querySelector("pre, code").innerText`);
            // SteamCMD's own lines, as it printed them
            expect(output.split("\n").length).toBeGreaterThan(2);
            expect(output).toContain('"download"');
            expect(page.exceptions).toEqual([]);
        } finally {
            await page.close();
            served.stop();
        }
    }, 60_000);
});
