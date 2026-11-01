// A new Palworld world has no Level.sav until its first save, and the first
// save used to fail on it: the save read Level.sav's stamp before asking
// Palworld to write it (found on Windows, on a server just installed).
import { afterAll, expect, mock, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as paperapi from "@mileniumhq/paperapi";
import { portApiStub } from "./portApiStub";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "pb-palworld-save-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

mock.module("../src/service/api", () => ({
    ...paperapi,
    portApi: portApiStub(),
    config: { get: async () => ({}), set: async () => true },
    files: { getPath: async () => root },
}));

await import("../src/games/service");
const { palworldPlatform, worldStamp } = await import("../src/games/palworld/service");
const { inServer } = await import("../src/service/scope");
const scope = { server: { id: "s-test", game: "palworld", directory: "" }, locals: new Map() } as any;

test("a world Palworld has not saved yet has no stamp, and gets one once Level.sav is written", () => inServer(scope, async () => {
    const config = path.join(root, "saved", "Config", palworldPlatform(process.platform).configDir);
    fs.mkdirSync(config, { recursive: true });
    fs.writeFileSync(path.join(config, "GameUserSettings.ini"), "[/Script/Pal.PalGameLocalSettings]\nDedicatedServerName=CAD57B324A280886E4FC89AAAF784FDE\n");
    expect(await worldStamp()).toBeNull();
    const world = path.join(root, "saved", "SaveGames", "0", "CAD57B324A280886E4FC89AAAF784FDE");
    fs.mkdirSync(world, { recursive: true });
    fs.writeFileSync(path.join(world, "Level.sav"), "world");
    expect(await worldStamp()).toEqual(expect.any(String));
}));
