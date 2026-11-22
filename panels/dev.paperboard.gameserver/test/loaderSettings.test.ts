import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { tempDir, readTree } from "./helpers/tmp";
import { readLoaderSettings, writeLoaderSetting } from "../src/service/loaderSettings";

const FIXTURES = path.join(import.meta.dir, "fixtures", "loader");

/** a copy of what the software wrote, to edit */
function copyOf(fixture: string): string {
    const root = tempDir("gameserver-loader-");
    fs.cpSync(path.join(FIXTURES, fixture), root, { recursive: true });
    fs.rmSync(path.join(root, "README.md"), { force: true });
    return root;
}

// Loader settings edit one line of the real file safely.
describe("loader settings", () => {
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
