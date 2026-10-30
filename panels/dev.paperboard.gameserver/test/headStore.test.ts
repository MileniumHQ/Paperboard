// Player head store (bun test): the real service/skins.ts against a temporary
// folder, with Mojang replaced by a fake fetch that serves one skin. A head
// fetched once is written to disk, and a fresh service (a restart) paints it
// from disk without asking Mojang again; a stale head is refreshed, and kept
// when the refresh cannot reach Mojang.
import { describe, it, expect, mock, afterAll, beforeEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";
import { PNG } from "pngjs";

const UUID = "0f3b2c1d-1111-4222-8333-444455556666";
const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), "gameserver-heads-"));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

function skinPng(): Uint8Array {
    const png = new PNG({ width: 64, height: 64 });
    png.data.fill(200);
    return PNG.sync.write(png);
}

let requests = 0;
let online = true;
mock.module("../src/lib/userAgent", () => ({
    apiFetch: async (url: string) => {
        requests++;
        if (!online) throw new Error("offline");
        if (url.includes("sessionserver")) {
            const textures = Buffer.from(
                JSON.stringify({ textures: { SKIN: { url: "https://textures.test/skin" } } }),
            ).toString("base64");
            return Response.json({ properties: [{ name: "textures", value: textures }] });
        }
        return new Response(skinPng());
    },
}));
mock.module("../src/service/playerStats", () => ({ uuidForPlayerName: async () => null }));

// each import is a fresh module: a new in-memory cache, as after a restart
let generation = 0;
async function freshService() {
    const mod = await import(`../src/service/skins?restart=${generation++}`);
    await mod.configureHeadStore(dir);
    return mod as typeof import("../src/service/skins");
}

beforeEach(() => {
    requests = 0;
    online = true;
});

describe("player head store", () => {
    it("paints a head from disk after a restart without asking Mojang", async () => {
        const first = await freshService();
        const head = await first.getHeadDataUrl({ name: "Steve", uuid: UUID });
        expect(head).toStartWith("data:image/png;base64,");
        expect(requests).toBe(2);
        expect(fs.existsSync(nodePath.join(dir, `${UUID}.png`))).toBe(true);

        requests = 0;
        const restarted = await freshService();
        expect(await restarted.getHeadDataUrl({ name: "Steve", uuid: UUID })).toBe(head);
        expect(requests).toBe(0);
    });

    it("keeps a stale head when the refresh cannot reach Mojang", async () => {
        const file = nodePath.join(dir, `${UUID}.png`);
        const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
        fs.utimesSync(file, twoDaysAgo, twoDaysAgo);
        const stored = `data:image/png;base64,${fs.readFileSync(file).toString("base64")}`;

        online = false;
        const restarted = await freshService();
        expect(await restarted.getHeadDataUrl({ name: "Steve", uuid: UUID })).toBe(stored);
        expect(requests).toBeGreaterThan(0);
    });
});
