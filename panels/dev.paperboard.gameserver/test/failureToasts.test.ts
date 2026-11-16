// A failure is never an error quote in the page. A refused Start, a one-off,
// says why in a toast. Logs that can't be read stand where they happen: a
// PaperError fills the tab with nothing to show, or sits above the log read
// before, with its own Try again, and goes once the read goes through.
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

/** the failure standing in the page under `title` */
const failure = (title: string) => `document.querySelector(${JSON.stringify(`[data-paper-error][aria-label="${title}"]`)})`;
/** its Try again, once it can be pressed */
const retry = (title: string) => `[...(${failure(title)}?.querySelectorAll("button") ?? [])].find((b) => b.innerText.trim() === "Try again" && !b.disabled)`;
const toast = (title: string) => `[...document.querySelectorAll("[data-paper-toasts] [role=alert]")].find((t) => t.innerText.includes(${JSON.stringify(title)}))`;
/** an enabled button by its label, after its icon */
const button = (label: string) => `[...document.querySelectorAll("button")].find((b) => b.innerText.trim().split("\\n").at(-1).trim() === ${JSON.stringify(label)} && !b.disabled)`;
/** a danger quote anywhere in the page, which a failure never is */
const ERROR_QUOTE = `!![...document.querySelectorAll("[class*=PaperQuote]")].find((q) => q.className.includes("danger"))`;

describe("failures say where they happen", () => {
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

    test("logs that can't be listed fill the tab with why and Try again, never a toast, and go once they can be", async () => {
        const served = await setUp();
        const logs = path.join(serverDir(), "logs");
        fs.chmodSync(logs, 0o000);
        const page = await openPage(`${served.url}/?server=${MC}`);
        try {
            await page.waitFor(`document.querySelector('input[name=serverMenu][value="logs"]')`, "the server menu");
            await page.click('input[name=serverMenu][value="logs"]');
            await page.waitFor(failure("Couldn't list the logs"), "the failed listing");
            // it fills the body, which has nothing else to show, and says why
            expect(await page.evaluate<boolean>(`${failure("Couldn't list the logs")}.className.includes("fill")`)).toBe(true);
            expect(await page.evaluate<string>(`${failure("Couldn't list the logs")}.innerText`)).toMatch(/Permission denied|isn't allowed/);
            // a failure that stands is never a toast, and never an error quote
            expect(await page.evaluate<number>(`document.querySelectorAll("[data-paper-toasts] [role=alert]").length`)).toBe(0);
            expect(await page.evaluate<boolean>(ERROR_QUOTE)).toBe(false);

            // its own Try again is the way out; once it reads, it goes
            fs.chmodSync(logs, 0o700);
            await page.waitFor(retry("Couldn't list the logs"), "the failure's Try again");
            await page.evaluate(`${retry("Couldn't list the logs")}.click()`);
            await page.waitFor(`!document.querySelector("[data-paper-error]") && document.body.innerText.includes("Done (1.0s)!")`, "the log read once it can be");
            expect(page.exceptions).toEqual([]);
        } finally {
            fs.chmodSync(logs, 0o700);
            await page.close();
        }
    });

    test("a refresh that can't list the logs says why above the log still shown, and goes once it can", async () => {
        const served = await setUp();
        const logs = path.join(serverDir(), "logs");
        const page = await openPage(`${served.url}/?server=${MC}`);
        try {
            await page.waitFor(`document.querySelector('input[name=serverMenu][value="logs"]')`, "the server menu");
            await page.click('input[name=serverMenu][value="logs"]');
            await page.waitFor(`document.body.innerText.includes("Done (1.0s)!")`, "the log read");
            fs.chmodSync(logs, 0o000);
            await page.evaluate(`${button("Refresh")}.click()`);
            await page.waitFor(failure("Couldn't list the logs"), "the failed refresh");
            // in line, over the log it read before, which stays
            expect(await page.evaluate<boolean>(`${failure("Couldn't list the logs")}.className.includes("inline")`)).toBe(true);
            expect(await page.evaluate<string>(`${failure("Couldn't list the logs")}.innerText`)).toMatch(/Permission denied|isn't allowed/);
            expect(await page.evaluate<boolean>(`document.body.innerText.includes("Done (1.0s)!")`)).toBe(true);
            expect(await page.evaluate<boolean>(`!!(${failure("Couldn't list the logs")}.compareDocumentPosition(document.querySelector("[class*=PaperConsole]")) & Node.DOCUMENT_POSITION_FOLLOWING)`)).toBe(true);
            expect(await page.evaluate<number>(`document.querySelectorAll("[data-paper-toasts] [role=alert]").length`)).toBe(0);

            fs.chmodSync(logs, 0o700);
            await page.waitFor(retry("Couldn't list the logs"), "the failure's Try again");
            await page.evaluate(`${retry("Couldn't list the logs")}.click()`);
            await page.waitFor(`!document.querySelector("[data-paper-error]") && document.body.innerText.includes("Done (1.0s)!")`, "the listing once it can be");
            expect(page.exceptions).toEqual([]);
        } finally {
            fs.chmodSync(logs, 0o700);
            await page.close();
        }
    });
});
