// A ban or a pardon on the Players tab is done once the running server has
// recorded it: the badge comes from the ban list the server wrote, and a
// server that refuses says why on the tab instead of looking banned, also
// on a phone, where the player's page covers the roster. A ban plugin that
// words its answer its own way is judged by the list it wrote, which is
// read again while the server is still writing it. An operator or whitelist
// change is the same: done once the server wrote it, refused in its words. A head that
// could not be looked up says why on the head, and in words on the player's page.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { processApi } from "@mileniumhq/paperapi";
import { startTestDaemon, type TestDaemon } from "./helpers/crane";
import { serverCalls } from "./helpers/serverCall";
import { openPage, servePanel } from "./helpers/browser";
import { installFakeJava } from "./helpers/fakeJava";
import { writeTree } from "./helpers/tmp";
import { loopbackServer, routeHost } from "./helpers/http";
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
const STEVE = "8667ba71-b85a-4004-af54-457a9734eed7";
// on the whitelist, but not an account the server can find
const GHOST = "ec561538-f3fd-461d-aff5-086b22154bce";

// Mojang's profiles: Steve's lookup fails, Ghost has no account
const mojang = loopbackServer((_req, url) =>
    url.pathname.endsWith(STEVE.replace(/-/g, "")) ? new Response("busy", { status: 503 }) : new Response(null, { status: 204 }),
);
routeHost("sessionserver.mojang.com", mojang);
/** the head in `name`'s roster row: its tooltip, and the glyph it shows */
const head = (name: string) =>
    `(() => { const row = document.querySelector('input[name=playersList][value="${name}"]').closest("label, li, [role=radio]"); const avatar = row.querySelector("[class*=PaperAvatar]"); return avatar && { title: avatar.getAttribute("title"), glyph: avatar.innerText.trim() }; })()`;

const openRow = (name: string) => `document.querySelector('input[name=playersList][value="${name}"]').closest("label, li, [role=radio]").click()`;
/** the enabled button whose last line of text is `label`: on the page, or in the open dialog */
const button = (label: string, inDialog = false) =>
    `[...document.querySelectorAll("button")].find((b) => b.innerText.trim().split("\\n").pop() === ${JSON.stringify(label)} && !b.disabled && ${inDialog ? "" : "!"}b.closest("[role=dialog]"))`;
/** whether `text` is on screen, not covered by anything */
const seen = (text: string) =>
    `[...document.querySelectorAll("*")].some((el) => { if (el.children.length > 0 || el.textContent !== ${JSON.stringify(text)}) return false; const r = el.getBoundingClientRect(); const hit = r.width > 0 && document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return !!hit && (hit === el || el.contains(hit) || hit.contains(el)); })`;
/** the open player's page is `name`'s, offering Pardon when they are banned and Ban when not */
const inspectorShows = (name: string, isBanned: boolean) =>
    `[...document.querySelectorAll("*")].some((el) => el.children.length === 0 && el.textContent === ${JSON.stringify(name)}) && !!${button(isBanned ? "Pardon" : "Ban")}`;

describe("the Players tab's bans", () => {
    test("show what the server recorded, and a ban, operator or whitelist change it refuses says why", async () => {
        const config = path.join(daemon.dataDir, "configs", `${PANEL_ID}.json`);
        fs.mkdirSync(path.dirname(config), { recursive: true });
        fs.writeFileSync(config, JSON.stringify({ version: 2, serversDirectory: SERVERS, servers: [{ id: "s-mc", name: "Survival", game: "minecraft", directory: `${SERVERS}/s-mc`, createdAt: 0, settings: { configured: true, software: "paper", version: "1.21.1" } }] }));
        const dir = path.join(daemon.dataDir, "files", PANEL_ID, SERVERS, "s-mc");
        writeTree(dir, {
            "server.jar": "jar",
            "eula.txt": "eula=true\n",
            // online mode: the server finds a name only in its usercache (Mojang is not reachable from it), so Ghost has no account
            "server.properties": "online-mode=true\n",
            "whitelist.json": JSON.stringify([{ uuid: STEVE, name: "Steve" }, { uuid: GHOST, name: "Ghost" }]),
            "usercache.json": JSON.stringify([{ name: "Steve", uuid: STEVE, expiresOn: "2030-01-01 00:00:00 +0000" }]),
            // a slow write of the ban list: it is cut short while the service waits on it
            "fake-server.json": JSON.stringify({ pardonSays: "[BanPlugin] Steve may join again.", listWriteMs: 1000 }),
        });
        installFakeJava(javaPackageFor("1.21.1")!);
        const { gameServerService } = await import("../src/service");
        await gameServerService.ready;
        const served = await servePanel(daemon);
        const exited = new Promise<void>((resolve) => processApi.onExit("s-mc-mc-server", () => resolve()));
        const names = (list: string) => (JSON.parse(fs.readFileSync(path.join(dir, list), "utf8")) as { name: string }[]).map((entry) => entry.name);
        const banned = () => names("banned-players.json");
        const ops = () => names("ops.json");
        await serverCalls("s-mc").startServer();
        const page = await openPage(`${served.url}/?server=s-mc`);
        try {
            await page.waitFor(`document.body.innerText.includes("ONLINE")`, "the server online");
            await page.click('input[name=serverMenu][value="players"]');
            await page.waitFor(`document.querySelector('input[name=playersList][value="Steve"]') && document.querySelector('input[name=playersList][value="Ghost"]')`, "both whitelisted players in the roster");
            // a failed lookup is an error on the head, with Mojang's answer; no account is the plain icon
            await page.waitFor(`${head("Steve")}?.title?.includes("answered 503")`, "Steve's head to say why it failed");
            expect(await page.evaluate(head("Steve"))).toEqual({ title: "Steve's head could not be loaded: Mojang's profile for " + STEVE + " answered 503", glyph: "error" });
            expect(await page.evaluate(head("Ghost"))).toEqual({ title: null, glyph: "person" });

            // the server takes the ban: the badge is the ban list it wrote
            await page.evaluate(openRow("Steve"));
            await page.waitFor(`!!${button("Ban")}`, "Steve's Ban button");
            // his page says why in words too: a phone shows no tooltip
            await page.resize(400, 820);
            await page.waitFor(seen(`Steve's head could not be loaded: Mojang's profile for ${STEVE} answered 503`), "the head's failure on the phone's player page");
            await page.resize(1400, 900);
            await page.evaluate(`${button("Ban")}.click()`);
            await page.waitFor(`!!${button("Ban", true)}`, "the ban dialog");
            // it names who, its reason is ready to type, and Cancel is plain beside the red Ban, as in every confirm
            expect(await page.evaluate<string>(`document.querySelector("[role=dialog]").innerText`)).toContain("Ban Steve?");
            await page.waitFor(`document.activeElement?.tagName === "INPUT" && !!document.activeElement.closest("[role=dialog]")`, "the reason field focused");
            expect(await page.evaluate<string>(`getComputedStyle(${button("Cancel", true)}).backgroundColor`)).toBe("rgba(0, 0, 0, 0)");
            // the reason typed and Enter pressed bans him, and his page says why
            await page.type("[role=dialog] input", "griefing", true);
            await page.waitFor(inspectorShows("Steve", true), "Steve shown banned");
            expect(banned()).toEqual(["Steve"]);
            await page.waitFor(`document.body.innerText.includes("Ban reason: griefing")`, "the ban's reason on his page");
            // he is offline: Kick and Kill are both unavailable, and look the same
            const look = (label: string) =>
                `(() => { const b = [...document.querySelectorAll("button")].find((b) => b.innerText.trim().split("\\n").pop() === ${JSON.stringify(label)}); return b.disabled && getComputedStyle(b).backgroundColor; })()`;
            expect(await page.evaluate(look("Kill"))).toBe(await page.evaluate(look("Kick")));

            // the server refuses: the tab says why, and Ghost is not shown banned
            await page.evaluate(openRow("Ghost"));
            await page.waitFor(inspectorShows("Ghost", false), "Ghost's page");
            await page.evaluate(`${button("Ban")}.click()`);
            await page.waitFor(`!!${button("Ban", true)}`, "the ban dialog");
            await page.evaluate(`${button("Ban", true)}.click()`);
            await page.waitFor(`document.body.innerText.includes("Ghost was not banned") && document.body.innerText.includes("That player does not exist")`, "the server's refusal");
            await page.settled();
            expect(await page.evaluate<boolean>(inspectorShows("Ghost", false))).toBe(true);
            expect(banned()).toEqual(["Steve"]);
            // on a phone the player's page covers the roster: the refusal is on it
            expect(await page.evaluate<boolean>(seen("Ghost was not banned"))).toBe(true);
            await page.resize(400, 820);
            await page.waitFor(seen("Ghost was not banned"), "the refusal on the phone's player page");
            await page.resize(1400, 900);

            // a pardon the ban plugin words its own way is done once the list no longer has him
            await page.evaluate(openRow("Steve"));
            await page.waitFor(`!!${button("Pardon")}`, "Steve's Pardon button");
            await page.evaluate(`${button("Pardon")}.click()`);
            await page.waitFor(inspectorShows("Steve", false), "Steve shown pardoned");
            expect(banned()).toEqual([]);
            expect(await page.evaluate<boolean>(`document.body.innerText.includes("was not pardoned")`)).toBe(false);

            // the server makes him an operator: the switch is the list it wrote
            const operator = `[...document.querySelectorAll("[role=switch]")].find((el) => !el.closest("[inert]") && el.closest("li, [class*=PaperSettingItem]")?.innerText.includes("Operator"))`;
            await page.evaluate(`${operator}.click()`);
            await page.settled();
            expect(ops()).toEqual(["Steve"]);
            expect(await page.evaluate<string>(`${operator}.getAttribute("aria-checked")`)).toBe("true");

            // a name the server finds no account for is refused in the dialog, and nobody is shown whitelisted
            await page.evaluate(`${button("Whitelist")}.click()`);
            await page.waitFor(`!!document.querySelector("[role=dialog] input")`, "the whitelist dialog");
            await page.type("[role=dialog] input", "Nobody");
            await page.evaluate(`${button("Add", true)}.click()`);
            await page.waitFor(`document.querySelector("[role=dialog]")?.innerText.includes("That player does not exist")`, "the server's refusal in the dialog");
            await page.settled();
            expect(await page.evaluate<boolean>(`!!document.querySelector('input[name=playersList][value="Nobody"]')`)).toBe(false);
            expect(page.exceptions).toEqual([]);
        } finally {
            await page.close();
            await serverCalls("s-mc").stopServer();
            await exited;
            served.stop();
        }
    }, 90_000);
});
