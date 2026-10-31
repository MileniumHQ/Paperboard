import { describe, expect, test } from "bun:test";
import { gameFor, games, assertGameAction } from "../src/games";
import { readServersConfig } from "../src/servers";
import { SOFTWARE_IDS } from "../src/software/catalog";
import manifest from "../manifest.json";

describe("bundled game modules", () => {
    test("Minecraft and Terraria are offered; unknown stored games never fall back to it", () => {
        expect(games.map((game) => game.id)).toEqual(["minecraft", "terraria"]);
        const saved = readServersConfig({ configured: true });
        for (const id of ["factorio", "", "constructor", "__proto__"]) {
            expect(() => gameFor(id)).toThrow(`Unsupported game: ${id}`);
            if (id) expect(() => readServersConfig({ ...saved, servers: [{ ...saved.servers[0], game: id }] })).toThrow(`Unsupported game: ${id}`);
        }
        expect(saved.servers[0]!.game).toBe("minecraft");
    });

    test("every registered game has its poster and banner committed", async () => {
        for (const game of games) {
            expect(game.art.tagline.length).toBeGreaterThan(0);
            for (const url of [game.art.poster, game.art.banner]) {
                const file = Bun.file(new URL(`../public${url}`, import.meta.url));
                expect(await file.exists(), `${game.id}: ${url}`).toBe(true);
                expect(file.type).toBe("image/webp");
            }
        }
    });

    test("service resolution also refuses unknown game ids, including in a server scope", async () => {
        const { gameServiceFor, currentGameService } = await import("../src/games/service");
        const { inServer } = await import("../src/service/scope");
        expect(() => gameServiceFor("factorio")).toThrow("Unsupported game: factorio");
        expect(() => inServer({ server: { game: "factorio" } } as any, () => currentGameService())).toThrow("Unsupported game: factorio");
    });

    test("metadata bundles for browsers without service or Node dependencies", async () => {
        const built = await Bun.build({ entrypoints: [new URL("../src/games/index.ts", import.meta.url).pathname], target: "browser" });
        expect(built.success).toBe(true);
        const code = await built.outputs[0]!.text();
        expect(code).not.toContain("node:");
        expect(code).not.toContain("service/api");
        expect(code).not.toContain("processApi");
    });

    test("Minecraft resolves the existing menu, labels and shared tabs for every loader", () => {
        const expected = {
            vanilla: ["overview", "chat", "players", "map", "worlds", "gamerules", "datapacks", "resourcepack", "versions", "options", "files", "logs", "backups", "advanced"],
            paper: ["overview", "chat", "players", "map", "crossplay", "worlds", "gamerules", "datapacks", "resourcepack", "versions", "loader", "plugins", "options", "files", "logs", "backups", "advanced"],
            fabric: ["overview", "chat", "players", "map", "crossplay", "worlds", "gamerules", "datapacks", "resourcepack", "versions", "loader", "plugins", "modpacks", "options", "files", "logs", "backups", "advanced"],
            neoforge: ["overview", "chat", "players", "map", "crossplay", "worlds", "gamerules", "datapacks", "resourcepack", "versions", "loader", "plugins", "modpacks", "options", "files", "logs", "backups", "advanced"],
            forge: ["overview", "chat", "players", "map", "worlds", "gamerules", "datapacks", "resourcepack", "versions", "loader", "plugins", "modpacks", "options", "files", "logs", "backups", "advanced"],
        };
        for (const software of SOFTWARE_IDS) {
            const features = gameFor("minecraft").describe({ software, version: "1.21.4" });
            expect(features.tabs.map((tab) => tab.id)).toEqual(expected[software]);
            expect(features.tabs.filter((tab) => tab.owner === "shared").map((tab) => tab.id)).toEqual(["options", "files", "logs", "backups", "advanced"]);
            // Options and Advanced are the shared options page over Minecraft's own options
            for (const id of ["options", "advanced"]) expect(features.options.some((option) => (option.tab ?? "options") === id)).toBe(true);
            expect(features.optionsWhileRunning).toBe("next-start");
            expect(features.tabs.find((tab) => tab.id === "plugins")?.label).toBe(software === "vanilla" ? undefined : software === "paper" ? "Plugins" : "Mods");
            expect(features.tabs.map((tab) => tab.group).filter((group, i, all) => group && group !== all[i - 1])).toEqual(["Play", "World", "Software", "Server"]);
            expect(features.control).toEqual({ kind: "stdin" });
            expect(features.widgets).toEqual(manifest.widgets.map((widget) => widget.id));
            expect(features.packages).toEqual([{ id: "java-21", purpose: "Minecraft Java runtime" }]);
        }
    });

    test("version floors remain permissive while unknown and enforce the same features on the service", () => {
        const game = gameFor("minecraft");
        const old = { software: "paper", version: "1.12.2" };
        expect(game.describe(old).tabs.map((tab) => tab.id)).not.toContain("map");
        expect(game.describe(old).tabs.map((tab) => tab.id)).not.toContain("players");
        expect(game.describe(old).tabs.map((tab) => tab.id)).not.toContain("datapacks");
        expect(game.describe({ ...old, version: "" }).tabs.map((tab) => tab.id)).toContain("map");
        expect(() => assertGameAction(game, old, "render-map-tile")).toThrow("does not support");
        expect(() => assertGameAction(game, { software: "vanilla", version: "1.21.4" }, "prepare-crossplay")).toThrow("does not support");
        expect(() => assertGameAction(game, old, "run-command")).not.toThrow();
        expect(game.describe({ software: "paper", version: "26.3" }).packages[0]!.id).toBe("java-25");
    });
});
