// The Map tab of a world nobody has played on: the server has saved only
// the land around spawn, and the tab says so and how the rest fills in,
// instead of leaving one small tile on an empty canvas unexplained.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { deflateSync } from "node:zlib";
import nbt from "prismarine-nbt";
import { startTestDaemon, type TestDaemon } from "./helpers/crane";
import { openPage, servePanel } from "./helpers/browser";
import { writeTree } from "./helpers/tmp";
import { PANEL_ID } from "../src/servers";

let daemon: TestDaemon;
beforeAll(async () => {
    daemon = await startTestDaemon();
});
afterAll(async () => {
    await daemon?.stop();
});

const SERVERS = "servers-0123456789ab";

/** a region file holding the one chunk at its corner, as a fresh world's spawn saves it */
function spawnRegion(): Buffer {
    const chunk = deflateSync(nbt.writeUncompressed(nbt.comp({ Status: nbt.string("minecraft:full") }) as never));
    const region = Buffer.alloc(8192 + 4096);
    region.writeUIntBE(2, 0, 3);
    region[3] = 1;
    region.writeUInt32BE(chunk.length + 1, 8192);
    region[8192 + 4] = 2;
    chunk.copy(region, 8192 + 5);
    return region;
}

describe("the Map tab", () => {
    test("a world nobody has played on says it holds only the land around spawn, and how the map fills in", async () => {
        const config = path.join(daemon.dataDir, "configs", `${PANEL_ID}.json`);
        fs.mkdirSync(path.dirname(config), { recursive: true });
        fs.writeFileSync(config, JSON.stringify({ version: 2, serversDirectory: SERVERS, servers: [{ id: "s-mc", name: "Survival", game: "minecraft", directory: `${SERVERS}/s-mc`, createdAt: 0, settings: { configured: true, software: "paper", version: "1.21.1" } }] }));
        const dir = path.join(daemon.dataDir, "files", PANEL_ID, SERVERS, "s-mc");
        writeTree(dir, { "server.jar": "jar", "eula.txt": "eula=true\n" });
        fs.mkdirSync(path.join(dir, "world", "region"), { recursive: true });
        fs.writeFileSync(path.join(dir, "world", "region", "r.0.0.mca"), spawnRegion());
        const { gameServerService } = await import("../src/service");
        await gameServerService.ready;
        const served = await servePanel(daemon);
        const page = await openPage(`${served.url}/?server=s-mc`, "620,520");
        try {
            await page.waitFor(`document.querySelector('input[name=serverMenu][value="map"]')`, "the server menu");
            await page.settled();
            await page.evaluate(`document.querySelector('input[name=serverMenu][value="map"]').click()`);
            await page.waitFor(`document.body.textContent.includes("Only the land around spawn so far")`, "the note on the spawn-only map");
            expect(await page.evaluate<boolean>(`document.body.textContent.includes("The map fills in as players explore")`)).toBe(true);
            // the coordinate fields share the toolbar's row, inside the panel
            const fields = await page.evaluate<{ fits: boolean; heights: number[] }>(`(() => {
                const boxes = ["X", "Z"].map((p) => document.querySelector('input[placeholder="' + p + '"]').closest('[class*="_PaperInput_"]').getBoundingClientRect());
                return { fits: boxes.every((b) => b.width > 0 && b.right <= innerWidth), heights: boxes.map((b) => b.height) };
            })()`);
            expect(fields.fits).toBe(true);
            expect(fields.heights[0]).toBe(fields.heights[1]);
            if (process.env.PAPERBOARD_SHOTS) {
                const shot = await page.send("Page.captureScreenshot", { format: "png" });
                fs.writeFileSync(path.join(process.env.PAPERBOARD_SHOTS, "map-toolbar.png"), Buffer.from(shot.data, "base64"));
            }
        } finally {
            await page.close();
            served.stop();
        }
    }, 60_000);
});
