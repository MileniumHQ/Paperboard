import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { callBlockId, serviceApi } from "@mileniumhq/paperapi";
import { startTestDaemon, type TestDaemon } from "./helpers/crane";
import { callServer } from "./helpers/serverCall";
import { minecraftServer } from "./helpers/minecraft";
import { CALLS, TRIGGER_IDS } from "../src/service/contract";
import { minecraftCalls } from "../src/games/minecraft/calls";
import { playerEvents, sharedBlocks } from "../src/service/blocks";
import { assertGameCall, gameFor, games } from "../src/games";
import { gameServiceFor } from "../src/games/service";
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
        expect(Object.keys(minecraftCalls).sort()).toEqual(Object.values(CALLS).sort());
    });

    test("every game's calls can be made over blocks without clashing, and what a game describes it also answers", async () => {
        const everyone = new Map<string, string>();
        for (const game of games) {
            const service = gameServiceFor(game.id);
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

    test("every event a game emits is a Blocks event of that name", () => {
        const events = [...sharedBlocks({} as never).events!, ...playerEvents()].map((event) => event.id);
        for (const id of Object.values(TRIGGER_IDS)) expect(events).toContain(id);
    });

    test("an empty value is a valid edit for a file write, and a setting still needs its name", async () => {
        const mc = minecraftServer({ files: { "a.txt": "text" } });
        const read: { version: string } = await mc.run(() => minecraftCalls[CALLS.readServerFile]!(mc.scope.ctx, { path: "a.txt" }) as Promise<{ version: string }>);
        await mc.run(() => minecraftCalls[CALLS.writeServerFile]!(mc.scope.ctx, { path: "a.txt", text: "", version: read.version }));
        expect(fs.readFileSync(path.join(mc.dir, "a.txt"), "utf8")).toBe("");
        await expect(mc.run(() => minecraftCalls[CALLS.writeLoaderSetting]!(mc.scope.ctx, { id: "", value: "x" }))).rejects.toThrow();
    });

    test("unknown games throw instead of falling back to Minecraft", () => {
        for (const id of ["factorio", "__proto__", "constructor", ""]) {
            expect(() => gameFor(id)).toThrow("Unsupported game");
            expect(() => gameServiceFor(id)).toThrow("Unsupported game");
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
        const call = (server: string, name: string, input: Record<string, unknown> = {}) => callServer(server, name, input);

        await expect(call("s-vanilla", CALLS.readCrossplay)).rejects.toThrow('Minecraft does not support "read-crossplay" with this server\'s software and version');
        await expect(call("s-old", CALLS.listDatapacks)).rejects.toThrow('does not support "list-datapacks"');
        // nothing ran: the refused crossplay read would have seeded no files, and the server folder holds none
        expect(fs.readdirSync(path.join(daemon.dataDir, "files", PANEL_ID, "servers-0123456789ab", "s-vanilla"))).toEqual([]);
        expect(await call("s-paper", CALLS.readCrossplay)).toMatchObject({ software: "paper", geyser: null, floodgate: null });

        // the same check, as the service makes it
        expect(() => assertGameCall(gameFor("minecraft"), { software: "forge", version: "1.20.1", settings: {} }, CALLS.prepareCrossplay)).toThrow("does not support");
        await expect(serviceApi.call(PANEL_ID, "add-server", { name: "Factory", game: "factorio" })).rejects.toThrow("Unsupported game: factorio");
        await expect(serviceApi.call(PANEL_ID, "add-server", { name: "Proto", game: "__proto__" })).rejects.toThrow("Unsupported game: __proto__");
        expect(gameServerService.getState().servers.map((s: { id: string }) => s.id)).toEqual(["s-vanilla", "s-old", "s-paper"]);
    });
});
