// An online player's page asks the game for their health, food and
// experience: four console commands. It asks when the page opens, then on a
// slow poll, and never because other state arrived; the answers themselves
// are state that arrives, so asking on every push would never stop. An ask
// that fails says why on the page.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { processApi } from "@mileniumhq/paperapi";
import { startTestDaemon, type TestDaemon } from "./helpers/crane";
import { callServer } from "./helpers/serverCall";
import { openPage, servePanel, type Page } from "./helpers/browser";
import { installFakeJava } from "./helpers/fakeJava";
import { writeTree } from "./helpers/tmp";
import { PANEL_ID } from "../src/servers";
import { javaPackageFor } from "../src/lib/versionProfile";
import { minecraftCalls } from "../src/games/minecraft/calls";
import { CALLS } from "../src/service/contract";

let daemon: TestDaemon;
beforeAll(async () => {
    daemon = await startTestDaemon();
});
afterAll(async () => {
    await daemon?.stop();
});

const SERVERS = "servers-0123456789ab";
const openRow = (name: string) => `document.querySelector('input[name=playersList][value="${name}"]').closest("label, li, [role=radio]").click()`;

const dir = () => path.join(daemon.dataDir, "files", PANEL_ID, SERVERS, "s-mc");
let ready: Promise<void> | null = null;
/** one stopped Paper server whose game has Steve online, and the panel served */
async function setUp() {
    ready ??= (async () => {
        const config = path.join(daemon.dataDir, "configs", `${PANEL_ID}.json`);
        fs.mkdirSync(path.dirname(config), { recursive: true });
        fs.writeFileSync(config, JSON.stringify({ version: 2, serversDirectory: SERVERS, servers: [{ id: "s-mc", name: "Survival", game: "minecraft", directory: `${SERVERS}/s-mc`, createdAt: 0, settings: { configured: true, software: "paper", version: "1.21.1" } }] }));
        writeTree(dir(), { "server.jar": "jar", "eula.txt": "eula=true\n", "fake-server.json": JSON.stringify({ players: ["Steve"] }) });
        installFakeJava(javaPackageFor("1.21.1")!);
        const { gameServerService } = await import("../src/service");
        await gameServerService.ready;
    })();
    await ready;
    return servePanel(daemon);
}

/** starts the server, opens Steve's page, runs `body`, and stops the server again */
async function onSteve(body: (page: Page) => Promise<void>) {
    const served = await setUp();
    const exited = new Promise<void>((resolve) => processApi.onExit("s-mc-mc-server", () => resolve()));
    await callServer("s-mc", "start-server");
    const page = await openPage(`${served.url}/?server=s-mc`);
    try {
        await page.waitFor(`document.body.innerText.includes("ONLINE")`, "the server online");
        await page.click('input[name=serverMenu][value="players"]');
        // the Players tab asks who is online as it opens
        await page.waitFor(`document.querySelector('input[name=playersList][value="steve"]')`, "Steve online in the roster (the game lists names in lower case)");
        await page.evaluate(openRow("steve"));
        await body(page);
        expect(page.exceptions).toEqual([]);
    } finally {
        await page.close();
        await callServer("s-mc", "stop-server");
        await exited;
        served.stop();
    }
}

describe("an online player's page", () => {
    test("asks for their live stats once on opening, not again as state arrives", async () => {
        const statQueries = () =>
            (fs.existsSync(path.join(dir(), "commands.log")) ? fs.readFileSync(path.join(dir(), "commands.log"), "utf8") : "")
                .split("\n")
                .filter((line) => line.toLowerCase().startsWith("data get entity steve ") && !/ (Pos|Dimension)$/.test(line));
        const before = statQueries().length;
        await onSteve(async (page) => {
            await page.waitFor(`document.body.innerText.includes("Level 7")`, "Steve's live stats");
            await page.settled();
            expect(statQueries().length - before).toBe(4);

            // other state arrives: console lines, a settings edit
            for (const word of ["one", "two", "three"]) await callServer("s-mc", "run-command", { command: `say ${word}` });
            await callServer("s-mc", "update-panel-config", { patch: { ramGB: 3 } });
            await page.received((f) => f.includes('"ramAllocation":3'), "the edited settings");
            await page.received((f) => f.includes("[Server] three"), "the last console line");
            await page.settled();
            expect(statQueries().length - before).toBe(4);
        });
    }, 60_000);

    test("an ask for their live stats that fails says why", async () => {
        await setUp();
        const ask = minecraftCalls[CALLS.queryPlayerStats]!;
        minecraftCalls[CALLS.queryPlayerStats] = async () => {
            throw new Error("the server's console is not taking commands");
        };
        try {
            await onSteve(async (page) => {
                await page.waitFor(`document.body.innerText.includes("Live stats not read")`, "the failed ask to be shown");
                expect(await page.evaluate<string>("document.body.innerText")).toContain("the server's console is not taking commands");
            });
        } finally {
            minecraftCalls[CALLS.queryPlayerStats] = ask;
        }
    }, 60_000);
});
