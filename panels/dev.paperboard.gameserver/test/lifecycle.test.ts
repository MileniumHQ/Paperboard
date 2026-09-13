// log-parsing state machine (bun test): the service's entire picture of
// the server — status, presence, chat, gamerule values — comes from
// handleProcessData/handleProcessExit, so every transition is pinned here:
// start marker, join/leave player events, gamerule readouts, exit handling.
import { describe, it, expect, mock, beforeEach } from "bun:test";

const writes: string[] = [];
const kills: string[] = [];
let savedConfig: Record<string, unknown> = {};
const configSets: Record<string, unknown>[] = [];

mock.module("@paperboard-dev/paperapi", () => ({
    config: {
        get: async () => savedConfig,
        set: async (value: Record<string, unknown>) => {
            configSets.push(value);
            savedConfig = value;
            return true;
        },
    },
    processApi: {
        write: (_id: string, data: string) => {
            writes.push(data);
        },
        kill: (_id: string, sig: string) => {
            kills.push(sig);
        },
        exists: async () => false,
        start: async () => true,
        run: async () => ({}),
        onData: () => () => {},
        onExit: () => () => {},
    },
    files: {
        read: async () => null,
        write: async () => "/fake",
        exists: async () => false,
        getPath: async () => "/srv/mc",
        download: async () => "/fake",
        clear: async () => true,
        delete: async () => true,
    },
    fileApi: {
        read: async () => null,
        write: async () => "/fake",
        exists: async () => false,
        getPath: async () => "/srv/mc",
        download: async () => "/fake",
        clear: async () => true,
        delete: async () => true,
    },
    packages: {
        isInstalled: async () => false,
        getPath: async () => "/java",
        download: async () => {},
    },
    system: {
        getInfo: async () => ({ os: "linux" }),
        getLocalIP: async () => "127.0.0.1",
    },
    terminal: {
        create: async () => true,
        write: () => {},
        onData: () => () => {},
        onExit: () => () => {},
        destroy: () => {},
    },
}));

const { handleProcessData, handleProcessExit, __lifecycleTest } = await import("../src/service/lifecycle");
const { queryGamerules, setGamerule } = await import("../src/service/gamerules");
const {
    assertGameruleName,
    assertGameruleValue,
    parseGameruleValue,
    mergeGameruleValue,
} = await import("../src/core/gamerules");

function makeCtx(overrides: Record<string, unknown> = {}) {
    let state: any = {
        serverStatus: "starting",
        serverEntries: [],
        chatMessages: [],
        onlinePlayers: [],
        seenPlayers: [],
        playerStats: {},
        playerPlaytime: {},
        gamerules: {},
        serverPort: "25565",
        activeIssue: null,
        ...overrides,
    };
    const triggers: { id: string; output: unknown }[] = [];
    return {
        triggers,
        get state() {
            return state;
        },
        setState: (patch: any) => {
            state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
        },
        emitTrigger: (id: string, output: unknown) => {
            triggers.push({ id, output });
        },
    } as any;
}

beforeEach(() => {
    writes.length = 0;
    kills.length = 0;
    configSets.length = 0;
    savedConfig = {};
});

describe("stop force-kill tracking", () => {
    it("a stop issued while a force-kill is pending replaces it — exactly one kill fires", async () => {
        const ctx = makeCtx({ serverStatus: "online" });
        __lifecycleTest.scheduleStopForceKill(ctx, 20);
        expect(__lifecycleTest.isStopForceKillPending()).toBe(true);

        // a restart/stop while the first kill is pending cancels it and
        // reschedules — the old shared handle let a stale timer suppress
        // the new one and leak a fired-but-never-cleared handle
        __lifecycleTest.scheduleStopForceKill(ctx, 20);
        expect(__lifecycleTest.isStopForceKillPending()).toBe(true);

        await new Promise((resolve) => setTimeout(resolve, 60));
        expect(kills).toEqual(["SIGKILL"]);
        // the fired timer nulls itself: the window after a force-kill can
        // never block a new stop from scheduling
        expect(__lifecycleTest.isStopForceKillPending()).toBe(false);
    });

    it("process exit cancels a pending force-kill before it can fire", async () => {
        const ctx = makeCtx({ serverStatus: "online" });
        __lifecycleTest.scheduleStopForceKill(ctx, 5000);
        expect(__lifecycleTest.isStopForceKillPending()).toBe(true);

        handleProcessExit(ctx);
        expect(__lifecycleTest.isStopForceKillPending()).toBe(false);
        // the kill must never land in a session that exited cleanly
        await new Promise((resolve) => setTimeout(resolve, 30));
        expect(kills).toEqual([]);
    });
});

describe("start marker", () => {
    it("flips starting → online exactly once and emits server-started", () => {
        const ctx = makeCtx();
        handleProcessData(ctx, '[12:00:00] [Server thread/INFO]: Done (2.312s)! For help, type "help"\n');
        expect(ctx.state.serverStatus).toBe("online");
        expect(ctx.triggers).toEqual([{ id: "server-started", output: true }]);

        // a repeated Done line (Paper reloads) must not re-fire the trigger
        handleProcessData(ctx, "[12:00:05] [Server thread/INFO]: Done (0.100s)!\n");
        expect(ctx.triggers).toHaveLength(1);
    });

    it("boot re-applies pending offline gamerule edits", async () => {
        savedConfig = { pendingGamerules: { keep_inventory: "true" } };
        const ctx = makeCtx();
        handleProcessData(ctx, '[12:00:00] [Server thread/INFO]: Done (2.312s)! For help, type "help"\n');
        // the apply path is async (config read → console write)
        await new Promise((resolve) => setTimeout(resolve, 10));

        // the offline edit reaches the console, and is consumed so a later
        // boot never clobbers in-game changes with a stale saved value
        expect(writes).toContain("gamerule keep_inventory true\n");
        expect(configSets[0]?.pendingGamerules).toEqual({});
    });
});

describe("player events", () => {
    it("a join updates presence, history, and emits player-joined", () => {
        const ctx = makeCtx({ serverStatus: "online" });
        handleProcessData(ctx, "[12:00:01] [Server thread/INFO]: Steve joined the game\n");
        expect(ctx.state.onlinePlayers).toEqual(["steve"]);
        expect(ctx.state.seenPlayers).toEqual(["steve"]);
        expect(ctx.triggers).toContainEqual({ id: "player-joined", output: "Steve" });
    });

    it("a leave removes presence, records playtime, and emits player-left", () => {
        const ctx = makeCtx({ serverStatus: "online" });
        handleProcessData(ctx, "[12:00:01] [Server thread/INFO]: Steve joined the game\n");
        handleProcessData(ctx, "[12:00:31] [Server thread/INFO]: Steve left the game\n");
        expect(ctx.state.onlinePlayers).toEqual([]);
        expect(ctx.state.playerPlaytime.steve).toBe(30);
        expect(ctx.triggers).toContainEqual({ id: "player-left", output: "Steve" });
    });
});

describe("gamerule readouts", () => {
    it("query responses populate live values", () => {
        const ctx = makeCtx({ serverStatus: "online" });
        handleProcessData(
            ctx,
            "[12:00:02] [Server thread/INFO]: Gamerule keep_inventory is currently set to: false\n",
        );
        expect(ctx.state.gamerules.keep_inventory).toBe("false");
    });

    it("write confirmations converge an online edit on server truth", () => {
        const ctx = makeCtx({ serverStatus: "online" });
        handleProcessData(
            ctx,
            "[12:00:03] [Server thread/INFO]: Gamerule keep_inventory is now set to: true\n",
        );
        expect(ctx.state.gamerules.keep_inventory).toBe("true");
    });

    it("unknown gamerule names never enter the values record", () => {
        const ctx = makeCtx({ serverStatus: "online" });
        handleProcessData(
            ctx,
            "[12:00:04] [Server thread/INFO]: Gamerule totally_made_up is currently set to: yes\n",
        );
        expect(ctx.state.gamerules).toEqual({});
    });
});

describe("exit handling", () => {
    it("marks offline, emits server-stopped, and flushes the line buffer", () => {
        const ctx = makeCtx({ serverStatus: "online" });
        // a trailing line without its newline stays buffered until exit
        handleProcessData(ctx, "[12:00:40] [Server thread/INFO]: <Steve> gg");
        expect(ctx.state.serverEntries).toHaveLength(0);

        handleProcessExit(ctx);
        expect(ctx.state.serverStatus).toBe("offline");
        expect(ctx.triggers).toContainEqual({ id: "server-stopped", output: true });
        // the buffered line was parsed, not dropped (it lands before the
        // exit's own "[Server] Process stopped." entry)
        expect(ctx.state.chatMessages.at(-1)?.text).toBe("<Steve> gg");
        expect(ctx.state.serverEntries.some((e: any) => e.content.includes("<Steve> gg"))).toBe(true);
    });
});

describe("gamerule boundary validation (core)", () => {
    it("refuses names outside the registry and unsafe values", () => {
        expect(() => assertGameruleName("not_a_rule")).toThrow(/Refusing/);
        expect(() => assertGameruleName("keep_inventory; stop")).toThrow(/Refusing/);
        expect(() => assertGameruleValue("keep_inventory", "yes\nstop")).toThrow(/Refusing/);
        expect(() => assertGameruleValue("keep_inventory", "maybe")).toThrow(/Refusing/);
        expect(() => assertGameruleValue("players_sleeping_percentage", "abc")).toThrow(/Refusing/);
        expect(assertGameruleName("keep_inventory")).toBe("keep_inventory");
        expect(assertGameruleValue("keep_inventory", "TRUE")).toBe("true");
        expect(assertGameruleValue("players_sleeping_percentage", "100")).toBe("100");
    });

    it("parses both readout forms and rejects non-readout lines", () => {
        expect(parseGameruleValue("Gamerule keep_inventory is currently set to: true"))
            .toEqual({ name: "keep_inventory", value: "true" });
        expect(parseGameruleValue("Gamerule keep_inventory is now set to: false"))
            .toEqual({ name: "keep_inventory", value: "false" });
        expect(parseGameruleValue("[12:00:00] [Server thread/INFO]: gamerule keep_inventory")).toBeNull();
        expect(parseGameruleValue("Steve joined the game")).toBeNull();
    });

    it("the values record stays bounded under a spoofed log stream", () => {
        let record: Record<string, string> = {};
        for (let i = 0; i < 150; i++) {
            record = mergeGameruleValue(record, "keep_inventory", "true");
        }
        // one registry name repeated never grows the record
        expect(Object.keys(record)).toEqual(["keep_inventory"]);
    });
});

describe("gamerule service actions", () => {
    it("query-gamerules writes one console query per known rule, none offline", () => {
        const offline = makeCtx({ serverStatus: "offline" });
        expect(queryGamerules(offline, ["keep_inventory", "not_a_rule"])).toBe(false);
        expect(writes).toEqual([]);

        const online = makeCtx({ serverStatus: "online" });
        expect(queryGamerules(online, ["keep_inventory", "not_a_rule"])).toBe(true);
        // unknown names are filtered at the boundary, known ones queried
        expect(writes).toEqual(["gamerule keep_inventory\n"]);
    });

    it("an offline edit persists to config instead of vanishing", async () => {
        const ctx = makeCtx({ serverStatus: "offline" });
        expect(setGamerule(ctx, "keep_inventory", "true")).toBe(true);
        await new Promise((resolve) => setTimeout(resolve, 10));
        // no console write while offline — and the edit is saved, not dropped
        expect(writes).toEqual([]);
        expect(savedConfig.pendingGamerules).toEqual({ keep_inventory: "true" });
        expect(ctx.state.gamerules.keep_inventory).toBe("true");
    });

    it("an online edit writes the console command", () => {
        const ctx = makeCtx({ serverStatus: "online" });
        expect(setGamerule(ctx, "keep_inventory", "false")).toBe(true);
        expect(writes).toEqual(["gamerule keep_inventory false\n"]);
        expect(ctx.state.gamerules.keep_inventory).toBe("false");
    });
});
