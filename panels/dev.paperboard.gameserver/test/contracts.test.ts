import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { callBlockId } from "@mileniumhq/paperapi";
import { startTestDaemon, type TestDaemon } from "./helpers/crane";
import { panelCalls, serverCalls } from "./helpers/serverCall";
import { minecraftServer } from "./helpers/minecraft";
import { MINECRAFT_CALLS, SERVERS_CALLS, TRIGGER_IDS, gameServerContract } from "../src/service/contract";
import { minecraftCalls } from "../src/games/minecraft/calls";
import { playerEvents, sharedBlocks } from "../src/service/blocks";
import { assertGameCall, gameFor, games } from "../src/games";
import { gameModuleFor } from "../src/games/service";
import { testServer } from "./helpers/scope";
import { PANEL_ID, readServersConfig } from "../src/servers";

let daemon: TestDaemon;
beforeAll(async () => {
    daemon = await startTestDaemon();
});
afterAll(async () => {
    await daemon?.stop();
});

const NODE_BUILTINS = /^(node:|(fs|path|os|child_process|net|tls|dgram|crypto|stream|util|events|zlib|worker_threads|http|https)(\/.*)?$)/;

// Call and game contracts are complete and fail closed.
describe("call and game contracts", () => {
    test("every Minecraft call is in the service contract, with none orphaned", () => {
        expect(Object.keys(minecraftCalls).sort()).toEqual([...MINECRAFT_CALLS].sort());
    });

    test("every game's calls can be made over blocks without clashing, and what a game describes it also answers", async () => {
        const everyone = new Map<string, string>();
        for (const game of games) {
            const service = testServer({ game: game.id, directory: "" }).game;
            const names = Object.keys(await service.calls());
            for (const name of names) {
                // each call is an internal block: its name must make a valid, unclashing id
                const id = callBlockId(name);
                const other = everyone.get(id);
                expect([game.id, name, other === undefined || other === name]).toEqual([game.id, name, true]);
                everyone.set(id, name);
            }
            const initial = service.initialState();
            const described = game.describe({ software: initial.serverSoftware, version: initial.serverVersion, settings: initial.gameSettings }).calls;
            expect([game.id, described.filter((name) => !names.includes(name))]).toEqual([game.id, []]);
        }
    });

    test("every call on the panel's contract is answered: by the panel, or by a game", async () => {
        const answered = new Set<string>(SERVERS_CALLS);
        for (const game of games) for (const name of Object.keys(await testServer({ game: game.id, directory: "" }).game.calls())) answered.add(name);
        expect(Object.keys(gameServerContract.calls).filter((name) => !answered.has(name))).toEqual([]);
    });

    test("every event a game emits is a Blocks event of that name", () => {
        const events = [...sharedBlocks({} as never).events!, ...playerEvents()].map((event) => event.id);
        for (const id of Object.values(TRIGGER_IDS)) expect(events).toContain(id);
    });

    test("an empty value is a valid edit for a file write, and a setting still needs its name", async () => {
        const mc = minecraftServer({ files: { "a.txt": "text" } });
        const read = (await minecraftCalls.readServerFile!(mc.server, { path: "a.txt" })) as { version: string };
        await minecraftCalls.writeServerFile!(mc.server, { path: "a.txt", text: "", version: read.version });
        expect(fs.readFileSync(path.join(mc.dir, "a.txt"), "utf8")).toBe("");
        await expect(minecraftCalls.writeLoaderSetting!(mc.server, { id: "", value: "x" })).rejects.toThrow();
    });

    test("unknown games throw instead of falling back to Minecraft", () => {
        for (const id of ["factorio", "__proto__", "constructor", ""]) {
            expect(() => gameFor(id)).toThrow("Unsupported game");
            expect(() => gameModuleFor(id)).toThrow("Unsupported game");
        }
        const stored = { version: 2, serversDirectory: "servers-0123456789ab", servers: [{ id: "s-1", name: "F", game: "factorio", directory: "servers-0123456789ab/s-1", createdAt: 0, settings: {} }] };
        expect(() => readServersConfig(stored)).toThrow();
    });

    test("game metadata bundles for the browser without node imports", async () => {
        const nodeImports: string[] = [];
        const result = await Bun.build({
            entrypoints: [path.join(import.meta.dir, "..", "src", "games", "index.ts")],
            target: "browser",
            conditions: ["browser"],
            plugins: [
                {
                    name: "no-node",
                    setup(build) {
                        build.onResolve({ filter: NODE_BUILTINS }, (args) => {
                            nodeImports.push(`${args.path} from ${path.relative(path.join(import.meta.dir, ".."), args.importer)}`);
                            return { path: args.path, external: true };
                        });
                    },
                },
            ],
        });
        expect(result.logs.filter((l) => l.level === "error").map((l) => l.message)).toEqual([]);
        expect(result.success).toBe(true);
        expect(nodeImports).toEqual([]);
    });

    test("the running service refuses a call a server's software or version does not have, before it runs", async () => {
        // stored before the service starts, as the user's earlier session left them
        const config = path.join(daemon.dataDir, "configs", `${PANEL_ID}.json`);
        fs.mkdirSync(path.dirname(config), { recursive: true });
        const server = (id: string, software: string, version: string) => ({
            id,
            name: id,
            game: "minecraft",
            directory: `servers-0123456789ab/${id}`,
            createdAt: 0,
            settings: { configured: true, software, version },
        });
        fs.writeFileSync(
            config,
            JSON.stringify({ version: 2, serversDirectory: "servers-0123456789ab", servers: [server("s-vanilla", "vanilla", "1.21.1"), server("s-old", "paper", "1.12.2"), server("s-paper", "paper", "1.21.1")] }),
        );
        const { gameServerService } = await import("../src/service");
        await gameServerService.ready;
        expect(gameServerService.getState().serversError).toBeNull();
        await expect(serverCalls("s-vanilla").readCrossplay()).rejects.toThrow('Minecraft does not support "readCrossplay" with this server\'s software and version');
        await expect(serverCalls("s-old").listDatapacks()).rejects.toThrow('does not support "listDatapacks"');
        // nothing ran: the refused crossplay read would have seeded no files, and the server folder holds none
        expect(fs.readdirSync(path.join(daemon.dataDir, "files", PANEL_ID, "servers-0123456789ab", "s-vanilla"))).toEqual([]);
        expect(await serverCalls("s-paper").readCrossplay()).toMatchObject({ software: "paper", geyser: null, floodgate: null });

        // the same check, as the service makes it
        expect(() => assertGameCall(gameFor("minecraft"), { software: "forge", version: "1.20.1", settings: {} }, "prepareCrossplay")).toThrow("does not support");
        await expect(panelCalls().addServer({ name: "Factory", game: "factorio" })).rejects.toThrow("Unsupported game: factorio");
        await expect(panelCalls().addServer({ name: "Proto", game: "__proto__" })).rejects.toThrow("Unsupported game: __proto__");
        expect(gameServerService.getState().servers.map((s: { id: string }) => s.id)).toEqual(["s-vanilla", "s-old", "s-paper"]);
    });
});
