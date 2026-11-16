// A failure is a toast, never an error quote in the page. A refused Start
// says why in a toast; a tab that couldn't load, with nothing to show,
// says "Couldn't load" with its own Try again, while a standing toast says
// why and closes once the read goes through.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { startTestDaemon, type TestDaemon } from "./helpers/crane";
import { openPage, servePanel } from "./helpers/browser";
import { freePort } from "./helpers/palworld";
import { writeTree } from "./helpers/tmp";
import { PANEL_ID } from "../src/servers";

let daemon: TestDaemon;
beforeAll(async () => {
    daemon = await startTestDaemon();
});
afterAll(async () => {
    await daemon?.stop();
});

const SERVERS = "servers-0123456789ab";
const MC = "s-mc";
const config = () => path.join(daemon.dataDir, "configs", `${PANEL_ID}.json`);
const serverDir = () => path.join(daemon.dataDir, "files", PANEL_ID, SERVERS, MC);

let ready: Promise<void> | null = null;
/** a stopped Minecraft server whose Java isn't installed, and the panel served */
async function setUp() {
    ready ??= (async () => {
        fs.mkdirSync(path.dirname(config()), { recursive: true });
        fs.writeFileSync(config(), JSON.stringify({ version: 2, serversDirectory: SERVERS, servers: [
            { id: MC, name: "Survival", game: "minecraft", directory: `${SERVERS}/${MC}`, createdAt: 0, settings: { configured: true, software: "paper", version: "1.21.1" } },
        ] }));
        writeTree(serverDir(), { "server.jar": "jar", "eula.txt": "eula=true\n", "server.properties": `server-port=${await freePort()}\n`, "logs/latest.log": "[12:00:00] [Server thread/INFO]: Done (1.0s)!\n" });
        const { gameServerService } = await import("../src/service");
        await gameServerService.ready;
    })();
    await ready;
    return servePanel(daemon);
}

const toast = (title: string) => `[...document.querySelectorAll("[data-paper-toasts] [role=alert]")].find((t) => t.innerText.includes(${JSON.stringify(title)}))`;
/** an enabled button by its label, after its icon */
const button = (label: string) => `[...document.querySelectorAll("button")].find((b) => b.innerText.trim().split("\\n").at(-1).trim() === ${JSON.stringify(label)} && !b.disabled)`;
/** a danger quote anywhere in the page, which a failure never is */
const ERROR_QUOTE = `!![...document.querySelectorAll("[class*=PaperQuote]")].find((q) => q.className.includes("danger"))`;

describe("failures are toasts", () => {
    test("a refused Start says why in a toast, and the page holds no error quote", async () => {
        const served = await setUp();
        const page = await openPage(`${served.url}/?server=${MC}`);
        try {
            await page.waitFor(button("Start"), "the stopped server's Start");
            await page.evaluate(`${button("Start")}.click()`);
            await page.waitFor(toast("Couldn't start the server"), "the refused start's toast");
            expect(await page.evaluate<string>(`${toast("Couldn't start the server")}.innerText`)).toContain('"java-21" is not installed');
            expect(await page.evaluate<boolean>(ERROR_QUOTE)).toBe(false);
            expect(page.exceptions).toEqual([]);
        } finally {
            await page.close();
        }
    });

    test("a tab that couldn't load shows Couldn't load with Try again, and its toast closes once it loads", async () => {
        const served = await setUp();
        const logs = path.join(serverDir(), "logs");
        fs.chmodSync(logs, 0o000);
        const page = await openPage(`${served.url}/?server=${MC}`);
        try {
            await page.waitFor(`document.querySelector('input[name=serverMenu][value="logs"]')`, "the server menu");
            await page.click('input[name=serverMenu][value="logs"]');
            await page.waitFor(`${toast("Couldn't list the logs")} && document.body.innerText.includes("Couldn't load")`, "the failed listing");
            expect(await page.evaluate<string>(`${toast("Couldn't list the logs")}.innerText`)).toMatch(/Permission denied|isn't allowed/);
            // never a blank body, and never an error quote
            expect(await page.evaluate<boolean>(ERROR_QUOTE)).toBe(false);

            // the body's own Try again is the way out; once it reads, the toast goes
            fs.chmodSync(logs, 0o700);
            await page.waitFor(`[...document.querySelectorAll("[class*=PaperEmptyState] button")].find((b) => b.innerText.trim() === "Try again" && !b.disabled)`, "the empty state's Try again");
            await page.evaluate(`[...document.querySelectorAll("[class*=PaperEmptyState] button")].find((b) => b.innerText.trim() === "Try again").click()`);
            await page.waitFor(`!${toast("Couldn't list the logs")} && !document.body.innerText.includes("Couldn't load") && document.body.innerText.includes("Done (1.0s)!")`, "the log read once it can be");
            expect(page.exceptions).toEqual([]);
        } finally {
            fs.chmodSync(logs, 0o700);
            await page.close();
        }
    });
});
