// The Backups tab deletes and restores what the user picks, each behind its
// confirmation, and a reload after either keeps the rows it did not change.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { backupApi, backupLocationsApi } from "@mileniumhq/paperapi";
import { startTestDaemon, type TestDaemon } from "./helpers/crane";
import { installPanel, restartService } from "./helpers/installedPanel";
import { openPage, servePanel } from "./helpers/browser";
import { writeTree } from "./helpers/tmp";
import { PANEL_ID } from "../src/servers";

const SERVERS = "servers-0123456789ab";
const dataDir = process.env.PAPERBOARD_DIR!;
const folder = path.join(dataDir, "files", PANEL_ID, SERVERS, "s-mc");
const notes = path.join(folder, "notes.txt");

let daemon: TestDaemon;
beforeAll(async () => {
    // the daemon runs the installed service: a restore stops and starts it
    installPanel(dataDir);
    fs.mkdirSync(path.join(dataDir, "configs"), { recursive: true });
    fs.writeFileSync(path.join(dataDir, "configs", `${PANEL_ID}.json`), JSON.stringify({ version: 2, serversDirectory: SERVERS, servers: [{ id: "s-mc", name: "Survival", game: "minecraft", directory: `${SERVERS}/s-mc`, createdAt: 0, settings: { configured: true, software: "paper", version: "1.21.1" } }] }));
    writeTree(folder, { "server.jar": "jar", "eula.txt": "eula=true\n", "notes.txt": "kept" });
    daemon = await startTestDaemon();
    await restartService();
});
afterAll(async () => {
    await daemon?.stop();
});

/** the saved backup's row titled `title` */
const row = (title: string) => `[...document.querySelectorAll("[class*=PaperSettingItem]")].find((el) => el.innerText.split("\\n")[0].trim() === ${JSON.stringify(title)} && el.querySelector("button"))`;
/** the open dialog's enabled button labelled `label` */
const dialogButton = (label: string) => `[...document.querySelectorAll("[role=dialog] button")].find((b) => b.innerText.trim() === ${JSON.stringify(label)} && !b.disabled)`;

describe("the Backups tab", () => {
    test("deletes the backup picked and restores another, keeping the rows a reload did not change", async () => {
        await backupLocationsApi.setForPanel(PANEL_ID, "local", undefined, "s-mc");
        const backups = backupApi.forSource(PANEL_ID, "s-mc");
        const before = await backups.create({ label: "Before the update" });
        await backups.create({ label: "After the update" });
        fs.writeFileSync(notes, "changed");

        const served = await servePanel(daemon);
        const page = await openPage(`${served.url}/?server=s-mc`);
        try {
            await page.waitFor(`document.querySelector('input[name=serverMenu][value="backups"]')`, "the server menu");
            await page.click('input[name=serverMenu][value="backups"]');
            await page.waitFor(`${row("Before the update")} && ${row("After the update")}`, "both backups' rows");
            await page.settled();
            await page.evaluate(`${row("Before the update")}.dataset.test = "kept"`);

            await page.evaluate(`${row("After the update")}.querySelector('button[aria-label="Delete backup"]').click()`);
            await page.waitFor(`!!${dialogButton("Delete")}`, "the delete confirmation");
            await page.evaluate(`${dialogButton("Delete")}.click()`);
            await page.waitFor(`document.body.innerText.includes("Deleted the backup.") && !${row("After the update")}`, "the deleted backup gone");
            await page.settled();
            expect((await backups.list()).map((b) => b.id)).toEqual([before.id]);
            expect(await page.evaluate<string | undefined>(`${row("Before the update")}?.dataset.test`)).toBe("kept");

            await page.evaluate(`[...${row("Before the update")}.querySelectorAll("button")].find((b) => b.innerText.trim() === "Restore").click()`);
            await page.waitFor(`!!${dialogButton("Restore")}`, "the restore confirmation");
            await page.evaluate(`${dialogButton("Restore")}.click()`);
            await page.waitFor(`document.body.innerText.includes("Restored the backup from")`, "the restore done");
            expect(fs.readFileSync(notes, "utf8")).toBe("kept");
            await page.settled();
            expect(await page.evaluate<string | undefined>(`${row("Before the update")}?.dataset.test`)).toBe("kept");
            expect(page.exceptions).toEqual([]);
        } finally {
            await page.close();
            served.stop();
        }
    }, 90_000);
});
