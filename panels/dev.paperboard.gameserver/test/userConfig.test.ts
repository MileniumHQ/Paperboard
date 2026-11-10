import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { startTestDaemon, type TestDaemon } from "./helpers/crane";
import { minecraftServer, type McServer } from "./helpers/minecraft";
import { testScope } from "./helpers/scope";
import { tempDir, writeTree } from "./helpers/tmp";
import { PANEL_ID } from "../src/servers";
import { liveResourcePackDeps } from "../src/service/resourcepackDeps";
import { setActiveWorld } from "../src/service/worlds";
import { applyRuntimeProperties } from "../src/service/runtimeProperties";
import { setGamerule } from "../src/service/gamerules";
import { startServerInstance, stopServerInstance } from "../src/service/lifecycle";
import { readServerFile, writeServerFile } from "../src/service/serverFiles";

let daemon: TestDaemon;
beforeAll(async () => {
    daemon = await startTestDaemon();
});
afterAll(async () => {
    await daemon?.stop();
});

const ORIGINAL = "#Minecraft server properties\nmotd=\\u00A7aWelcome\nmax-players=5\nlevel-name=world\n";
const props = (mc: McServer) => fs.readFileSync(path.join(mc.dir, "server.properties"), "utf8");

/** server.properties made unreadable but still writable: a careless edit would replace it */
function unreadable(mc: McServer): void {
    fs.chmodSync(path.join(mc.dir, "server.properties"), 0o200);
}
const restore = (mc: McServer) => fs.chmodSync(path.join(mc.dir, "server.properties"), 0o644);

// User config files are never clobbered.
describe("user config files", () => {
    test("server.properties edits merge into the current file and write non-ASCII as \\uXXXX", async () => {
        const mc = minecraftServer({ files: { "server.properties": ORIGINAL } });
        const deps = mc.run(() => liveResourcePackDeps(mc.scope.ctx));
        await mc.run(() => deps.writeProperties({ "resource-pack": "https://x.example/p.zip", motd: "§bHé ✓" }));
        const written = props(mc);
        expect(written).toContain("max-players=5");
        expect(written).toContain("level-name=world");
        expect(written).toContain("motd=\\u00A7bH\\u00E9 \\u2713");
        expect(written).toMatch(/^[\x00-\x7f]*$/);

        // the Worlds tab's level-name switch is an edit of the same file
        await mc.run(() => setActiveWorld(mc.scope.ctx, "survival"));
        const switched = props(mc);
        expect(switched).toContain("level-name=survival");
        expect(switched).toContain("max-players=5");
        expect(switched).toMatch(/^[\x00-\x7f]*$/);
    });

    test("an unreadable server.properties fails the edit and is not written", async () => {
        const mc = minecraftServer({ files: { "server.properties": ORIGINAL } });
        const deps = mc.run(() => liveResourcePackDeps(mc.scope.ctx));
        unreadable(mc);
        try {
            await expect(mc.run(() => deps.writeProperties({ "resource-pack": "https://x.example/p.zip" }))).rejects.toThrow();
            await expect(mc.run(() => setActiveWorld(mc.scope.ctx, "survival"))).rejects.toThrow();
        } finally {
            restore(mc);
        }
        expect(props(mc)).toBe(ORIGINAL);
    });

    test("an unreadable panel config fails an offline edit with no write", async () => {
        // the service's own config, outside any one server's settings
        const file = path.join(daemon.dataDir, "configs", `${PANEL_ID}.json`);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, "{\"software\": \"paper\", ");
        const ctx = testScope({ directory: "" }).ctx;
        await expect(applyRuntimeProperties(ctx, { difficulty: "hard" })).rejects.toThrow("JSON Parse error");
        expect(fs.readFileSync(file, "utf8")).toBe("{\"software\": \"paper\", ");
        fs.rmSync(file);
    });

    test("offline property and gamerule edits are kept as pending and applied once on the next boot", async () => {
        const mc = minecraftServer({ version: "1.21.1", software: "paper" });
        await mc.run(() => applyRuntimeProperties(mc.scope.ctx, { difficulty: "3", gamemode: "creative", "force-gamemode": "true" }));
        mc.run(() => setGamerule(mc.scope.ctx, "keep_inventory", "true"));
        const settings = () => mc.scope.server.settings as Record<string, Record<string, string>>;
        await mc.scope.waitFor(() => settings().pendingGamerules?.keep_inventory === "true", "the gamerule edit to be saved");
        expect(settings().pendingProperties).toEqual({ difficulty: "3", gamemode: "creative", "force-gamemode": "true" });

        await mc.run(() => startServerInstance(mc.scope.ctx));
        await mc.received("gamemode creative @a");
        await mc.received("gamerule keepInventory true");
        const commands = mc.commands();
        for (const command of ["difficulty hard", "defaultgamemode creative", "gamemode creative @a", "gamerule keepInventory true"]) {
            expect(commands.filter((c) => c === command)).toHaveLength(1);
        }
        await mc.scope.waitFor(() => Object.keys(settings().pendingProperties ?? {}).length === 0 && Object.keys(settings().pendingGamerules ?? {}).length === 0, "the applied edits to be cleared", 5_000).catch((err) => { throw new Error(`${err.message}\nsettings: ${JSON.stringify({ pendingProperties: settings().pendingProperties, pendingGamerules: settings().pendingGamerules })}`); });
        const exit = mc.nextExit();
        await mc.run(() => stopServerInstance(mc.scope.ctx));
        await exit;
    });

    test("Files tab saves refuse a file changed since it was opened, never create one, and keep CRLF, BOM and permission bits", async () => {
        const root = tempDir();
        const deps = { serverDir: async () => root };
        writeTree(root, { "config/paper.yml": "\uFEFFa: 1\r\nb: 2\r\n" });
        const file = path.join(root, "config", "paper.yml");
        fs.chmodSync(file, 0o640);
        const opened = await readServerFile("config/paper.yml", deps);
        if (opened.kind !== "text") throw new Error(`expected text, got ${opened.kind}`);
        expect(opened.text).toBe("a: 1\nb: 2\n");

        const saved = await writeServerFile("config/paper.yml", "a: 1\nb: 3\n", opened.version, false, deps);
        expect(fs.readFileSync(file, "utf8")).toBe("\uFEFFa: 1\r\nb: 3\r\n");
        expect(fs.statSync(file).mode & 0o777).toBe(0o640);

        // the server rewrote it meanwhile: the stale version is refused
        fs.writeFileSync(file, "\uFEFFa: 9\r\n");
        await expect(writeServerFile("config/paper.yml", "a: 1\n", saved.version, false, deps)).rejects.toThrow("changed on disk since you opened it");
        expect(fs.readFileSync(file, "utf8")).toBe("\uFEFFa: 9\r\n");

        await expect(writeServerFile("config/new.yml", "x: 1\n", saved.version, false, deps)).rejects.toThrow("does not exist");
        expect(fs.existsSync(path.join(root, "config", "new.yml"))).toBe(false);
    });
});
