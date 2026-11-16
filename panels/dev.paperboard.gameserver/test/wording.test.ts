// What the pages say names things as they are: fields name what goes in
// them, a player who never joined is not seen yet, an empty list says why,
// and a backup's dialogs name the backup and what a restore does.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { backupApi, backupLocationsApi } from "@mileniumhq/paperapi";
import { startTestDaemon, type TestDaemon } from "./helpers/crane";
import { openPage, servePanel } from "./helpers/browser";
import { installPanel, restartService } from "./helpers/installedPanel";
import { writeTree } from "./helpers/tmp";
import { PANEL_ID } from "../src/servers";

const SERVERS = "servers-0123456789ab";
const dataDir = process.env.PAPERBOARD_DIR!;
let daemon: TestDaemon;
beforeAll(async () => {
    // the daemon runs the installed service, which backups need
    installPanel(dataDir);
    const config = path.join(dataDir, "configs", `${PANEL_ID}.json`);
    fs.mkdirSync(path.dirname(config), { recursive: true });
    fs.writeFileSync(config, JSON.stringify({ version: 2, serversDirectory: SERVERS, servers: [
        { id: "s-mc", name: "Survival", game: "minecraft", directory: `${SERVERS}/s-mc`, createdAt: 0, settings: { configured: true, software: "paper", version: "1.21.1" } },
        { id: "s-empty", name: "Creative", game: "minecraft", directory: `${SERVERS}/s-empty`, createdAt: 0, settings: { configured: true, software: "paper", version: "1.21.1" } },
    ] }));
    // Notch is whitelisted and has never joined: the world keeps no stats of him
    writeTree(path.join(dataDir, "files", PANEL_ID, SERVERS, "s-mc"), { "server.jar": "jar", "eula.txt": "eula=true\n", "whitelist.json": JSON.stringify([{ uuid: "069a79f4-44e9-4726-a5be-fca90e38aaf5", name: "Notch" }]) });
    writeTree(path.join(dataDir, "files", PANEL_ID, SERVERS, "s-empty"), { "server.jar": "jar", "eula.txt": "eula=true\n" });
    daemon = await startTestDaemon();
    await restartService();
});
afterAll(async () => {
    await daemon?.stop();
});

const tab = (id: string) => `input[name=serverMenu][value="${id}"]`;
const field = (placeholder: string) => `document.querySelector('input[placeholder="${placeholder}"]')`;
const text = (value: string) => `document.body.innerText.includes(${JSON.stringify(value)})`;
const dialog = `document.querySelector("[role=dialog]")?.innerText ?? ""`;
const dialogButton = (label: string) => `[...document.querySelectorAll("[role=dialog] button")].find((b) => b.innerText.trim() === ${JSON.stringify(label)} && !b.disabled)`;

describe("what the pages say", () => {
    test("fields name their type, players and their lists say what is so, and a backup's dialogs name it and what a restore does", async () => {
        await backupLocationsApi.setForPanel(PANEL_ID, "local", undefined, "s-mc");
        await backupApi.forSource(PANEL_ID, "s-mc").create({ label: "Before the update" });
        const served = await servePanel(daemon);
        const mc = await openPage(`${served.url}/?server=s-mc`);
        const empty = await openPage(`${served.url}/?server=s-empty`);
        try {
            await mc.waitFor(`${field("Command")} && document.querySelector('${tab("players")}')`, "the Overview's command line");

            await mc.click(tab("players"));
            await mc.waitFor(`${field("Player")} && ${text("Notch")}`, "the whitelisted player");
            const row = await mc.evaluate<string>(`[...document.querySelectorAll("[class*=PaperListItem]")].find((el) => el.innerText.includes("Notch")).innerText`);
            expect(row).toContain("Not seen yet");
            expect(row).not.toContain("unknown");

            await empty.waitFor(`document.querySelector('${tab("players")}')`, "the empty server's menu");
            await empty.click(tab("players"));
            await empty.waitFor(text("No players yet"), "the empty list's reason");
            expect(await empty.evaluate<boolean>(text("match these filters"))).toBe(false);

            await mc.click(tab("versions"));
            await mc.waitFor(field("Version"), "the version search");

            await mc.click(tab("backups"));
            await mc.waitFor(text("Before the update"), "the backup's row");
            const press = (label: string) => mc.evaluate(`[...document.querySelectorAll("[class*=PaperSettingItem]")].find((el) => el.innerText.startsWith("Before the update")).querySelector('${label === "Restore" ? "button:not([aria-label])" : 'button[aria-label="Delete backup"]'}').click()`);
            await press("Restore");
            await mc.waitFor(`!!${dialogButton("Restore")}`, "the restore confirmation");
            const restore = await mc.evaluate<string>(dialog);
            expect(restore).toContain("Restore “Before the update”?");
            expect(restore).toContain("A running server starts again on it.");
            expect(restore).not.toContain("start the server afterwards");
            await mc.evaluate(`${dialogButton("Cancel")}.click()`);
            await mc.waitFor(`!${dialogButton("Restore")}`, "the restore confirmation closed");
            await press("Delete");
            await mc.waitFor(`!!${dialogButton("Delete")}`, "the delete confirmation");
            expect(await mc.evaluate<string>(dialog)).toContain("Delete “Before the update”?");
            expect([mc.exceptions, empty.exceptions]).toEqual([[], []]);
        } finally {
            await empty.close();
            await mc.close();
            served.stop();
        }
    }, 90_000);
});
