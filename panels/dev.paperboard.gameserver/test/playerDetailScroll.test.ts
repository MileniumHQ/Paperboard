// A player's detail is a page of its own: opening another player starts at
// its top, wherever the last player's page was left scrolled. The same
// player's page stays the page it is while their data changes: a switch
// pressed on it slides in place and the page keeps its scroll.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { startTestDaemon, type TestDaemon } from "./helpers/crane";
import { callServer } from "./helpers/serverCall";
import { openPage, servePanel } from "./helpers/browser";
import { installFakeJava } from "./helpers/fakeJava";
import { writeTree } from "./helpers/tmp";
import { PANEL_ID } from "../src/servers";
import { javaPackageFor } from "../src/lib/versionProfile";

let daemon: TestDaemon;
beforeAll(async () => {
    daemon = await startTestDaemon();
});
afterAll(async () => {
    await daemon?.stop();
});

const SERVERS = "servers-0123456789ab";
const whitelist = JSON.stringify([
    { name: "Steve", uuid: "8667ba71-b85a-4004-af54-457a9734eed7" },
    { name: "Alex", uuid: "ec561538-f3fd-461d-aff5-086b22154bce" },
]);
/** everything on screen that scrolls and isn't the roster itself */
const DETAIL_SCROLLERS = `[...document.querySelectorAll("*")].filter((el) => el.scrollHeight > el.clientHeight + 20 && /auto|scroll/.test(getComputedStyle(el).overflowY) && !el.closest("[inert]") && !el.querySelector("input[name=playersList]"))`;
const serverDir = () => path.join(daemon.dataDir, "files", PANEL_ID, SERVERS, "s-mc");

let ready: Promise<void> | null = null;
/** one stopped Minecraft server whose whitelist names Steve and Alex, and the panel served */
async function setUp() {
    ready ??= (async () => {
        const config = path.join(daemon.dataDir, "configs", `${PANEL_ID}.json`);
        fs.mkdirSync(path.dirname(config), { recursive: true });
        fs.writeFileSync(config, JSON.stringify({ version: 2, serversDirectory: SERVERS, servers: [{ id: "s-mc", name: "Survival", game: "minecraft", directory: `${SERVERS}/s-mc`, createdAt: 0, settings: { configured: true, software: "paper", version: "1.21.1" } }] }));
        writeTree(serverDir(), { "server.jar": "jar", "eula.txt": "eula=true\n", "whitelist.json": whitelist });
        installFakeJava(javaPackageFor("1.21.1")!);
        const { gameServerService } = await import("../src/service");
        await gameServerService.ready;
    })();
    await ready;
    return servePanel(daemon);
}
const openRow = (name: string) => `document.querySelector('input[name=playersList][value="${name}"]').closest("label, li, [role=radio]").click()`;

describe("a player's detail on a phone", () => {
    test("another player's page opens at its top after the last one was scrolled", async () => {
        const served = await setUp();
        // a phone's width: the detail is a page over the roster
        const page = await openPage(`${served.url}/?server=s-mc`, "400,560");
        try {
            await page.waitFor(`document.body.innerText.includes("Players")`, "the server menu");
            await page.click('input[name=serverMenu][value="players"]');
            await page.waitFor(`document.body.innerText.includes("Steve")`, "the roster");
            await page.settled();
            await page.evaluate(openRow("Steve"));
            await page.waitFor(`${DETAIL_SCROLLERS}.length > 0`, "Steve's page, long enough to scroll");
            // scrolled as a finger would leave it
            const left = await page.evaluate<number>(`(() => { const el = ${DETAIL_SCROLLERS}[0]; el.scrollTop = 120; return el.scrollTop; })()`);
            expect(left).toBeGreaterThan(0);
            // the Back of the page the detail is in, not of the pages under it
            const back = await page.evaluate<boolean>(`(() => { let el = ${DETAIL_SCROLLERS}[0]; for (; el; el = el.parentElement) { const b = [...el.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "Back"); if (b) { b.click(); return true; } } return false; })()`);
            // a phone's layout: the detail was a page with a way back
            expect(back).toBe(true);
            await page.evaluate(openRow("Alex"));
            await page.waitFor(`${DETAIL_SCROLLERS}.length > 0`, "Alex's page");
            await page.settled();
            expect(await page.evaluate<number>(`Math.max(...${DETAIL_SCROLLERS}.map((el) => el.scrollTop))`)).toBe(0);
        } finally {
            await page.close();
            served.stop();
        }
    }, 60_000);

    test("pressing a switch on a player's page moves that switch, where the page was left", async () => {
        const served = await setUp();
        // a phone's width again: the page is the whole screen, so a rebuilt one would show
        const page = await openPage(`${served.url}/?server=s-mc`, "400,560");
        // the page's first switch is Operator, the second Whitelisted
        const OPERATOR = `[...document.querySelectorAll("[role=switch]")].find((el) => !el.closest("[inert]"))`;
        try {
            await page.waitFor(`document.body.innerText.includes("Players")`, "the server menu");
            await page.click('input[name=serverMenu][value="players"]');
            await page.waitFor(`document.body.innerText.includes("Steve")`, "the roster");
            await page.settled();
            await page.evaluate(openRow("Steve"));
            await page.waitFor(`${DETAIL_SCROLLERS}.length > 0 && ${OPERATOR}`, "Steve's page and its Operator switch");
            await page.settled();
            expect(await page.evaluate<string>(`${OPERATOR}.getAttribute("aria-checked")`)).toBe("false");
            const left = await page.evaluate<number>(`(() => { const el = ${DETAIL_SCROLLERS}[0]; el.scrollTop = 120; window.__scroller = el; ${OPERATOR}.dataset.pressed = "this one"; return el.scrollTop; })()`);
            expect(left).toBeGreaterThan(0);

            // pushed state about the server, not the player, changes nothing here
            await callServer("s-mc", "update-panel-config", { patch: { ramGB: 3 } });
            await page.received((f) => f.includes('"ramAllocation":3'), "the edited settings");

            // pressed where it is, as a finger would, without scrolling to it
            await page.evaluate(`${OPERATOR}.click()`);
            // the switch that was pressed slides over: it is that switch, now on, moving
            await page.waitFor(`(() => { const el = ${OPERATOR}; return el?.dataset.pressed === "this one" && el.getAttribute("aria-checked") === "true" && /animating/.test(el.className); })()`, "the pressed switch to slide on");
            // a stopped server's file was written, and the roster read back from it
            await page.settled();
            expect(JSON.parse(fs.readFileSync(path.join(serverDir(), "ops.json"), "utf8")).map((op: { name: string }) => op.name)).toEqual(["Steve"]);
            expect(await page.evaluate<string>(`${OPERATOR}.dataset.pressed`)).toBe("this one");
            expect(await page.evaluate<string>(`${OPERATOR}.getAttribute("aria-checked")`)).toBe("true");
            expect(await page.evaluate<boolean>(`window.__scroller.isConnected`)).toBe(true);
            expect(await page.evaluate<number>(`window.__scroller.scrollTop`)).toBe(left);
            expect(page.exceptions).toEqual([]);
        } finally {
            await page.close();
            served.stop();
        }
    }, 60_000);
});
