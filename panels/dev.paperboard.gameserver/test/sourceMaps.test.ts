// A Source game's Maps tab: it opens on the rotation the server plays, and a
// map added there joins the end of it.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { startTestDaemon, type TestDaemon } from "./helpers/crane";
import { openPage, servePanel } from "./helpers/browser";
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

describe("a Source game's Maps tab", () => {
    test("opens on the game's rotation, and a map added joins its end", async () => {
        const config = path.join(daemon.dataDir, "configs", `${PANEL_ID}.json`);
        fs.mkdirSync(path.dirname(config), { recursive: true });
        fs.writeFileSync(config, JSON.stringify({ version: 2, serversDirectory: SERVERS, servers: [{ id: "s-tf", name: "Payload", game: TF2.id, directory: `${SERVERS}/s-tf`, createdAt: 0, settings: { configured: true } }] }));
        writeTree(path.join(daemon.dataDir, "files", PANEL_ID, SERVERS, "s-tf", "install"), {
            [`steamapps/appmanifest_${TF2.appId}.acf`]: `"AppState"\n{\n\t"appid"\t\t"${TF2.appId}"\n\t"buildid"\t\t"19000000"\n}\n`,
            "tf/maps/ctf_2fort.bsp": "", "tf/maps/pl_badwater.bsp": "", "tf/maps/koth_harvest_final.bsp": "",
            "tf/cfg/mapcycle.txt": "ctf_2fort\npl_badwater\n",
        });
        const { gameServerService } = await import("../src/service");
        await gameServerService.ready;
        const served = await servePanel(daemon);
        const page = await openPage(`${served.url}/?server=s-tf`);
        try {
            await page.waitFor(`document.querySelector('input[name=serverMenu][value="maps"]')`, "the server menu");
            await page.click('input[name=serverMenu][value="maps"]');
            await page.waitFor(`document.querySelector("[name=source-map-cycle]")?.closest("ul, [role=listbox], div")?.innerText.includes("pl_badwater")`, "the game's rotation");
            const button = (label: string) => `[...document.querySelectorAll("button")].find((b) => b.innerText.trim() === ${JSON.stringify(label)})`;
            await page.evaluate(`${button("Edit rotation")}.click()`);
            await page.waitFor(`${button("Add maps")} && !${button("Add maps")}.disabled`, "the rotation to be Paperboard's");
            await page.evaluate(`${button("Add maps")}.click()`);
            const card = `[...document.querySelectorAll("[role=dialog] button, [role=dialog] [role=button]")].find((el) => el.textContent.includes("koth_harvest_final"))`;
            await page.waitFor(card, "the map to add");
            await page.evaluate(`${card}.click()`);
            await page.settled();
            const stored = () => JSON.parse(fs.readFileSync(config, "utf8")).servers[0].settings.mapCycle;
            expect(stored()).toEqual(["ctf_2fort", "pl_badwater", "koth_harvest_final"]);
            expect(page.exceptions).toEqual([]);
        } finally {
            await page.close();
            served.stop();
        }
    }, 60_000);
});
