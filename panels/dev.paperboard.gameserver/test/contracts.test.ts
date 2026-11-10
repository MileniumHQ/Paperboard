import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { actionsApi, assertActionInputs, validateActionDefinition } from "@mileniumhq/paperapi";
import { startTestDaemon, type TestDaemon } from "./helpers/crane";
import { ACTION_IDS, TRIGGER_IDS } from "../src/service/contract";
import { bindDynamicAction, deletePluginAction, deleteWorldAction, panelActions, panelEventActions, playerJoinedTrigger, playerLeftTrigger, setActiveWorldAction, setGameruleAction } from "../src/games/minecraft/actions";
import { assertGameAction, gameFor, games } from "../src/games";
import { gameServiceFor } from "../src/games/service";
import { PANEL_ID, readServersConfig } from "../src/servers";

let daemon: TestDaemon;
beforeAll(async () => {
    daemon = await startTestDaemon();
});
afterAll(async () => {
    await daemon?.stop();
});

// the options lists depend on what the server has; the ids are fixed
const DYNAMIC = [setActiveWorldAction(["world"]), setGameruleAction(["keep_inventory"]), deleteWorldAction(["world"]), deletePluginAction(["a.jar"])];
const NODE_BUILTINS = /^(node:|(fs|path|os|child_process|net|tls|dgram|crypto|stream|util|events|zlib|worker_threads|http|https)(\/.*)?$)/;

// Action and game contracts are complete and fail closed.
describe("action and game contracts", () => {
    test("every Minecraft action id is in the service contract, with none orphaned", () => {
        const contract = Object.values(ACTION_IDS).sort();
        const defined = [...panelActions, ...DYNAMIC].map((a) => a.id).sort();
        expect(defined).toEqual(contract);
        expect(new Set(defined).size).toBe(defined.length);
        expect(panelEventActions.map((a) => a.id).sort()).toEqual(Object.values(TRIGGER_IDS).sort());
    });

    test("every game's actions pass paperapi's validator, and what a game describes it also defines", async () => {
        for (const game of games) {
            const service = gameServiceFor(game.id);
            const actions = await service.actions();
            const ids = actions.map((a) => a.id);
            expect([game.id, new Set(ids).size]).toEqual([game.id, ids.length]);
            for (const def of actions) expect(() => validateActionDefinition(def)).not.toThrow();
            const initial = service.initialState();
            const described = game.describe({ software: initial.serverSoftware, version: initial.serverVersion, settings: initial.gameSettings }).actions;
            // Minecraft's option-listing actions are published as the server's worlds and plugins change
            const published = [...ids, ...(game.id === "minecraft" ? DYNAMIC.map((d) => d.id) : [])];
            expect([game.id, described.filter((id) => !published.includes(id))]).toEqual([game.id, []]);
        }
        for (const def of DYNAMIC) expect(() => validateActionDefinition(def)).not.toThrow();
    });

    test("event triggers stay uncallable, and join, leave and chat match on inputs they declare", () => {
        const dynamic = [playerJoinedTrigger(["Alice", "Bob"]), playerLeftTrigger(["Alice"])];
        for (const def of [...panelEventActions, ...dynamic]) {
            const bound = bindDynamicAction(def, {} as never);
            expect([def.id, typeof bound.run]).toEqual([def.id, "undefined"]);
            expect(() => validateActionDefinition(bound)).not.toThrow();
        }
        for (const def of [...dynamic, panelEventActions.find((a) => a.id === TRIGGER_IDS.chatMessage)!]) {
            const rules = [def.match].flat();
            expect(rules.length).toBeGreaterThan(0);
            for (const rule of rules) expect(Object.keys(def.inputs ?? {})).toContain(rule!.input);
        }
        expect(dynamic[0]!.inputs!.player!.options).toEqual([
            { label: "Alice", value: "Alice" },
            { label: "Bob", value: "Bob" },
        ]);
    });

    test("an empty value is a valid edit for every setting, file and property write", () => {
        const call = (id: string, values: Record<string, unknown>) => assertActionInputs(panelActions.find((a) => a.id === id)!.inputs, values);
        expect(() => call(ACTION_IDS.writeLoaderSetting, { id: "paper.x", value: "" })).not.toThrow();
        expect(() => call(ACTION_IDS.writeCrossplaySetting, { id: "geyser.server-name", value: "" })).not.toThrow();
        expect(() => call(ACTION_IDS.writeServerFile, { path: "a.txt", text: "", version: "0".repeat(64) })).not.toThrow();
        expect(() => call(ACTION_IDS.applyRuntimeProperties, { values: { motd: "" } })).not.toThrow();
        // the setting's name is still required
        expect(() => call(ACTION_IDS.writeLoaderSetting, { id: "", value: "x" })).toThrow("is required");
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

    test("the running service refuses an action a server's software or version does not have, before it runs", async () => {
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
        const call = (server: string, action: string, inputs: unknown = {}) => actionsApi.call(PANEL_ID, `${server}/${action}`, inputs);

        await expect(call("s-vanilla", ACTION_IDS.readCrossplay)).rejects.toThrow('Minecraft does not support action "read-crossplay" with this server\'s software and version');
        await expect(call("s-old", ACTION_IDS.listDatapacks)).rejects.toThrow('does not support action "list-datapacks"');
        // nothing ran: the refused crossplay read would have seeded no files, and the server folder holds none
        expect(fs.readdirSync(path.join(daemon.dataDir, "files", PANEL_ID, "servers-0123456789ab", "s-vanilla"))).toEqual([]);
        expect(await call("s-paper", ACTION_IDS.readCrossplay)).toMatchObject({ software: "paper", geyser: null, floodgate: null });

        // the same check, as the service makes it
        expect(() => assertGameAction(gameFor("minecraft"), { software: "forge", version: "1.20.1", settings: {} }, ACTION_IDS.prepareCrossplay)).toThrow("does not support");
        await expect(actionsApi.call(PANEL_ID, "add-server", { name: "Factory", game: "factorio" })).rejects.toThrow("Unsupported game: factorio");
        await expect(actionsApi.call(PANEL_ID, "add-server", { name: "Proto", game: "__proto__" })).rejects.toThrow("Unsupported game: __proto__");
        expect(gameServerService.getState().servers.map((s: { id: string }) => s.id)).toEqual(["s-vanilla", "s-old", "s-paper"]);
    });
});
