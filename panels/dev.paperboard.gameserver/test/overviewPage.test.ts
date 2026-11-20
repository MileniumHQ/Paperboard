// Stop on a running server asks first while players are on it, on the page
// and in its Home widget.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { processApi } from "@mileniumhq/paperapi";
import { startTestDaemon, type TestDaemon } from "./helpers/crane";
import { waitForWidget, widgetUrl, WIDGET_DOC, WIDGET_TEXT } from "testkit/panelUi";
import { openPage, servePanel } from "./helpers/browser";
import { freePort } from "./helpers/palworld";
import { writeTree } from "./helpers/tmp";
import { PANEL_ID } from "../src/servers";
import { installFakeJava } from "./helpers/fakeJava";
import { serverCalls } from "./helpers/serverCall";
import { javaPackageFor } from "../src/lib/versionProfile";

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

let ready: Promise<void> | null = null;
/** a stopped Minecraft server whose stand-in has alice and bob on it, and the panel served */
async function setUp() {
    ready ??= (async () => {
        fs.mkdirSync(path.dirname(config()), { recursive: true });
        fs.writeFileSync(config(), JSON.stringify({ version: 2, serversDirectory: SERVERS, servers: [
            { id: MC, name: "Survival", game: "minecraft", directory: `${SERVERS}/${MC}`, createdAt: 0, settings: { configured: true, software: "paper", version: "1.21.1" } },
        ] }));
        writeTree(path.join(daemon.dataDir, "files", PANEL_ID, SERVERS, MC), { "server.jar": "jar", "eula.txt": "eula=true\n", "server.properties": `server-port=${await freePort()}\n`, "fake-server.json": JSON.stringify({ players: ["alice", "bob"], maxPlayers: 20 }) });
        installFakeJava(javaPackageFor("1.21.1")!);
        const { gameServerService } = await import("../src/service");
        await gameServerService.ready;
    })();
    await ready;
    return servePanel(daemon);
}

const button = (label: string) => `[...document.querySelectorAll("button")].find((b) => b.innerText.trim().split("\\n").at(-1).trim() === ${JSON.stringify(label)} && !b.disabled)`;
const text = (value: string) => `document.body.textContent.includes(${JSON.stringify(value)})`;

/** starts Survival, whose stand-in has alice and bob on it; `exited` resolves once it exits */
async function startSurvival(): Promise<{ exited: Promise<void> }> {
    const exited = new Promise<void>((resolve) => processApi.onExit(`${MC}-mc-server`, () => resolve()));
    await serverCalls(MC).startServer();
    return { exited };
}
const dialogButton = (label: string) => `[...document.querySelectorAll("[role=dialog] button")].find((b) => b.innerText.trim() === ${JSON.stringify(label)} && !b.disabled)`;
describe("a running server's Overview", () => {
    test("Stop asks first while players are on, on the page and in its Home widget", async () => {
        const served = await setUp();
        const { exited } = await startSurvival();
        const page = await openPage(`${served.url}/?server=${MC}`);
        const widget = await openPage(widgetUrl(served.url, "status", { server: MC }, { w: 2, h: 1 }));
        let stopped = false;
        try {
            await page.waitFor(`${button("Stop")} && ${text("2 / 20")}`, "the running server with two players");
            await page.evaluate(`${button("Stop")}.click()`);
            await page.waitFor(`!!${dialogButton("Cancel")}`, "the question");
            expect(await page.evaluate<string>(`document.querySelector("[role=dialog]").innerText`)).toContain("Stop Survival?");
            expect(await page.evaluate<string>(`document.querySelector("[role=dialog]").innerText`)).toContain("2 players are online");
            await page.evaluate(`${dialogButton("Cancel")}.click()`);
            await page.waitFor(`!document.querySelector("[role=dialog]")`, "the question gone");

            // the widget is titled by the server and asks the same, in its tile
            await waitForWidget(widget, `${WIDGET_TEXT}.includes("Survival") && ${WIDGET_TEXT}.includes("2 / 20")`, "the widget's running server");
            expect(await widget.evaluate<string>(WIDGET_TEXT)).not.toContain("Online · players");
            await widget.evaluate(`${WIDGET_DOC}.querySelector("button[aria-label='Stop server']").click()`);
            await waitForWidget(widget, `${WIDGET_TEXT}.includes("Stop Survival?")`, "the widget's question");
            await widget.evaluate(`[...${WIDGET_DOC}.querySelectorAll("button")].find((b) => b.innerText.trim() === "Stop").click()`);
            await exited;
            stopped = true;
            await page.waitFor(button("Start"), "the server stopped");
            expect([page.exceptions, widget.exceptions]).toEqual([[], []]);
        } finally {
            await widget.close();
            await page.close();
            if (!stopped) {
                await serverCalls(MC).stopServer();
                await exited;
            }
            served.stop();
        }
    }, 90_000);
});
