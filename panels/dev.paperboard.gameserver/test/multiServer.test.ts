// Two servers of different games side by side, on one service: each page,
// and each Home widget, shows its own server, and what is done to one never
// reaches the other.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { processApi } from "@mileniumhq/paperapi";
import { serverCalls } from "./helpers/serverCall";
import { startTestDaemon, type TestDaemon } from "./helpers/crane";
import { waitForWidget, widgetUrl, WIDGET_DOC, WIDGET_TEXT } from "testkit/panelUi";
import { openPage, servePanel, type Page } from "./helpers/browser";
import { installFakeJava } from "./helpers/fakeJava";
import { servicesState } from "./helpers/installedPanel";
import { freePort } from "./helpers/palworld";
import { placeStandIn } from "./helpers/standIn";
import { writeTree } from "./helpers/tmp";
import { PANEL_ID } from "../src/servers";
import { javaPackageFor } from "../src/lib/versionProfile";
import { entrypoint, releaseFor } from "../src/games/terraria/catalog";

let daemon: TestDaemon;
beforeAll(async () => {
    daemon = await startTestDaemon();
});
afterAll(async () => {
    await daemon?.stop();
});

const SERVERS = "servers-0123456789ab";
const vanilla = releaseFor("1.4.5.8");
const config = () => path.join(daemon.dataDir, "configs", `${PANEL_ID}.json`);
const stored = (id: string) => (JSON.parse(fs.readFileSync(config(), "utf8")).servers as { id: string; name: string; settings: Record<string, unknown> }[]).find((s) => s.id === id)!;
const folder = (id: string) => path.join(daemon.dataDir, "files", PANEL_ID, SERVERS, id);
const PROCESS = { "s-mc": "s-mc-mc-server", "s-ter": "s-ter-terraria-server" } as const;
type Id = keyof typeof PROCESS;

let ready: Promise<void> | null = null;
/** a stopped Paper server that two players are on once it runs, and a stopped vanilla Terraria server */
async function setUp() {
    ready ??= (async () => {
        fs.mkdirSync(path.dirname(config()), { recursive: true });
        fs.writeFileSync(config(), JSON.stringify({
            version: 2,
            serversDirectory: SERVERS,
            servers: [
                { id: "s-mc", name: "Survival", game: "minecraft", directory: `${SERVERS}/s-mc`, createdAt: 0, settings: { configured: true, software: "paper", version: "1.21.1" } },
                { id: "s-ter", name: "Island", game: "terraria", directory: `${SERVERS}/s-ter`, createdAt: 1, settings: { configured: true, version: vanilla.version, port: await freePort(), world: "Island" } },
            ],
        }));
        writeTree(folder("s-mc"), { "server.jar": "jar", "eula.txt": "eula=true\n", "fake-server.json": JSON.stringify({ players: ["alice", "bob"], maxPlayers: 10 }),
            // the names as the players typed them; the server's list says them in lower case
            "usercache.json": JSON.stringify([{ name: "Alice", uuid: "00000000-0000-0000-0000-00000000000a", expiresOn: "2030-01-01 00:00:00 +0000" }, { name: "Bob", uuid: "00000000-0000-0000-0000-00000000000b", expiresOn: "2030-01-01 00:00:00 +0000" }]),
        });
        installFakeJava(javaPackageFor("1.21.1")!);
        writeTree(folder("s-ter"), {
            [`install/${vanilla.directory}/manifest.json`]: JSON.stringify({ software: "vanilla", version: vanilla.version, sha256: vanilla.sha256, os: process.platform, arch: process.arch }),
        });
        placeStandIn("fakeTerraria", path.join(folder("s-ter"), "install", vanilla.directory, entrypoint(process.platform)));
        const { gameServerService } = await import("../src/service");
        await gameServerService.ready;
    })();
    await ready;
    return servePanel(daemon);
}

const state = () => servicesState();
/** starts `id` and resolves once it is online; stop() ends it */
async function running(id: Id, start: () => Promise<unknown>) {
    const exited = new Promise<void>((resolve) => processApi.onExit(PROCESS[id], () => resolve()));
    await start();
    await state().waitFor(id, (s) => s.serverStatus === "online", `${id} online`);
    return {
        async stop() {
            await serverCalls(id).stopServer();
            await exited;
        },
    };
}

/** the button whose last line of text is `label` */
const button = (label: string, within = "document") => `[...${within}.querySelectorAll("button")].find((b) => b.innerText.trim().split("\\n").at(-1).trim() === ${JSON.stringify(label)} && !b.disabled)`;
const card = (name: string) => `[...document.querySelectorAll("[role=button]")].find((el) => el.innerText.split("\\n").map((line) => line.trim()).includes(${JSON.stringify(name)}))`;
const ACTIVE = `document.querySelector("[class*=PaperInterfaceItem]")`;
/** the open server's page: its name over the menu, and what its Overview shows */
const PAGE = `document.body.textContent`;
const tabs = (page: Page) => page.evaluate<string[]>(`[...document.querySelectorAll("input[name=serverMenu]")].map((i) => i.value)`);
/** presses what opens another server's page or the server list (a server's card, All servers) */
async function leaveBy(page: Page, press: string): Promise<void> {
    await page.settled();
    await page.evaluate(`(${press}).click()`);
}
const consoleOf = async (id: Id) => (await state().server(id))!.serverEntries.map((e) => String(e.content)).join("\n");

describe("two servers of different games", () => {
    test("each page shows its own server, and starting and editing one leaves the other as it was", async () => {
        const served = await setUp();
        const page = await openPage(`${served.url}/`);
        let terraria: Awaited<ReturnType<typeof running>> | null = null;
        try {
            await page.waitFor(`${card("Survival")} && ${card("Island")}`, "both servers' cards");
            // switching servers is a change in this document, never a new one
            await page.evaluate(`window.__sameDocument = true`);
            await leaveBy(page, card("Survival"));
            await page.waitFor(`document.querySelector('input[name=serverMenu][value="loader"]') && ${PAGE}.includes("Survival") && ${ACTIVE}?.innerText.includes("PAPER")`, "Survival's page");
            expect(await page.evaluate<string>(PAGE)).not.toContain("Island");

            // across to the other server, through the server list
            await leaveBy(page, `document.querySelector('input[name=serverMenu][value="home"]')`);
            await page.waitFor(card("Island"), "the server list");
            await leaveBy(page, card("Island"));
            await page.waitFor(`document.querySelector('input[name=serverMenu][value="worlds"]') && ${PAGE}.includes("Island") && ${ACTIVE}?.innerText.includes("VANILLA") && ${button("Start")}`, "Island's page");
            expect(await tabs(page)).not.toContain("loader");
            expect(await page.evaluate<string>(PAGE)).not.toContain("Survival");

            // Start on Terraria's page starts Terraria alone
            terraria = await running("s-ter", () => page.evaluate(`${button("Start")}.click()`));
            await page.waitFor(`${button("Stop")} && ${ACTIVE}.innerText.includes("Terraria Server v1.4.5.8")`, "Terraria running, its console on its page");
            expect((await state().server("s-mc"))!.serverStatus).toBe("offline");
            expect(await consoleOf("s-mc")).not.toContain("Terraria");

            // a change to one server's settings is that server's alone
            const before = stored("s-mc").settings;
            await serverCalls("s-ter").terrariaMotd({ motd: "Island only" });
            await page.waitFor(`${ACTIVE}.innerText.includes("Island only")`, "Terraria's new message of the day");
            expect(stored("s-ter").settings.motd).toBe("Island only");
            expect(stored("s-mc").settings).toEqual(before);
            expect(fs.readFileSync(path.join(folder("s-mc"), "eula.txt"), "utf8")).toBe("eula=true\n");

            // back on Survival: still stopped, with nothing of Terraria's
            await leaveBy(page, `document.querySelector('input[name=serverMenu][value="home"]')`);
            await page.waitFor(card("Survival"), "the server list");
            await leaveBy(page, card("Survival"));
            await page.waitFor(`document.querySelector('input[name=serverMenu][value="loader"]') && ${PAGE}.includes("Survival") && ${ACTIVE}?.innerText.includes("PAPER") && ${button("Start")}`, "Survival's page, stopped");
            expect(await page.evaluate<string>(`${ACTIVE}.innerText`)).not.toContain("Terraria Server");
            expect(await page.evaluate<string>(`${ACTIVE}.innerText`)).not.toContain("Island only");
            expect(await page.evaluate<boolean>(`window.__sameDocument === true`)).toBe(true);
            expect(page.exceptions).toEqual([]);
        } finally {
            await terraria?.stop();
            await page.close();
            served.stop();
        }
    }, 60_000);
});

describe("Home's widgets", () => {
    test("each status widget shows its own game's server, and its button starts that server alone", async () => {
        const served = await setUp();
        const mc = await openPage(widgetUrl(served.url, "status", { server: "s-mc" }));
        const ter = await openPage(widgetUrl(served.url, "status", { server: "s-ter" }));
        let terraria: Awaited<ReturnType<typeof running>> | null = null;
        try {
            await waitForWidget(mc, `${WIDGET_TEXT}.includes("Paper 1.21.1") && ${WIDGET_TEXT}.includes("Offline")`, "Survival's status");
            await waitForWidget(ter, `${WIDGET_TEXT}.includes("Vanilla 1.4.5.8") && ${WIDGET_TEXT}.includes("Offline")`, "Island's status");
            expect(await ter.evaluate<string>(WIDGET_TEXT)).not.toContain("Paper");

            terraria = await running("s-ter", () => ter.evaluate(`${button("Start", WIDGET_DOC)}.click()`));
            await waitForWidget(ter, `${button("Stop", WIDGET_DOC)} && ${WIDGET_TEXT}.includes("Online")`, "Island's widget online");
            // the other widget hears the push, and still shows its own server stopped
            await mc.received((f) => f.includes('"s-ter":{"serverStatus"') && f.includes('"online"'), "the push of Island going online");
            expect(await mc.evaluate<string>(WIDGET_TEXT)).toContain("Offline");
            expect(await mc.evaluate<boolean>(`!!${button("Start", WIDGET_DOC)}`)).toBe(true);
            expect((await state().server("s-mc"))!.serverStatus).toBe("offline");
            expect([mc.exceptions, ter.exceptions]).toEqual([[], []]);
        } finally {
            await terraria?.stop();
            await mc.close();
            await ter.close();
            served.stop();
        }
    }, 60_000);

});
