// The Loader tab against the files each software really writes
// (test/fixtures/loader, see its README): every setting must find its key
// with the shipped default, an edit must change exactly one line, and the
// service refuses anything the schema does not describe.
import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { readLoaderSettings, writeLoaderSetting } from "../src/service/loaderSettings";
import { LOADER_SETTINGS } from "../src/software/loaderSettings";
import type { ServerSoftwareType } from "../src/software/catalog";

const FIXTURES = path.join(import.meta.dir, "fixtures", "loader");
const dirs: string[] = [];

afterEach(() => {
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function serverFrom(fixture: string | null): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pb-loader-"));
    dirs.push(dir);
    if (fixture) fs.cpSync(path.join(FIXTURES, fixture), dir, { recursive: true });
    return dir;
}

const deps = (root: string) => ({ serverDir: async () => root });
const read = (root: string, relative: string) => fs.readFileSync(path.join(root, relative), "utf8");

function changedLines(before: string, after: string): [string, string][] {
    const a = before.split("\n");
    const b = after.split("\n");
    expect(b.length).toBe(a.length);
    return a.map((line, i) => [line, b[i]!] as [string, string]).filter(([x, y]) => x !== y);
}

async function values(software: ServerSoftwareType, root: string) {
    const view = await readLoaderSettings(software, deps(root));
    const out: Record<string, string> = {};
    for (const group of view.groups) for (const s of group.settings) out[s.id] = s.value;
    return { view, values: out };
}

describe("schema matches the real files", () => {
    test("Paper 26.3: every setting is present with its shipped default", async () => {
        const root = serverFrom("paper-26.3");
        const { view, values: v } = await values("paper", root);
        expect(Object.keys(v).sort()).toEqual(LOADER_SETTINGS.paper.schema!.settings.map((s) => s.id).sort());
        expect(view.missing).toEqual([]);
        expect(v["paper.anti-xray"]).toBe("false");
        expect(v["paper.anti-xray-mode"]).toBe("1");
        expect(v["paper.redstone"]).toBe("VANILLA");
        expect(v["paper.chunk-load-rate"]).toBe("100");
        expect(v["spigot.item-merge-radius"]).toBe("0.5");
        expect(v["spigot.item-despawn-rate"]).toBe("6000");
        expect(v["bukkit.monster-limit"]).toBe("70");
    });

    test("NeoForge 26.3 reads the renamed neoforge-synced.toml", async () => {
        const root = serverFrom("neoforge-26.3.0.57");
        const { view, values: v } = await values("neoforge", root);
        expect(view.groups[0]!.path).toBe("config/neoforge-synced.toml");
        expect(Object.keys(v)).toHaveLength(4);
        // the 26.x default turned LAN advertising off
        expect(v["neoforge.advertise-to-lan"]).toBe("false");
    });

    test("NeoForge 21.1 reads neoforge-server.toml", async () => {
        const root = serverFrom("neoforge-21.1.256");
        const { view, values: v } = await values("neoforge", root);
        expect(view.groups[0]!.path).toBe("config/neoforge-server.toml");
        expect(v["neoforge.advertise-to-lan"]).toBe("true");
    });

    test("Forge shows only the keys its version has", async () => {
        const modern = await values("forge", serverFrom("forge-66.0.9"));
        expect(Object.keys(modern.values).sort()).toEqual([
            "forge.advertise-to-lan",
            "forge.full-bounding-box-ladders",
            "forge.remove-erroring-block-entities",
            "forge.remove-erroring-entities",
        ]);
        const v1201 = await values("forge", serverFrom("forge-47.4.10"));
        expect(v1201.values["forge.zombie-baby-chance"]).toBe("0.05");
        expect(v1201.values["forge.use-item-duration-zero"]).toBe("false");
        expect(Object.keys(v1201.values)).toHaveLength(7);
        const legacy = await values("forge", serverFrom("forge-14.23.5.2859"));
        expect(legacy.view.groups[0]!.path).toBe("config/forge.cfg");
        expect(legacy.values["forge-cfg.zombie-summon-chance"]).toBe("0.1");
        expect(Object.keys(legacy.values)).toHaveLength(6);
    });

    test("softwares without loader settings say so", async () => {
        for (const software of ["vanilla", "fabric"] as const) {
            const view = await readLoaderSettings(software, deps(serverFrom(null)));
            expect(view.emptyMessage).toBeTruthy();
            expect(view.groups).toEqual([]);
        }
    });

    test("a server that never started has nothing to edit yet", async () => {
        const view = await readLoaderSettings("neoforge", deps(serverFrom(null)));
        expect(view.groups).toEqual([]);
        expect(view.missing).toEqual(["NeoForge server config"]);
        await expect(
            writeLoaderSetting("neoforge", "neoforge.advertise-to-lan", "true", deps(serverFrom(null))),
        ).rejects.toThrow("Start the server once");
    });
});

describe("writes change exactly one value", () => {
    test("Paper YAML keeps every other line, comments and list indentation included", async () => {
        const root = serverFrom("paper-26.3");
        const cases: [string, string, string, string][] = [
            ["paper.anti-xray", "true", "config/paper-world-defaults.yml", "    enabled: true"],
            ["paper.redstone", "ALTERNATE_CURRENT", "config/paper-world-defaults.yml", "  redstone-implementation: ALTERNATE_CURRENT"],
            ["paper.anti-xray-mode", "2", "config/paper-world-defaults.yml", "    engine-mode: 2"],
            ["paper.max-joins-per-tick", "7", "config/paper-global.yml", "  max-joins-per-tick: 7"],
            ["spigot.item-merge-radius", "1.5", "spigot.yml", "      item: 1.5"],
            ["bukkit.monster-limit", "50", "bukkit.yml", "  monsters: 50"],
        ];
        for (const [id, value, file, line] of cases) {
            const before = read(root, file);
            await writeLoaderSetting("paper", id, value, deps(root));
            const changed = changedLines(before, read(root, file));
            expect(changed).toHaveLength(1);
            expect(changed[0]![1]).toBe(line);
        }
        const after = await values("paper", root);
        expect(after.values["paper.redstone"]).toBe("ALTERNATE_CURRENT");
        expect(after.values["spigot.item-merge-radius"]).toBe("1.5");
    });

    test("Forge TOML keeps its section indentation", async () => {
        const root = serverFrom("forge-47.4.10");
        const file = "world/serverconfig/forge-server.toml";
        const before = read(root, file);
        await writeLoaderSetting("forge", "forge.zombie-baby-chance", "0.2", deps(root));
        expect(changedLines(before, read(root, file))).toEqual([
            ["\tzombieBabyChance = 0.05", "\tzombieBabyChance = 0.2"],
        ]);
    });

    test("Forge 1.12 cfg keeps the type prefix", async () => {
        const root = serverFrom("forge-14.23.5.2859");
        const before = read(root, "config/forge.cfg");
        await writeLoaderSetting("forge", "forge-cfg.remove-erroring-entities", "true", deps(root));
        expect(changedLines(before, read(root, "config/forge.cfg"))).toEqual([
            ["    B:removeErroringEntities=false", "    B:removeErroringEntities=true"],
        ]);
    });

    test("a per-world NeoForge config wins over the global one", async () => {
        const root = serverFrom("neoforge-21.1.256");
        const world = "world/serverconfig/neoforge-server.toml";
        fs.mkdirSync(path.join(root, "world/serverconfig"), { recursive: true });
        fs.copyFileSync(path.join(root, "config/neoforge-server.toml"), path.join(root, world));
        const globalBefore = read(root, "config/neoforge-server.toml");
        const result = await writeLoaderSetting("neoforge", "neoforge.advertise-to-lan", "false", deps(root));
        expect(result.path).toBe(world);
        expect(read(root, world)).toContain("advertiseDedicatedServerToLan = false");
        expect(read(root, "config/neoforge-server.toml")).toBe(globalBefore);
    });

    test("Forge's per-world file follows level-name", async () => {
        const root = serverFrom(null);
        fs.mkdirSync(path.join(root, "survival/serverconfig"), { recursive: true });
        fs.copyFileSync(
            path.join(FIXTURES, "forge-66.0.9/world/serverconfig/forge-server.toml"),
            path.join(root, "survival/serverconfig/forge-server.toml"),
        );
        fs.writeFileSync(path.join(root, "server.properties"), "level-name=survival\n");
        const view = await readLoaderSettings("forge", deps(root));
        expect(view.groups[0]!.path).toBe("survival/serverconfig/forge-server.toml");
    });

    test("two quick edits to one file both land", async () => {
        const root = serverFrom("paper-26.3");
        await Promise.all([
            writeLoaderSetting("paper", "paper.anti-xray", "true", deps(root)),
            writeLoaderSetting("paper", "paper.optimize-explosions", "true", deps(root)),
        ]);
        const { values: v } = await values("paper", root);
        expect(v["paper.anti-xray"]).toBe("true");
        expect(v["paper.optimize-explosions"]).toBe("true");
        expect(fs.readdirSync(path.join(root, "config")).filter((f) => f.endsWith(".paperboard-tmp"))).toEqual([]);
    });
});

describe("the service refuses what the schema does not describe", () => {
    test("unknown ids, other softwares' ids and bad values", async () => {
        const root = serverFrom("paper-26.3");
        const before = read(root, "config/paper-world-defaults.yml");
        const refuse = (id: string, value: string, message: string) =>
            expect(writeLoaderSetting("paper", id, value, deps(root))).rejects.toThrow(message);
        await refuse("paper.nope", "true", "Unknown loader setting");
        await refuse("forge.zombie-baby-chance", "0.2", "Unknown loader setting");
        await refuse("paper.anti-xray", "yes", "true or false");
        await refuse("paper.anti-xray", "true\nproxies: {}", "true or false");
        await refuse("paper.redstone", "REDSTONE_PLUS", "must be one of");
        await refuse("paper.max-entity-collisions", "2000", "between 0 and 1000");
        await refuse("paper.max-entity-collisions", "4.5", "whole number");
        expect(read(root, "config/paper-world-defaults.yml")).toBe(before);
    });
});
