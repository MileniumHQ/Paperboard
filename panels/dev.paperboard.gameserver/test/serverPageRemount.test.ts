import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { processApi } from "@mileniumhq/paperapi";
import { callServer } from "./helpers/serverCall";
import { startTestDaemon, type TestDaemon } from "./helpers/crane";
import { openPage, servePanel } from "./helpers/browser";
import { installFakeJava } from "./helpers/fakeJava";
import { writeTree } from "./helpers/tmp";
import { PANEL_ID } from "../src/servers";
import { gameFor } from "../src/games";
import { javaPackageFor } from "../src/lib/versionProfile";

let daemon: TestDaemon;
beforeAll(async () => {
    daemon = await startTestDaemon();
});
afterAll(async () => {
    await daemon?.stop();
});

const SERVERS = "servers-0123456789ab";
const ACTIVE = `document.querySelector("[class*=PaperInterfaceItem]")`;
/** the page's calls to the service, in order, each as "server/name" */
const calls = (frames: string[]) =>
    frames.flatMap((f) => {
        if (!f.includes('"action":"blocks:call"')) return [];
        const { entry, request } = JSON.parse(f).params;
        const call = /^command\.call-(.+)$/.exec(entry)?.[1];
        return call ? [`${request.inputs.input.server}/${call}`] : [];
    });

// The server page does not remount while state arrives.
describe("the server page", () => {
    test("pushed state and settings never remount the open tab, and every tab opens under its header without throwing", async () => {
        const config = path.join(daemon.dataDir, "configs", `${PANEL_ID}.json`);
        fs.mkdirSync(path.dirname(config), { recursive: true });
        fs.writeFileSync(config, JSON.stringify({ version: 2, serversDirectory: SERVERS, servers: [{ id: "s-mc", name: "Survival", game: "minecraft", directory: `${SERVERS}/s-mc`, createdAt: 0, settings: { configured: true, software: "paper", version: "1.21.1" } }] }));
        writeTree(path.join(daemon.dataDir, "files", PANEL_ID, SERVERS, "s-mc"), { "server.jar": "jar", "eula.txt": "eula=true\n" });
        installFakeJava(javaPackageFor("1.21.1")!);
        const { gameServerService } = await import("../src/service");
        await gameServerService.ready;
        const served = await servePanel(daemon);
        const page = await openPage(`${served.url}/?server=s-mc`);
        const exited = new Promise<void>((resolve) => processApi.onExit("s-mc-mc-server", () => resolve()));
        try {
            await page.waitFor(`document.querySelector('input[name=serverMenu][value="options"]')`, "the server menu");
            // the Options tab loads the server's config when it mounts
            await page.click('input[name=serverMenu][value="options"]');
            await page.waitFor(`${ACTIVE}?.innerText.includes("When changes apply")`, "the Options tab");
            await page.evaluate(`${ACTIVE}.firstElementChild.dataset.mounted = "first"`);
            // the mount's own loading is done before anything is pushed
            await page.settled();
            const before = page.sentFrames.length;
            expect(calls(page.sentFrames)).toContain("s-mc/read-game-options");

            // a start pushes status and every console line; a config edit pushes settings
            await callServer("s-mc", "start-server");
            await page.received((f) => f.includes('"server:s-mc":{"serverStatus":"online"'), "the server's online state");
            await callServer("s-mc", "update-panel-config", { patch: { ramGB: 3 } });
            await page.received((f) => f.includes('"ramAllocation":3'), "the edited settings");

            expect(await page.evaluate(`${ACTIVE}.firstElementChild.dataset.mounted`)).toBe("first");
            // a tab that mounted again would load this server's config again
            expect(calls(page.sentFrames.slice(before))).toEqual([]);

            // every tab the server has opens, a page tab under its own header
            const tabs = gameFor("minecraft").describe({ software: "paper", version: "1.21.1", settings: {} }).tabs;
            for (const tab of tabs) {
                await page.click(`input[name=serverMenu][value="${tab.id}"]`);
                await page.waitFor(`document.querySelector('input[name=serverMenu][value="${tab.id}"]').checked && ${ACTIVE}?.innerText.trim()`, `the ${tab.label} tab`);
                // Overview and Map fill the page with the server itself and carry no header
                if (tab.id !== "overview" && tab.id !== "map") expect([tab.id, (await page.evaluate<string>(`${ACTIVE}.innerText`)).split("\n").slice(0, 3)]).toEqual([tab.id, expect.arrayContaining([tab.label])]);
            }
            await page.click('input[name=serverMenu][value="overview"]');
            await page.waitFor(`document.body.innerText.includes("ONLINE")`, "the Overview to show the server online");
            expect(page.exceptions).toEqual([]);
            expect(page.consoleErrors).toEqual([]);
        } finally {
            await page.close();
            await callServer("s-mc", "stop-server");
            await exited;
            served.stop();
        }
    });
});
