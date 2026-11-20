// A Source game's Players tab, in the panel as a person uses it: a player who
// is a SourceMod admin wears an Admin tag in the list, whether they are
// offline or banned, and the tag comes and goes with the Permissions switch
// on their page with no reload. No tag while SourceMod is off, for the same
// Steam id. One daemon and two TF2 servers: Payload has SourceMod on, Plain
// has the same admin file with it off.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { startTestDaemon, type TestDaemon } from "./helpers/crane";
import { openPage, servePanel } from "./helpers/browser";
import { serverCalls } from "./helpers/serverCall";
import { writeTree } from "./helpers/tmp";
import { PANEL_ID } from "../src/servers";
import { TF2 } from "../src/games/tf2";

let daemon: TestDaemon;
beforeAll(async () => {
    daemon = await startTestDaemon();
});
afterAll(async () => {
    await daemon?.stop();
});

const SERVERS = "servers-0123456789ab";
const ALICE = "[U:1:1001]";
const BOB = "[U:1:1002]";
const CAROL = "[U:1:1003]";
const SEEN = [
    { steamId: ALICE, name: "Alice", lastSeen: 1_700_000_000_000 },
    { steamId: BOB, name: "Bob", lastSeen: 1_700_000_100_000 },
];
// Alice is an admin with every right, Bob has only the reserved slot: not an admin; Carol is an admin and banned
const ADMINS = `"${ALICE}" "99:z"\n"${BOB}" "b"\n"${CAROL}" "99:z"\n`;

async function setUp() {
    const server = (id: string, name: string, settings: Record<string, unknown>) => ({ id, name, game: TF2.id, directory: `${SERVERS}/${id}`, createdAt: 0, settings });
    const config = path.join(daemon.dataDir, "configs", `${PANEL_ID}.json`);
    fs.mkdirSync(path.dirname(config), { recursive: true });
    fs.writeFileSync(config, JSON.stringify({ version: 2, serversDirectory: SERVERS, servers: [server("s-sm", "Payload", { configured: true, sourcemod: true }), server("s-plain", "Plain", { configured: true })] }));
    for (const id of ["s-sm", "s-plain"]) {
        writeTree(path.join(daemon.dataDir, "files", PANEL_ID, SERVERS, id), {
            "players.json": JSON.stringify(SEEN),
            "bans.json": JSON.stringify([{ steamId: CAROL, name: "Carol", at: 1_700_000_200_000 }]),
            "addons/sourcemod/configs/admins_simple.ini": ADMINS,
        });
    }
    const { gameServerService } = await import("../src/service");
    await gameServerService.ready;
    return servePanel(daemon);
}

const row = (name: string) => `document.querySelector('input[name=playersList][value="${name}"]').closest("label, li, [role=radio]")`;
/** the tags on `name`'s row in the list, as written (the page sets them in capitals) */
const tags = (name: string) => `[...${row(name)}.querySelectorAll("[class*=PaperBadge]")].map((badge) => badge.textContent.trim())`;
const hasTag = (name: string) => `${tags(name)}.includes("Admin")`;
const adminSwitch = `[...document.querySelectorAll("[role=switch]")].find((el) => !el.closest("[inert]") && el.closest("li, [class*=PaperSettingItem]")?.innerText.includes("SourceMod admin"))`;

async function openPlayers(served: { url: string }, server: string) {
    const page = await openPage(`${served.url}/?server=${server}`);
    await page.waitFor(`document.querySelector('input[name=serverMenu][value="players"]')`, "the server menu");
    await page.click('input[name=serverMenu][value="players"]');
    await page.waitFor(`document.querySelector('input[name=playersList][value="Alice"]') && document.querySelector('input[name=playersList][value="Carol"]')`, "the players");
    return page;
}

describe("a Source game's Players tab", () => {
    test("tags a SourceMod admin in the list, offline or banned, and follows the Permissions switch", async () => {
        const served = await setUp();
        const page = await openPlayers(served, "s-sm");
        try {
            // only the admins wear it: an offline one, a banned one, and not a player the file gives a lesser right
            expect(await page.evaluate<boolean[]>(`[${hasTag("Alice")}, ${hasTag("Bob")}, ${hasTag("Carol")}]`)).toEqual([true, false, true]);
            // the Banned tag stays, beside it
            expect(await page.evaluate<string[]>(tags("Carol"))).toEqual(expect.arrayContaining(["Admin", "Banned"]));

            // taking Alice's rights away takes the tag off her row, and the file
            await page.evaluate(`${row("Alice")}.click()`);
            await page.waitFor(adminSwitch, "Alice's admin switch");
            expect(await page.evaluate<string>(`${adminSwitch}.getAttribute("aria-checked")`)).toBe("true");
            await page.evaluate(`${adminSwitch}.click()`);
            await page.waitFor(`!${hasTag("Alice")}`, "Alice's tag to go");
            await page.settled();
            expect(await page.evaluate<boolean[]>(`[${hasTag("Alice")}, ${hasTag("Carol")}]`)).toEqual([false, true]);
            expect(await serverCalls("s-sm").sourcePlayers().then((r) => r.admins)).toEqual([CAROL]);

            // and giving Bob them puts it on his
            await page.evaluate(`${row("Bob")}.click()`);
            await page.waitFor(`${adminSwitch} && ${adminSwitch}.getAttribute("aria-checked") === "false"`, "Bob's admin switch");
            await page.evaluate(`${adminSwitch}.click()`);
            await page.waitFor(hasTag("Bob"), "Bob's tag to come");
            await page.settled();
            expect(await serverCalls("s-sm").sourcePlayers().then((r) => r.admins)).toEqual([CAROL, BOB]);
            expect(page.exceptions).toEqual([]);
        } finally {
            await page.close();
            served.stop();
        }
    });

    test("shows no tag while SourceMod is off, though the file names admins", async () => {
        const served = await setUp();
        const page = await openPlayers(served, "s-plain");
        try {
            await page.settled();
            expect(await page.evaluate<boolean[]>(`[${hasTag("Alice")}, ${hasTag("Bob")}, ${hasTag("Carol")}]`)).toEqual([false, false, false]);
            expect(await page.evaluate<string[]>(tags("Carol"))).toContain("Banned");
            expect(page.exceptions).toEqual([]);
        } finally {
            await page.close();
            served.stop();
        }
    });
});
