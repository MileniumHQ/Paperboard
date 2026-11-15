// A running server's Overview, as people see it at the narrowest window
// (the panel beside the app's menus is about 620 by 520): its readouts fit,
// its console keeps a height, and a port that was taken is said there for
// the run it moved, while the server's own setting keeps the chosen one.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import { portSettingsApi, processApi } from "@mileniumhq/paperapi";
import { startTestDaemon, type TestDaemon } from "./helpers/crane";
import { openPage, servePanel, type Page } from "./helpers/browser";
import { freePort } from "./helpers/palworld";
import { placeStandIn } from "./helpers/standIn";
import { writeTree } from "./helpers/tmp";
import { PANEL_ID } from "../src/servers";
import { entrypoint, releaseFor } from "../src/games/terraria/catalog";

let daemon: TestDaemon;
beforeAll(async () => {
    daemon = await startTestDaemon();
});
afterAll(async () => {
    await daemon?.stop();
});

const SERVERS = "servers-0123456789ab";
const ID = "s-ter";
const vanilla = releaseFor("1.4.5.8");
const NARROWEST = "620,520";
const config = () => path.join(daemon.dataDir, "configs", `${PANEL_ID}.json`);
const savedPort = () => (JSON.parse(fs.readFileSync(config(), "utf8")).servers as { id: string; settings: Record<string, unknown> }[]).find((s) => s.id === ID)!.settings.port;

let ready: Promise<void> | null = null;
/** a stopped Terraria server on world "World", whose port is `port`, and the panel served */
async function setUp(port: number) {
    ready ??= (async () => {
        fs.mkdirSync(path.dirname(config()), { recursive: true });
        fs.writeFileSync(config(), JSON.stringify({ version: 2, serversDirectory: SERVERS, servers: [{ id: ID, name: "Island", game: "terraria", directory: `${SERVERS}/${ID}`, createdAt: 0, settings: { configured: true, version: vanilla.version, port } }] }));
        const folder = path.join(daemon.dataDir, "files", PANEL_ID, SERVERS, ID);
        writeTree(folder, { [`install/${vanilla.directory}/manifest.json`]: JSON.stringify({ software: "vanilla", version: vanilla.version, sha256: vanilla.sha256, os: process.platform, arch: process.arch }) });
        placeStandIn("fakeTerraria", path.join(folder, "install", vanilla.directory, entrypoint(process.platform)));
        const { gameServerService } = await import("../src/service");
        await gameServerService.ready;
    })();
    await ready;
    return servePanel(daemon);
}

/** a TCP port held on every interface, as another program would hold it */
async function holdPort(port: number): Promise<() => Promise<void>> {
    const server = net.createServer();
    await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "0.0.0.0", resolve);
    });
    return () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
}

const button = (label: string) => `[...document.querySelectorAll("button")].find((b) => b.innerText.trim().split("\\n").at(-1).trim() === ${JSON.stringify(label)} && !b.disabled)`;
const text = (value: string) => `document.body.textContent.includes(${JSON.stringify(value)})`;

async function start(page: Page): Promise<void> {
    await page.waitFor(button("Start"), "the stopped server's Start");
    await page.evaluate(`${button("Start")}.click()`);
}
async function stop(page: Page): Promise<void> {
    const exited = new Promise<void>((resolve) => processApi.onExit(`${ID}-terraria-server`, () => resolve()));
    await page.waitFor(button("Stop"), "the running server's Stop");
    await page.evaluate(`${button("Stop")}.click()`);
    await exited;
    await page.waitFor(button("Start"), "the stopped server's Start again");
}

describe("a running server's Overview at the narrowest window", () => {
    test("its readouts show their whole text, and the console keeps a height of its own", async () => {
        const served = await setUp(await freePort());
        const page = await openPage(`${served.url}/?server=${ID}`, NARROWEST);
        try {
            await start(page);
            await page.waitFor(`${button("Stop")} && ${text("Join password")}`, "the running server's readouts");
            // every line of every readout is whole: none is cut off or ends in an ellipsis
            const cut = await page.evaluate<string[]>(`[...document.querySelectorAll("*")].filter((el) => el.children.length === 0 && el.textContent.trim() && el.closest("[class*=StatTile]") && (el.scrollWidth > el.clientWidth + 1 || el.getBoundingClientRect().right > el.closest("[class*=StatTile]").getBoundingClientRect().right + 1)).map((el) => el.textContent)`);
            expect(cut).toEqual([]);
            // the world's readout names the world, under a label that isn't the same word
            const world = await page.evaluate<string[]>(`[...document.querySelectorAll("[class*=StatTile]")].map((t) => t.innerText.split("\\n").slice(1).join(" / ")).filter((t) => t.includes("world"))`);
            expect(world).toEqual(["World / Active world"]);
            const consoleHeight = await page.evaluate<number>(`document.querySelector("[class*=outputArea]").clientHeight`);
            expect(consoleHeight).toBeGreaterThan(100);
        } finally {
            if (await page.evaluate<boolean>(`${button("Stop")} !== undefined`)) await stop(page);
            await page.close();
            served.stop();
        }
    }, 90_000);

    test("a taken port moves for that run only and the Overview says so; under Refuse taken ports the start is refused with why", async () => {
        const served = await setUp(await freePort());
        const release = await holdPort(Number(savedPort()));
        const page = await openPage(`${served.url}/?server=${ID}`, NARROWEST);
        try {
            const wanted = Number(savedPort());
            await start(page);
            await page.waitFor(`${button("Stop")} && ${text(`Port ${wanted} was taken, so this run uses`)}`, "the moved port's notice");
            const moved = Number(await page.evaluate<string>(`document.body.textContent.match(/so this run uses (\\d+)/)[1]`));
            expect(moved).toBeGreaterThan(wanted);
            // friends are told the address the server is listening on
            expect(await page.evaluate<boolean>(text(`:${moved}`))).toBe(true);
            // the chosen port is never overwritten by the run's
            expect(savedPort()).toBe(wanted);
            await stop(page);
            expect(await page.evaluate<boolean>(text(`Port ${wanted} was taken, so this run uses`))).toBe(false);
            expect(savedPort()).toBe(wanted);

            await portSettingsApi.setPolicy("refuse");
            try {
                await start(page);
                await page.waitFor(text(`can't use port ${wanted}`), "the refused start's reason");
                expect(await page.evaluate<boolean>(button("Start") + " !== undefined")).toBe(true);
            } finally {
                await portSettingsApi.setPolicy("next-free");
            }
        } finally {
            await release();
            await page.close();
            served.stop();
        }
    }, 90_000);
});
