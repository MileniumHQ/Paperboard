// A list that is read again, or pushed again, keeps the rows it did not
// change: the servers' cards on the home page, and the Loader tab's settings
// when a refused save reads them again.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { callServer } from "./helpers/serverCall";
import { startTestDaemon, type TestDaemon } from "./helpers/crane";
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
const server = (id: string, name: string) => ({ id, name, game: "minecraft", directory: `${SERVERS}/${id}`, createdAt: 0, settings: { configured: true, software: "paper", version: "1.21.1" } });

let ready: Promise<void> | null = null;
/** two stopped Paper servers, one with Bukkit's settings file, and the panel served */
async function setUp() {
    ready ??= (async () => {
        const config = path.join(daemon.dataDir, "configs", `${PANEL_ID}.json`);
        fs.mkdirSync(path.dirname(config), { recursive: true });
        fs.writeFileSync(config, JSON.stringify({ version: 2, serversDirectory: SERVERS, servers: [server("s-mc", "Survival"), server("s-two", "Creative")] }));
        const files = path.join(daemon.dataDir, "files", PANEL_ID, SERVERS);
        writeTree(path.join(files, "s-mc"), { "server.jar": "jar", "eula.txt": "eula=true\n", "bukkit.yml": "settings:\n  allow-end: true\nspawn-limits:\n  monsters: 70\n  animals: 10\n" });
        writeTree(path.join(files, "s-two"), { "server.jar": "jar", "eula.txt": "eula=true\n" });
        installFakeJava(javaPackageFor("1.21.1")!);
        const { gameServerService } = await import("../src/service");
        await gameServerService.ready;
    })();
    await ready;
    return servePanel(daemon);
}

/** the home page's card for the server named `name` */
const card = (name: string) => `[...document.querySelectorAll("[role=button]")].find((el) => el.innerText.split("\\n").map((line) => line.trim()).includes(${JSON.stringify(name)}))`;

describe("the home page", () => {
    test("a push that renames one server keeps every other server's card", async () => {
        const served = await setUp();
        const page = await openPage(`${served.url}/`, "1400,900");
        try {
            await page.waitFor(`${card("Survival")} && ${card("Creative")}`, "both servers' cards");
            await page.settled();
            await page.evaluate(`${card("Survival")}.dataset.test = "kept"`);
            await callServer("s-two", "rename-server", { name: "Skyblock" });
            await page.waitFor(`${card("Skyblock")}`, "the renamed server's card");
            expect(await page.evaluate<string | undefined>(`${card("Survival")}?.dataset.test`)).toBe("kept");
            expect(page.exceptions).toEqual([]);
        } finally {
            await page.close();
            served.stop();
        }
    }, 60_000);
});

describe("the Loader tab", () => {
    test("a refused save reads the files again and keeps the setting rows they did not change", async () => {
        const served = await setUp();
        const page = await openPage(`${served.url}/?server=s-mc`);
        const row = (title: string) => `[...document.querySelectorAll("[class*=PaperSettingItem]")].find((el) => el.innerText.includes(${JSON.stringify(title)}))`;
        const folder = path.join(daemon.dataDir, "files", PANEL_ID, SERVERS, "s-mc");
        try {
            await page.waitFor(`document.querySelector('input[name=serverMenu][value="loader"]')`, "the server menu");
            await page.click('input[name=serverMenu][value="loader"]');
            await page.waitFor(`${row("Monster spawn limit")} && ${row("Allow the End")}?.querySelector("[role=switch]")`, "the Loader tab's settings");
            await page.settled();
            await page.evaluate(`${row("Monster spawn limit")}.dataset.test = "kept"`);
            // the server folder can't be written, so the save is refused and the tab reads the files again
            fs.chmodSync(folder, 0o555);
            await page.evaluate(`${row("Allow the End")}.querySelector("[role=switch]").click()`);
            await page.waitFor(`document.body.innerText.includes("Not saved")`, "the refusal");
            await page.settled();
            expect(await page.evaluate<string>(`${row("Allow the End")}.querySelector("[role=switch]").getAttribute("aria-checked")`)).toBe("true");
            expect(await page.evaluate<string | undefined>(`${row("Monster spawn limit")}?.dataset.test`)).toBe("kept");
            expect(page.exceptions).toEqual([]);
        } finally {
            fs.chmodSync(folder, 0o755);
            await page.close();
            served.stop();
        }
    }, 60_000);
});

describe("a Loader setting's switch", () => {
    test("flipped twice at once, saves only the last flip, never two at the same time", async () => {
        const served = await setUp();
        const page = await openPage(`${served.url}/?server=s-mc`);
        const toggle = `[...document.querySelectorAll("[class*=PaperSettingItem]")].find((el) => el.innerText.includes("Allow the End"))?.querySelector("[role=switch]")`;
        const bukkit = path.join(daemon.dataDir, "files", PANEL_ID, SERVERS, "s-mc", "bukkit.yml");
        // the most writes the page had waiting on an answer at once, in the order the socket saw them
        const writing = new Set<unknown>();
        let mostAtOnce = 0;
        let answered = 0;
        let answeredOne!: () => void;
        const done = new Promise<void>((resolve) => (answeredOne = resolve));
        const stop = page.on(({ method, params }) => {
            const frame = String(params?.response?.payloadData ?? "");
            if (method === "Network.webSocketFrameSent" && frame.includes("write-loader-setting")) {
                writing.add(JSON.parse(frame).id);
                mostAtOnce = Math.max(mostAtOnce, writing.size);
            }
            if (method === "Network.webSocketFrameReceived" && frame.startsWith("{") && writing.delete(JSON.parse(frame).id) && ++answered === 1) answeredOne();
        });
        try {
            await page.waitFor(`document.querySelector('input[name=serverMenu][value="loader"]')`, "the server menu");
            await page.click('input[name=serverMenu][value="loader"]');
            await page.waitFor(`${toggle}`, "the Allow the End switch");
            await page.settled();
            const before = await page.evaluate<string>(`${toggle}.getAttribute("aria-checked")`);
            await page.evaluate(`(() => { const el = ${toggle}; el.click(); el.click(); })()`);
            // back where it started at once, and never disabled by its own saves
            expect(await page.evaluate<string>(`${toggle}.getAttribute("aria-checked")`)).toBe(before);
            await done;
            await page.settled();
            // the second flip replaced the first before its turn came: only the last is written
            expect(page.sentFrames.filter((f) => f.includes("write-loader-setting"))).toHaveLength(1);
            expect(mostAtOnce).toBe(1);
            expect(fs.readFileSync(bukkit, "utf8")).toContain(`allow-end: ${before}`);
            expect(await page.evaluate<string>(`${toggle}.getAttribute("aria-checked")`)).toBe(before);
            expect(page.exceptions).toEqual([]);
        } finally {
            stop();
            await page.close();
            served.stop();
        }
    }, 60_000);
});
