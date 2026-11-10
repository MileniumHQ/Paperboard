import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { tempDir, readTree } from "./helpers/tmp";
import { readLoaderSettings, writeLoaderSetting, type LoaderSettingView } from "../src/service/loaderSettings";
import type { ServerSoftwareType } from "../src/software/catalog";

const FIXTURES = path.join(import.meta.dir, "fixtures", "loader");
const CASES: [ServerSoftwareType, string, string[]][] = [
    ["paper", "paper-26.3", ["config/paper-world-defaults.yml", "config/paper-global.yml", "spigot.yml", "bukkit.yml"]],
    ["neoforge", "neoforge-21.1.256", ["config/neoforge-server.toml"]],
    ["neoforge", "neoforge-26.3.0.57", ["config/neoforge-synced.toml"]],
    ["forge", "forge-14.23.5.2859", ["config/forge.cfg"]],
    ["forge", "forge-47.4.10", ["world/serverconfig/forge-server.toml"]],
    ["forge", "forge-66.0.9", ["world/serverconfig/forge-server.toml"]],
];

/** a copy of what the software wrote, to edit */
function copyOf(fixture: string): string {
    const root = tempDir("gameserver-loader-");
    fs.cpSync(path.join(FIXTURES, fixture), root, { recursive: true });
    fs.rmSync(path.join(root, "README.md"), { force: true });
    return root;
}

/** a valid value other than the current one */
function another(setting: LoaderSettingView): string {
    switch (setting.control) {
        case "toggle":
            return setting.value === "true" ? "false" : "true";
        case "select":
            return setting.options!.find((o) => o.value !== setting.value)!.value;
        case "number": {
            const current = Number(setting.value);
            const next = setting.max !== undefined && current + 1 > setting.max ? (setting.min ?? 0) : current + 1;
            return String(next);
        }
        case "text":
            return "edited";
    }
}

const changedLines = (before: string, after: string) => {
    const a = before.split("\n");
    const b = after.split("\n");
    expect(b).toHaveLength(a.length);
    return a.flatMap((line, i) => (line === b[i] ? [] : [[line, b[i]]]));
};

// Loader settings edit one line of the real file.
describe("loader settings", () => {
    test.each(CASES)("%s %s: every setting is read from the file the software wrote, and a write changes only its own line", async (software, fixture, files) => {
        const root = copyOf(fixture);
        const deps = { serverDir: async () => root };
        const view = await readLoaderSettings(software, deps);
        expect(view.groups.map((g) => g.path).sort()).toEqual([...files].sort());
        expect(view.groups.every((g) => !g.error && !g.pending)).toBe(true);
        for (const group of view.groups) {
            for (const setting of group.settings) {
                const file = path.join(root, ...group.path.split("/"));
                const before = fs.readFileSync(file, "utf8");
                const value = another(setting);
                expect(await writeLoaderSetting(software, setting.id, value, deps)).toMatchObject({ id: setting.id, path: group.path });
                const after = fs.readFileSync(file, "utf8");
                const changed = changedLines(before, after);
                expect([setting.id, changed.length]).toEqual([setting.id, 1]);
                // comments and indentation around the value stay as written
                const [[oldLine, newLine]] = changed as [[string, string]];
                expect(newLine!.match(/^\s*/)![0]).toBe(oldLine!.match(/^\s*/)![0]);
                const reread = (await readLoaderSettings(software, deps)).groups.flatMap((g) => g.settings).find((s) => s.id === setting.id);
                expect([setting.id, reread?.value]).toEqual([setting.id, value]);
            }
        }
    });

    test("a per-world serverconfig wins over the global file", async () => {
        const root = copyOf("neoforge-21.1.256");
        fs.mkdirSync(path.join(root, "world", "serverconfig"), { recursive: true });
        const global = fs.readFileSync(path.join(root, "config", "neoforge-server.toml"), "utf8");
        fs.writeFileSync(path.join(root, "world", "serverconfig", "neoforge-server.toml"), global.replace("advertiseDedicatedServerToLan = true", "advertiseDedicatedServerToLan = false"));
        const deps = { serverDir: async () => root };
        const [group] = (await readLoaderSettings("neoforge", deps)).groups;
        expect(group!.path).toBe("world/serverconfig/neoforge-server.toml");
        expect(group!.settings.find((s) => s.id === "neoforge.advertise-to-lan")?.value).toBe("false");
        await writeLoaderSetting("neoforge", "neoforge.advertise-to-lan", "true", deps);
        expect(fs.readFileSync(path.join(root, "config", "neoforge-server.toml"), "utf8")).toBe(global);
    });

    test("concurrent edits of one file both land", async () => {
        const root = copyOf("paper-26.3");
        const deps = { serverDir: async () => root };
        await Promise.all([
            writeLoaderSetting("paper", "paper.max-joins-per-tick", "7", deps),
            writeLoaderSetting("paper", "paper.chunk-load-rate", "50", deps),
            writeLoaderSetting("paper", "paper.piston-duplication", "true", deps),
        ]);
        const values = Object.fromEntries((await readLoaderSettings("paper", deps)).groups.flatMap((g) => g.settings).map((s) => [s.id, s.value]));
        expect([values["paper.max-joins-per-tick"], values["paper.chunk-load-rate"], values["paper.piston-duplication"]]).toEqual(["7", "50", "true"]);
    });

    test("invalid or injected values leave every file unchanged", async () => {
        const root = copyOf("paper-26.3");
        const deps = { serverDir: async () => root };
        const before = readTree(root);
        const attempts: [string, unknown][] = [
            ["paper.anti-xray", "maybe"],
            ["paper.anti-xray", "true\nenabled: true"],
            ["paper.max-joins-per-tick", "5\nmax-joins-per-tick: 999"],
            ["paper.max-joins-per-tick", "1e9"],
            ["paper.max-joins-per-tick", "-99999999"],
            ["paper.redstone", "EIGENCRAFT; rm"],
            ["spigot.item-merge-radius", "abc"],
            ["../../server.properties", "true"],
        ];
        for (const [id, value] of attempts) await expect(writeLoaderSetting("paper", id, value, deps)).rejects.toThrow();
        const forge = copyOf("forge-14.23.5.2859");
        const forgeBefore = readTree(forge);
        await expect(writeLoaderSetting("forge", "forge-cfg.zombie-summon-chance", "0.1\n    B:evil=true", { serverDir: async () => forge })).rejects.toThrow();
        expect(readTree(root)).toEqual(before);
        expect(readTree(forge)).toEqual(forgeBefore);
    });
});
