// Crossplay against the files Geyser and Floodgate really write
// (test/fixtures/crossplay, see its README): the shown defaults are the
// generated ones, an edit changes exactly one line, a server that has not
// started with them yet gets a partial file both accept, and the jars are
// found by the name inside them.
import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { strToU8, zipSync } from "fflate";
import { parse as parseYaml } from "yaml";
import { prepareCrossplay, readCrossplay, writeCrossplaySetting } from "../src/service/crossplay";
import { CROSSPLAY } from "../src/software/crossplay";

const FIXTURES = path.join(import.meta.dir, "fixtures", "crossplay");
const dirs: string[] = [];

afterEach(() => {
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function server(fixture: string | null): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pb-crossplay-"));
    dirs.push(dir);
    if (fixture) fs.cpSync(path.join(FIXTURES, fixture), dir, { recursive: true });
    return dir;
}

const deps = (root: string) => ({ serverDir: async () => root });
const read = (root: string, relative: string) => fs.readFileSync(path.join(root, relative), "utf8");

function jar(root: string, relative: string, entries: Record<string, string>) {
    fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    const zipped = zipSync(Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, strToU8(v)])));
    fs.writeFileSync(path.join(root, relative), zipped);
}

function values(view: Awaited<ReturnType<typeof readCrossplay>>) {
    return Object.fromEntries(view.groups.flatMap((g) => g.settings.map((s) => [s.id, s.value])));
}

describe("schema matches the real files", () => {
    test("every setting reads its generated value, which is the default shown before the files exist", async () => {
        const root = server("paper");
        const view = await readCrossplay("paper", deps(root));
        const generated = values(view);
        const settings = CROSSPLAY.paper!.schema.settings;
        expect(Object.keys(generated).sort()).toEqual(settings.map((s) => s.id).sort());
        for (const setting of settings) expect(generated[setting.id]).toBe(setting.defaultValue!);
        expect(view.groups.every((g) => !g.pending)).toBe(true);
    });

    test("an edit changes exactly that key's line", async () => {
        const root = server("paper");
        const before = read(root, "plugins/Geyser-Spigot/config.yml");
        await writeCrossplaySetting("paper", "geyser.port", "19133", deps(root));
        const after = read(root, "plugins/Geyser-Spigot/config.yml");
        const changed = before.split("\n").map((line, i) => [line, after.split("\n")[i]]).filter(([a, b]) => a !== b);
        expect(changed).toEqual([["  port: 19132", "  port: 19133"]]);

        await writeCrossplaySetting("paper", "floodgate.username-prefix", "bedrock_", deps(root));
        expect(read(root, "plugins/floodgate/config.yml")).toContain("username-prefix: bedrock_\n");
    });

    test("turning crossplay on logs Bedrock players in through Floodgate", async () => {
        const root = server("paper");
        await prepareCrossplay("paper", deps(root));
        expect(parseYaml(read(root, "plugins/Geyser-Spigot/config.yml")).java["auth-type"]).toBe("floodgate");
        // the rest of the generated file is untouched
        expect(read(root, "plugins/Geyser-Spigot/config.yml")).toContain("# Geyser Configuration File");
    });
});

describe("before the server has started with them", () => {
    test("settings show their defaults and an edit writes a partial file", async () => {
        const root = server(null);
        const view = await readCrossplay("fabric", deps(root));
        expect(view.groups.map((g) => [g.path, g.pending])).toEqual([
            ["config/Geyser-Fabric/config.yml", true],
            ["config/floodgate/config.yml", true],
        ]);
        expect(values(view)["geyser.port"]).toBe("19132");

        await prepareCrossplay("fabric", deps(root));
        await writeCrossplaySetting("fabric", "geyser.port", "19140", deps(root));
        await writeCrossplaySetting("fabric", "floodgate.require-link", "true", deps(root));
        // the same shape a real Geyser and Floodgate start filled in (see README)
        expect(parseYaml(read(root, "config/Geyser-Fabric/config.yml"))).toEqual({
            java: { "auth-type": "floodgate" },
            bedrock: { port: 19140 },
        });
        expect(parseYaml(read(root, "config/floodgate/config.yml"))).toEqual({ "player-link": { "require-link": true } });
        expect(values(await readCrossplay("fabric", deps(root)))["geyser.port"]).toBe("19140");
    });
});

describe("refusals", () => {
    test("the Bedrock port cannot be the Java port", async () => {
        const root = server("paper");
        fs.writeFileSync(path.join(root, "server.properties"), "server-port=25570\n");
        await expect(writeCrossplaySetting("paper", "geyser.port", "25570", deps(root))).rejects.toThrow("Java server's port");
    });

    test("text is one line, and only listed settings are written", async () => {
        const root = server("paper");
        await expect(writeCrossplaySetting("paper", "floodgate.username-prefix", "a\nkey: x", deps(root))).rejects.toThrow("one line");
        await expect(writeCrossplaySetting("paper", "geyser.auth-type", "offline", deps(root))).rejects.toThrow("Unknown crossplay setting");
    });

    test("Forge and Vanilla have no Geyser", async () => {
        const root = server(null);
        await expect(readCrossplay("forge", deps(root))).rejects.toThrow("Geyser has no build for Forge");
        await expect(readCrossplay("vanilla", deps(root))).rejects.toThrow("Geyser has no build for Vanilla");
    });
});

describe("finding the jars", () => {
    test("by the plugin name inside, whatever the file is called", async () => {
        const root = server(null);
        jar(root, "plugins/bedrock-bridge.jar", { "plugin.yml": "name: Geyser-Spigot\nversion: 2.12.1\nmain: x.Y\n" });
        jar(root, "plugins/floodgate-spigot.jar", { "plugin.yml": "name: floodgate\nversion: 2.2.5\nmain: x.Y\n" });
        jar(root, "plugins/Other.jar", { "plugin.yml": "name: GeyserSkinManager\nversion: 1\nmain: x.Y\n" });
        const view = await readCrossplay("paper", deps(root));
        expect([view.geyser, view.floodgate]).toEqual(["bedrock-bridge.jar", "floodgate-spigot.jar"]);
    });

    test("by mod id on NeoForge, and none when the folder does not exist", async () => {
        const root = server(null);
        expect(await readCrossplay("neoforge", deps(root))).toMatchObject({ geyser: null, floodgate: null });
        jar(root, "mods/Geyser-NeoForge.jar", { "META-INF/neoforge.mods.toml": '[[mods]]\nmodId="geyser_neoforge"\n' });
        const view = await readCrossplay("neoforge", deps(root));
        expect([view.geyser, view.floodgate]).toEqual(["Geyser-NeoForge.jar", null]);
    });
});
