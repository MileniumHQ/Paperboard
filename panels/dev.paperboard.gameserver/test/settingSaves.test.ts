// A setting's switch flips the moment it is pressed and stays the switch it
// is while it saves; the Versions tab opens on what is installed; and an
// add-on update the Versions tab asks for runs once, not on every visit to
// the Plugins tab after it.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { startTestDaemon, type TestDaemon } from "./helpers/crane";
import { openPage, servePanel, type Page } from "./helpers/browser";
import { installFakeJava } from "./helpers/fakeJava";
import { loopbackServer, routeHost } from "./helpers/http";
import { writeTree } from "./helpers/tmp";
import { serverCalls } from "./helpers/serverCall";
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
const PAPER_JAR = "a newer paper server jar";
const configFile = () => path.join(daemon.dataDir, "configs", `${PANEL_ID}.json`);
const serverDir = () => path.join(daemon.dataDir, "files", PANEL_ID, SERVERS, "s-mc");
const settings = () => JSON.parse(fs.readFileSync(configFile(), "utf8")).servers[0].settings as Record<string, any>;

// Paper's API, as the service reads it: two releases, the newer listed first
const paper = loopbackServer((_req, url) => {
    const json = (body: unknown) => Response.json(body);
    switch (url.pathname) {
        case "/v3/projects/paper": return json({ versions: { "1.21": ["1.21.4", "1.21.1"] } });
        case "/v3/projects/paper/versions/1.21.4": return json({ builds: [7] });
        case "/v3/projects/paper/versions/1.21.4/builds/7":
            return json({ downloads: { "server:default": { url: `${paper.url}/paper-1.21.4-7.jar`, checksums: { sha256: createHash("sha256").update(PAPER_JAR).digest("hex") } } } });
        case "/paper-1.21.4-7.jar": return new Response(PAPER_JAR);
        default: return new Response("Not found", { status: 404 });
    }
});
routeHost("fill.papermc.io", paper);

let ready: Promise<void> | null = null;
/** one stopped Paper 1.21.1 server with a plugin Paperboard has no record of, and the panel served */
async function setUp() {
    ready ??= (async () => {
        fs.mkdirSync(path.dirname(configFile()), { recursive: true });
        fs.writeFileSync(configFile(), JSON.stringify({ version: 2, serversDirectory: SERVERS, servers: [{ id: "s-mc", name: "Survival", game: "minecraft", directory: `${SERVERS}/s-mc`, createdAt: 0, settings: { configured: true, software: "paper", version: "1.21.1" } }] }));
        writeTree(serverDir(), { "server.jar": "jar", "eula.txt": "eula=true\n", "plugins/Homemade.jar": "a plugin built at home" });
        installFakeJava(javaPackageFor("1.21.1")!);
        installFakeJava(javaPackageFor("1.21.4")!);
        const { gameServerService } = await import("../src/service");
        await gameServerService.ready;
    })();
    await ready;
    return servePanel(daemon);
}

const openTab = async (page: Page, id: string, shows: string) => {
    await page.click(`input[name=serverMenu][value="${id}"]`);
    await page.waitFor(`document.body.innerText.includes(${JSON.stringify(shows)})`, `the ${id} tab`);
};
/** the switch in the setting row titled `title` */
const switchIn = (title: string) => `[...document.querySelectorAll("[role=switch]")].find((el) => el.closest("li, [class*=PaperSettingItem]")?.innerText.includes(${JSON.stringify(title)}))`;
/** the button whose label (after any icon) is `text` */
const button = (text: string) => `[...document.querySelectorAll("button")].find((b) => b.innerText.trim().endsWith(${JSON.stringify(text)}))`;

describe("a setting's switch", () => {
    test("pressed, it slides over at once, is never disabled by its own save, and stays the switch it is", async () => {
        const served = await setUp();
        const page = await openPage(`${served.url}/?server=s-mc`);
        const crash = switchIn("Restart after a crash");
        try {
            await page.waitFor(`document.body.innerText.includes("Automation")`, "the server menu");
            await openTab(page, "automation", "Restart after a crash");
            await page.waitFor(`${crash}`, "the Restart after a crash switch");
            await page.settled();
            const before = await page.evaluate<string>(`${crash}.getAttribute("aria-checked")`);
            const after = before === "true" ? "false" : "true";
            // what the switch did between the press and the save's answer
            await page.evaluate(`(() => {
                const el = ${crash};
                el.dataset.pressed = "this one";
                window.__seen = [];
                new MutationObserver(() => window.__seen.push({ checked: el.getAttribute("aria-checked"), disabled: el.getAttribute("aria-disabled") })).observe(el, { attributes: true });
                el.click();
                window.__atOnce = el.getAttribute("aria-checked");
            })()`);
            // flipped in the same task as the press, before any answer
            expect(await page.evaluate<string>("window.__atOnce")).toBe(after);
            await page.waitFor(`/animating/.test(${crash}.className)`, "the switch to slide");
            await page.settled();
            await page.waitFor(`${crash}.getAttribute("aria-checked") === ${JSON.stringify(after)}`, "the saved value");
            expect(await page.evaluate<string>(`${crash}.dataset.pressed`)).toBe("this one");
            const seen = await page.evaluate<{ checked: string; disabled: string | null }[]>("window.__seen");
            expect(seen.every((s) => s.disabled === null && s.checked === after)).toBe(true);
            expect(settings().automation.restartAfterCrash).toBe(after === "true");
            expect(page.exceptions).toEqual([]);
        } finally {
            await page.close();
            served.stop();
        }
    }, 60_000);
});

describe("settings saved at once", () => {
    test("from different parts of the panel all stay saved", async () => {
        await setUp();
        // the server is stopped, so each gamerule edit is kept for its next start
        await Promise.all([
            serverCalls("s-mc").writeAutomation({ patch: { dailyRestart: "04:00" } }),
            serverCalls("s-mc").setGamerule({ name: "keep_inventory", value: "true" }),
            serverCalls("s-mc").writeGameOptions({ patch: { ramGB: 3 } }),
        ]);
        expect(settings().automation.dailyRestart).toBe("04:00");
        expect(settings().pendingGamerules).toEqual({ keep_inventory: "true" });
        expect(settings().ramGB).toBe(3);
    });
});

describe("the Versions tab", () => {
    test("opens on the installed version, not the newest release", async () => {
        const served = await setUp();
        const page = await openPage(`${served.url}/?server=s-mc`);
        try {
            await page.waitFor(`document.body.innerText.includes("Versions")`, "the server menu");
            await openTab(page, "versions", "Minecraft version");
            await page.waitFor(`document.querySelector('input[name=minecraftVersion][value="1.21.4"]')`, "the version list");
            await page.settled();
            expect(await page.evaluate<string>(`document.querySelector("input[name=minecraftVersion]:checked")?.value`)).toBe("1.21.1");
            // nothing to switch to while the installed version is the one chosen
            expect(await page.evaluate<boolean>(`[...document.querySelectorAll("button")].find((b) => b.innerText.includes("Switch to"))?.disabled`)).toBe(true);
            expect(page.exceptions).toEqual([]);
        } finally {
            await page.close();
            served.stop();
        }
    }, 60_000);
});

describe("an add-on update the Versions tab asks for", () => {
    test("runs once, and a later visit to Plugins does not run it again", async () => {
        const served = await setUp();
        const page = await openPage(`${served.url}/?server=s-mc`);
        const failuresModal = `document.body.innerText.includes("1 plugin wasn't checked")`;
        try {
            await page.waitFor(`document.body.innerText.includes("Versions")`, "the server menu");
            await openTab(page, "versions", "Minecraft version");
            await page.waitFor(`document.querySelector('input[name=minecraftVersion][value="1.21.4"]')`, "the version list");
            await page.evaluate(`document.querySelector('input[name=minecraftVersion][value="1.21.4"]').click()`);
            await page.waitFor(`${button("Switch to Paper 1.21.4")} && !${button("Switch to Paper 1.21.4")}.disabled`, "the switch button");
            await page.evaluate(`${button("Switch to Paper 1.21.4")}.click()`);
            await page.waitFor(`${button("Switch anyway")}`, "the confirmation");
            await page.evaluate(`${button("Switch anyway")}.click()`);
            await page.waitFor(`${button("Update plugins")}`, "the switch to finish");
            expect(settings().version).toBe("1.21.4");

            // the update runs once, on the Plugins tab: the home-made plugin has nothing to update from
            await page.evaluate(`${button("Update plugins")}.click()`);
            await page.waitFor(failuresModal, "the update's result");
            // a plugin with no Modrinth record is only not checked: nothing says it will crash the
            // server, and nothing offers to remove it
            const dialog = await page.evaluate<string>(`document.querySelector("[role=dialog]").innerText`);
            expect(dialog).toContain("Not checked");
            expect(dialog).toContain("Homemade");
            expect(dialog).not.toContain("crash");
            expect(dialog).not.toContain("Uninstall");
            await page.evaluate(`${button("Close")}.click()`);
            await page.waitFor(`!(${failuresModal})`, "the result to close");

            // another tab, and back: the update is not asked for again
            await openTab(page, "overview", "The server is stopped");
            await openTab(page, "plugins", "Homemade");
            // a request still standing would have started at once, as the tab opened
            expect(await page.evaluate<boolean>(`document.body.innerText.includes("Updating…")`)).toBe(false);
            await page.settled();
            expect(await page.evaluate<boolean>(failuresModal)).toBe(false);
            expect(await page.evaluate<boolean>(`document.body.innerText.includes("Updating…")`)).toBe(false);
            expect(page.exceptions).toEqual([]);
        } finally {
            await page.close();
            served.stop();
        }
    }, 120_000);
});
