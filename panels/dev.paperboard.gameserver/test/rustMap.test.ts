// Rust's Map tab: a running server draws its map when the tab opens, a draw
// Rust refuses says why and can be tried again, and a stopped server's wipe
// asks first, then moves the old map to the trash and picks a new seed.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { processApi } from "@mileniumhq/paperapi";
import { serverCalls } from "./helpers/serverCall";
import { startTestDaemon, type TestDaemon } from "./helpers/crane";
import { openPage, servePanel } from "./helpers/browser";
import { servicesState } from "./helpers/installedPanel";
import { freePort } from "./helpers/palworld";
import { allowLoopbackSocket, installRust } from "./helpers/rust";
import { PANEL_ID } from "../src/servers";

let daemon: TestDaemon;
beforeAll(async () => {
    daemon = await startTestDaemon();
});
afterAll(async () => {
    await daemon?.stop();
});

const SERVERS = "servers-0123456789ab";
const ID = "s-rust";
const config = () => path.join(daemon.dataDir, "configs", `${PANEL_ID}.json`);
const settings = () => JSON.parse(fs.readFileSync(config(), "utf8")).servers[0].settings as Record<string, unknown>;
const folder = () => path.join(daemon.dataDir, "files", PANEL_ID, SERVERS, ID);
const plan = (value: Record<string, unknown>) => fs.writeFileSync(path.join(folder(), "install", "fake-rust.json"), JSON.stringify(value));
/** the button whose label (after its icon, if it has one) is `label` */
const button = (label: string, within = "document") => `[...${within}.querySelectorAll("button")].find((b) => b.innerText.trim().split("\\n").at(-1).trim() === ${JSON.stringify(label)})`;
const dialog = `document.querySelector("[role=dialog]")`;

describe("Rust's Map tab", () => {
    test("draws the running server's map, shows a draw Rust refused with its reason, and a stopped server's wipe asks and reports", async () => {
        fs.mkdirSync(path.dirname(config()), { recursive: true });
        const ports = { port: await freePort(), queryPort: await freePort(), rconPort: await freePort(), appPort: await freePort() };
        fs.writeFileSync(config(), JSON.stringify({ version: 2, serversDirectory: SERVERS, servers: [{ id: ID, name: "Wasteland", game: "rust", directory: `${SERVERS}/${ID}`, createdAt: 0, settings: { configured: true, ...ports, worldsize: 1000, seed: 12345 } }] }));
        // the port the server holds, read when the panel opens its remote console
        allowLoopbackSocket(() => Number(settings().rconPort));
        installRust(folder(), { renderFails: "Out of memory" });
        const { gameServerService } = await import("../src/service");
        await gameServerService.ready;
        const state = servicesState();
        const served = await servePanel(daemon);
        const page = await openPage(`${served.url}/?server=${ID}`);
        const exited = new Promise<void>((resolve) => processApi.onExit(`${ID}-rust-server`, () => resolve()));
        try {
            await serverCalls(ID).startServer();
            await state.waitFor(ID, (s) => s.serverStatus === "online", "Rust online");
            await page.waitFor(`document.querySelector('input[name=serverMenu][value="map"]')`, "the server menu");
            await page.click('input[name=serverMenu][value="map"]');
            // the first draw Rust refuses: its reason is on screen, with a way to try again
            const drawToast = `[...document.querySelectorAll("[data-paper-toasts] [role=alert]")].find((t) => t.innerText.includes("Couldn't draw the map"))`;
            await page.waitFor(`${drawToast}?.innerText.includes("Failed to render: Out of memory")`, "the refused draw's reason");
            expect(await page.evaluate(`!!document.querySelector("img[alt^='The map from above']")`)).toBe(false);
            plan({});
            await page.evaluate(`${button("Try again")}.click()`);
            await page.waitFor(`document.querySelector("img[alt^='The map from above']")?.src.startsWith("data:image/png;base64,")`, "the drawn map");
            expect(await page.evaluate(`!${drawToast} && !document.body.innerText.includes("Couldn't draw the map")`)).toBe(true);
            const identity = path.join(folder(), "server", "paperboard");
            expect(fs.existsSync(path.join(identity, "proceduralmap.1000.12345.png"))).toBe(true);
            // running, a wipe is not offered
            expect(await page.evaluate(`${button("Wipe")}.disabled`)).toBe(true);

            await serverCalls(ID).stopServer();
            await exited;
            await page.waitFor(`!${button("Wipe")}.disabled`, "Wipe offered once the server stopped");
            await page.evaluate(`${button("Wipe")}.click()`);
            await page.waitFor(`${dialog}?.innerText.includes("Wipe the server")`, "the wipe confirmation");
            // asking is not wiping
            expect(fs.existsSync(path.join(identity, "proceduralmap.1000.12345.png"))).toBe(true);
            await page.evaluate(`${button("Wipe", dialog)}.click()`);
            await page.waitFor(`document.body.innerText.includes("Wiped") && document.body.innerText.includes("The old one is in a .trash folder in Files.")`, "the wipe's report");
            await page.settled();
            const trash = fs.readdirSync(folder()).filter((name) => name.startsWith(".trash-"));
            expect(trash).toHaveLength(1);
            expect(fs.readdirSync(path.join(folder(), trash[0]!, "server", "paperboard"))).toContain("proceduralmap.1000.12345.png");
            expect(fs.readdirSync(identity).filter((name) => name.startsWith("proceduralmap."))).toEqual([]);
            expect(settings().seed).not.toBe(12345);
            // the picture of the wiped map is gone from the tab, and the new seed is shown
            expect(await page.evaluate(`!!document.querySelector("img[alt^='The map from above']")`)).toBe(false);
            await page.waitFor(`document.body.innerText.includes(${JSON.stringify(String(settings().seed))})`, "the new seed");
            expect(page.exceptions).toEqual([]);
        } finally {
            await page.close();
            served.stop();
        }
    }, 90_000);
});
