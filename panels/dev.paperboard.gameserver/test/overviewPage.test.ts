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
import { waitForWidget, widgetUrl, WIDGET_DOC, WIDGET_TEXT } from "../../../scripts/testing/panelUi";
import { openPage, servePanel, type Page } from "./helpers/browser";
import { freePort } from "./helpers/palworld";
import { placeStandIn } from "./helpers/standIn";
import { writeTree } from "./helpers/tmp";
import { PANEL_ID } from "../src/servers";
import { entrypoint, releaseFor } from "../src/games/terraria/catalog";
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
const ID = "s-ter";
const MC = "s-mc";
const NEW = "s-new";
const vanilla = releaseFor("1.4.5.8");
const NARROWEST = "620,520";
const config = () => path.join(daemon.dataDir, "configs", `${PANEL_ID}.json`);
const savedPort = () => (JSON.parse(fs.readFileSync(config(), "utf8")).servers as { id: string; settings: Record<string, unknown> }[]).find((s) => s.id === ID)!.settings.port;

let ready: Promise<void> | null = null;
/** a stopped Terraria server on world "World", whose port is `port`, and the panel served */
async function setUp(port: number) {
    ready ??= (async () => {
        fs.mkdirSync(path.dirname(config()), { recursive: true });
        fs.writeFileSync(config(), JSON.stringify({ version: 2, serversDirectory: SERVERS, servers: [
            { id: ID, name: "Island", game: "terraria", directory: `${SERVERS}/${ID}`, createdAt: 0, settings: { configured: true, version: vanilla.version, port } },
            { id: MC, name: "Survival", game: "minecraft", directory: `${SERVERS}/${MC}`, createdAt: 0, settings: { configured: true, software: "paper", version: "1.21.1" } },
            { id: NEW, name: "Fresh", game: "minecraft", directory: `${SERVERS}/${NEW}`, createdAt: 0, settings: {} },
        ] }));
        // the whitelist is on and nobody is on it: the Overview says so above its console
        writeTree(path.join(daemon.dataDir, "files", PANEL_ID, SERVERS, MC), { "server.jar": "jar", "eula.txt": "eula=true\n", "server.properties": `server-port=${await freePort()}\nwhite-list=true\n`, "whitelist.json": "[]", "fake-server.json": JSON.stringify({ players: ["alice", "bob"], maxPlayers: 20 }) });
        installFakeJava(javaPackageFor("1.21.1")!);
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


/** starts Survival, whose stand-in has alice and bob on it; `exited` resolves once it exits */
async function startSurvival(): Promise<{ exited: Promise<void> }> {
    const exited = new Promise<void>((resolve) => processApi.onExit(`${MC}-mc-server`, () => resolve()));
    await serverCalls(MC).startServer();
    return { exited };
}
const CONSOLE_INPUT = `document.querySelector("[class*=PaperConsole] input")`;
const dialogButton = (label: string) => `[...document.querySelectorAll("[role=dialog] button")].find((b) => b.innerText.trim() === ${JSON.stringify(label)} && !b.disabled)`;

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

    test("at the window's default size, a notice above the console still leaves the whole Overview on screen, its command line in view", async () => {
        const served = await setUp(await freePort());
        const exited = new Promise<void>((resolve) => processApi.onExit(`${MC}-mc-server`, () => resolve()));
        await serverCalls(MC).startServer();
        // the panel beside the app's menus in its default window
        const page = await openPage(`${served.url}/?server=${MC}`);
        try {
            await page.resize(860, 680);
            await page.waitFor(`${button("Stop")} && ${text("Whitelist is on")} && document.querySelector("[class*=PaperConsole] input")`, "the running server's Overview with its notice");
            await page.settled();
            // nothing around the console scrolls: the console alone does, and its command line is in view
            const scrolled = `(() => { const out = []; for (let el = document.querySelector("[class*=PaperConsole] input"); el; el = el.parentElement) { const y = getComputedStyle(el).overflowY; if ((y === "auto" || y === "scroll") && el.scrollHeight > el.clientHeight + 1) out.push(el.className); } return out; })()`;
            expect(await page.evaluate<string[]>(scrolled)).toEqual([]);
            expect(await page.evaluate<number>(`document.querySelector("[class*=PaperConsole] input").getBoundingClientRect().bottom`)).toBeLessThanOrEqual(680);
        } finally {
            await page.close();
            await serverCalls(MC).stopServer();
            await exited;
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
    test("at the 860 by 560 window, the command line is in view and the console has the height left, with a notice above it", async () => {
        const served = await setUp(await freePort());
        const { exited } = await startSurvival();
        // the panel beside the app's menus in the smallest window
        const page = await openPage(`${served.url}/?server=${MC}`, NARROWEST);
        try {
            await page.resize(620, 521);
            await page.waitFor(`${button("Stop")} && ${text("Whitelist is on")} && ${CONSOLE_INPUT}`, "the running server's Overview with its notice");
            await page.settled();
            const input = await page.evaluate<{ top: number; bottom: number }>(`(() => { const r = ${CONSOLE_INPUT}.getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; })()`);
            expect(input.bottom).toBeLessThanOrEqual(521);
            // the console keeps a height of its own, more than a few lines
            expect(await page.evaluate<number>(`document.querySelector("[class*=outputArea]").clientHeight`)).toBeGreaterThan(140);
            // what is above it is all still there, a scroll away
            expect(await page.evaluate<boolean>(`(() => { const quote = [...document.querySelectorAll("[class*=PaperQuote]")].find((q) => q.innerText.includes("Whitelist is on")); quote.scrollIntoView(); const r = quote.getBoundingClientRect(); return r.top >= 0 && r.bottom <= ${CONSOLE_INPUT}.getBoundingClientRect().top; })()`)).toBe(true);
            expect(page.exceptions).toEqual([]);
        } finally {
            await page.close();
            await serverCalls(MC).stopServer();
            await exited;
            served.stop();
        }
    }, 90_000);

    test("a command refused because the server was offline stops saying so once the server is online", async () => {
        const served = await setUp(await freePort());
        const page = await openPage(`${served.url}/?server=${MC}`);
        let exited: Promise<void> | null = null;
        try {
            await page.waitFor(`${button("Start")} && ${CONSOLE_INPUT}`, "the stopped server's Overview");
            await page.type(`[class*=PaperConsole] input`, "list", true);
            await page.waitFor(text("Couldn't run the command"), "the refused command's notice");
            exited = new Promise<void>((resolve) => processApi.onExit(`${MC}-mc-server`, () => resolve()));
            await start(page);
            await page.waitFor(`${button("Stop")} && ${text("Online")}`, "the server online");
            await page.waitFor(`!${text("Couldn't run the command")}`, "the stale notice gone");
        } finally {
            await page.close();
            if (exited) {
                await serverCalls(MC).stopServer();
                await exited;
            }
            served.stop();
        }
    }, 90_000);

    test("Stop asks first while players are on, on the page and in its Home widget", async () => {
        const served = await setUp(await freePort());
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

    test("on a phone the setup wizard starts at the top and its list is whole, in one scroll", async () => {
        const served = await setUp(await freePort());
        const page = await openPage(`${served.url}/?server=${NEW}`);
        try {
            await page.resize(390, 844);
            await page.waitFor(`${text("Server Software")} && ${text("Forge")}`, "the wizard's first step");
            await page.settled();
            const layout = await page.evaluate<{ gap: number; scrollers: number; forgeBottom: number; footTop: number }>(`(() => {
                const title = [...document.querySelectorAll("*")].find((el) => el.children.length === 0 && el.textContent.trim() === "Server Software");
                const step = title.closest("[class*=PaperWizardStep]");
                const out = [];
                for (let el = title.parentElement; el && el !== step.parentElement; el = el.parentElement) {
                    const y = getComputedStyle(el).overflowY;
                    if ((y === "auto" || y === "scroll") && el.scrollHeight > el.clientHeight + 1) out.push(el);
                }
                const forge = [...document.querySelectorAll("label, [role=radio], [class*=SelectorItem]")].find((el) => el.innerText?.startsWith("Forge"));
                const next = [...document.querySelectorAll("button")].find((b) => b.innerText.includes("Next"));
                return { gap: title.getBoundingClientRect().top - step.getBoundingClientRect().top, scrollers: out.length, forgeBottom: forge.getBoundingClientRect().bottom, footTop: next.getBoundingClientRect().top };
            })()`);
            // no band of empty space over the heading, and nothing scrolls inside a scroll
            expect(layout.gap).toBeLessThan(40);
            expect(layout.scrollers).toBeLessThanOrEqual(1);
            // every choice is on screen above the wizard's footer
            expect(layout.forgeBottom).toBeLessThanOrEqual(layout.footTop);
        } finally {
            await page.close();
            served.stop();
        }
    }, 90_000);
});
