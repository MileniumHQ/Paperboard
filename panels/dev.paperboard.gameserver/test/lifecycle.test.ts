// log-parsing state machine (bun test): the service's entire picture of
// the server — status, presence, chat, gamerule values — comes from
// handleProcessData/handleProcessExit, so every transition is pinned here:
// start marker, join/leave player events, gamerule readouts, exit handling.
import { afterAll, describe, it, expect, mock, beforeEach, jest } from "bun:test";
import * as nodeFs from "node:fs";
import * as nodeOs from "node:os";
import * as nodePath from "node:path";
import { portApiStub } from "./portApiStub";

// a real, empty server folder: the start reads its port files
const serverDir = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), "pb-lifecycle-"));
afterAll(() => nodeFs.rmSync(serverDir, { recursive: true, force: true }));

const writes: string[] = [];
const kills: string[] = [];
// set by a test to make the daemon refuse the next kill
let killError: Error | null = null;
const starts: string[] = [];
let savedConfig: Record<string, unknown> = {};
const configSets: Record<string, unknown>[] = [];

// the system's count of programs it ended for memory; a test raises it
let oomKills: number | null = 0;
const realMemory = await import("../src/service/memory");
mock.module("../src/service/memory", () => ({ ...realMemory, oomKillCount: () => oomKills }));
mock.module("../src/service/api", () => ({
    portApi: portApiStub(),
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
        kill: async (_id: string, sig: string) => {
            if (killError) throw killError;
            kills.push(sig);
        },
        exists: async () => false,
        start: async (opts: { id: string }) => {
            starts.push(opts.id);
            return true;
        },
        run: async () => ({}),
        onData: () => () => {},
        onExit: () => () => {},
    },
    files: {
        read: async () => null,
        write: async () => "/fake",
        exists: async () => true,
        getPath: async () => serverDir,
        download: async () => "/fake",
        clear: async () => true,
        delete: async () => true,
    },
    fileApi: {
        read: async () => null,
        write: async () => "/fake",
        exists: async () => true,
        getPath: async () => serverDir,
        download: async () => "/fake",
        clear: async () => true,
        delete: async () => true,
    },
    packages: {
        isInstalled: async () => true,
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
const { restartServerInstance, sendServerCommand, sendChatMessage, stopServerInstance } = await import("../src/service/lifecycle");
const automation = await import("../src/service/automation");
const { gameServiceFor } = await import("../src/games/service");
const { startServerInstance } = await import("../src/service/lifecycle");
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
        serverSoftware: "paper",
        serverVersion: "1.21.11",
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
    killError = null;
    starts.length = 0;
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

describe("stop while starting", () => {
    it("a refused kill fails the stop and leaves the server marked starting", async () => {
        const ctx = makeCtx({ serverStatus: "starting" });
        killError = new Error("No such process");
        await expect(stopServerInstance(ctx)).rejects.toThrow("No such process");
        expect(ctx.state.serverStatus).toBe("starting");
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

describe("console writes while the server is offline", () => {
    it("fail instead of reporting a command that never ran", async () => {
        const before = writes.length;
        const ctx = makeCtx({ serverStatus: "offline" });
        await expect(sendServerCommand(ctx as any, "list")).rejects.toThrow(/offline/);
        await expect(sendChatMessage(ctx as any, "hi")).rejects.toThrow(/offline/);
        expect(writes.length).toBe(before);
        // the player still sees why in the console
        expect(ctx.state.serverEntries.at(-1).content).toMatch(/offline/);
    });
});

describe("player cap", () => {
    it("the server's list answer sets maxPlayers, and an empty answer clears a stale roster", () => {
        const ctx = makeCtx({ serverStatus: "online", onlinePlayers: ["steve"], maxPlayers: null });
        handleProcessData(ctx, "[12:00:00] [Server thread/INFO]: There are 1 of a max of 20 players online: Steve\n");
        expect(ctx.state.maxPlayers).toBe(20);
        expect(ctx.state.onlinePlayers).toEqual(["steve"]);
        handleProcessData(ctx, "[12:00:15] [Server thread/INFO]: There are 0 of a max of 20 players online:\n");
        expect(ctx.state.onlinePlayers).toEqual([]);
    });

    it("a player chatting the header can't set the cap", () => {
        const ctx = makeCtx({ serverStatus: "online", maxPlayers: 20 });
        handleProcessData(ctx, "[12:00:00] [Server thread/INFO]: <Steve> There are 0 of a max of 999 players online:\n");
        expect(ctx.state.maxPlayers).toBe(20);
    });

    it("going online asks for the list once, and the process exit forgets the cap", () => {
        const ctx = makeCtx({ maxPlayers: null });
        handleProcessData(ctx, '[12:00:00] [Server thread/INFO]: Done (2.312s)! For help, type "help"\n');
        expect(writes.filter((w) => w === "list\n")).toHaveLength(1);
        handleProcessData(ctx, "[12:00:01] [Server thread/INFO]: There are 0 of a max of 8 players online:\n");
        expect(ctx.state.maxPlayers).toBe(8);
        handleProcessExit(ctx);
        expect(ctx.state.maxPlayers).toBeNull();
    });
});

describe("replies to a query sent from the console", () => {
    const entries = (ctx: { state: { serverEntries: { content: string }[] } }) => ctx.state.serverEntries.map((e) => e.content);

    it("show, while the panel's own polls of the same thing stay out", async () => {
        const ctx = makeCtx({ serverStatus: "online" });
        handleProcessData(ctx, "[12:00:00] [Server thread/INFO]: There are 0 of a max of 20 players online:\n");
        expect(entries(ctx).some((line) => line.includes("players online"))).toBe(false);

        await sendServerCommand(ctx as any, "list");
        handleProcessData(ctx, "[12:00:01] [Server thread/INFO]: There are 0 of a max of 20 players online:\n");
        expect(entries(ctx).filter((line) => line.includes("players online"))).toHaveLength(1);
        // one reply per command: the next poll is chatter again
        handleProcessData(ctx, "[12:00:15] [Server thread/INFO]: There are 0 of a max of 20 players online:\n");
        expect(entries(ctx).filter((line) => line.includes("players online"))).toHaveLength(1);

        await sendServerCommand(ctx as any, "/gamerule keepInventory");
        handleProcessData(ctx, "[12:00:16] [Server thread/INFO]: Gamerule keepInventory is currently set to: false\n");
        expect(entries(ctx).some((line) => line.includes("keepInventory is currently set to"))).toBe(true);
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

    it("keeps seen player names in original case, newest first, for the filter dropdown", async () => {
        const { playerNameOptions, __playersTest } = await import("../src/service/players");
        __playersTest.clearNames();
        const ctx = makeCtx({ serverStatus: "online" });
        handleProcessData(ctx, "[12:00:01] [Server thread/INFO]: Steve joined the game\n");
        handleProcessData(ctx, "[12:00:02] [Server thread/INFO]: Alex joined the game\n");
        handleProcessData(ctx, "[12:00:03] [Server thread/INFO]: Steve joined the game\n");
        expect(playerNameOptions()).toEqual(["Steve", "Alex"]);
        __playersTest.clearNames();
    });
});

describe("chat messages", () => {
    it("emits chat-message for a player message with the parsed payload", () => {
        const ctx = makeCtx({ serverStatus: "online" });
        handleProcessData(ctx, "[12:00:40] [Server thread/INFO]: <Steve> gg\n");
        const chat = ctx.triggers.find((t: any) => t.id === "chat-message") as any;
        expect(chat?.output).toMatchObject({ sender: "Steve", content: "gg", text: "<Steve> gg" });
    });

    it("does not emit chat-message for server or join lines", () => {
        const ctx = makeCtx({ serverStatus: "online" });
        handleProcessData(ctx, "[12:00:40] [Server thread/INFO]: [Server] Saving the game\n");
        handleProcessData(ctx, "[12:00:41] [Server thread/INFO]: Steve joined the game\n");
        expect(ctx.triggers.some((t: any) => t.id === "chat-message")).toBe(false);
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

describe("poll chatter stays out of the console", () => {
    it("list responses update presence without appending", () => {
        const ctx = makeCtx({ serverStatus: "online" });
        handleProcessData(
            ctx,
            '[12:00:05] [Server thread/INFO]: There are 2 of a max of 20 players online: Steve, Alex\n',
        );
        expect(ctx.state.onlinePlayers).toEqual(["steve", "alex"]);
        expect(ctx.state.serverEntries).toEqual([]);
    });

    it("empty list responses are chatter too", () => {
        const ctx = makeCtx({ serverStatus: "online" });
        handleProcessData(
            ctx,
            "[12:00:05] [Server thread/INFO]: There are 0 of a max of 20 players online:\n",
        );
        expect(ctx.state.serverEntries).toEqual([]);
    });

    it("entity-data responses update nothing visible and never append", () => {
        const ctx = makeCtx({ serverStatus: "online" });
        handleProcessData(
            ctx,
            "[12:00:05] [Server thread/INFO]: Health on Steve after scale factor of 100.00 is 2000\n",
        );
        handleProcessData(
            ctx,
            "[12:00:05] [Server thread/INFO]: Steve has the following entity data: [12.5, 64.0, -3.0]\n",
        );
        expect(ctx.state.serverEntries).toEqual([]);
    });

    it("an unscaled data get is someone's own command and shows", () => {
        // the panel asks for stats with a scale; a bare reply was typed
        const ctx = makeCtx({ serverStatus: "online" });
        handleProcessData(
            ctx,
            "[12:00:05] [Server thread/INFO]: Steve has the following entity data: 20.0\n",
        );
        expect(ctx.state.serverEntries.length).toBe(1);
    });

    it("gamerule readouts converge state without appending", () => {
        const ctx = makeCtx({ serverStatus: "online" });
        handleProcessData(
            ctx,
            "[12:00:02] [Server thread/INFO]: Gamerule keep_inventory is currently set to: false\n",
        );
        expect(ctx.state.gamerules.keep_inventory).toBe("false");
        expect(ctx.state.serverEntries).toEqual([]);
    });

    it("join lines and real output still append", () => {
        const ctx = makeCtx({ serverStatus: "online" });
        handleProcessData(ctx, "[12:00:01] [Server thread/INFO]: Steve joined the game\n");
        handleProcessData(ctx, "[12:00:01] [Server thread/INFO]: Saving players\n");
        expect(ctx.state.serverEntries.length).toBe(2);
    });
});

describe("restart", () => {
    it("a restart starts a fresh instance after the stop half completes", async () => {
        const ctx = makeCtx({ serverStatus: "online", serverVersion: "1.21.1" });
        await restartServerInstance(ctx);
        expect(ctx.state.serverStatus).toBe("restarting");

        handleProcessExit(ctx);
        await new Promise((resolve) => setTimeout(resolve, 30));

        // the old bug set status to "starting" then called
        // startServerInstance, whose "offline"-only guard refused — so a
        // restart only ever stopped the server
        expect(starts.length).toBe(1);
        expect(ctx.state.serverStatus).toBe("starting");
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

describe("crashes", () => {
    const realWait = async (ms = 30) => { jest.useRealTimers(); await new Promise((resolve) => setTimeout(resolve, ms)); };
    const crashed = (ctx: any) => ctx.state.serverEntries.filter((e: any) => e.content.includes("crashed")).map((e: any) => e.content);
    beforeEach(async () => {
        // a fresh count and the defaults for every case
        await automation.writeAutomation(makeCtx(), { restartAfterCrash: true, dailyRestart: null }, async () => {});
        automation.cancelAutomation();
    });

    it("a server that crashes while running says so and starts again after a pause", async () => {
        jest.useFakeTimers();
        const ctx = makeCtx({ serverStatus: "online" });
        handleProcessExit(ctx, 137);
        expect(ctx.state.serverStatus).toBe("offline");
        expect(crashed(ctx)).toEqual(["[Server] The server crashed (exit code 137). Logs has what it printed."]);
        expect(ctx.triggers).toContainEqual({ id: "server-crashed", output: 137 });
        expect(starts).toEqual([]);
        jest.advanceTimersByTime(automation.CRASH_RESTART_DELAY_MS);
        await realWait();
        expect(starts.length).toBe(1);
        expect(ctx.state.serverStatus).toBe("starting");
        // the crash stays in the console, and the new run opens with why the server started again
        const lines = ctx.state.serverEntries.map((e: any) => e.content);
        const restarted = lines.findIndex((line: string) => /^\[Server\] Restarted after a crash at .+ \(exit code 137\)\.$/.test(line));
        expect(restarted).toBeGreaterThan(lines.indexOf("[Server] The server crashed (exit code 137). Logs has what it printed."));
        expect(lines.indexOf("[Server] The server crashed (exit code 137). Logs has what it printed.")).toBeGreaterThanOrEqual(0);
    });

    it("a server the system ended for memory is told as that, and still starts again", async () => {
        const ctx = makeCtx({ serverStatus: "offline" });
        await startServerInstance(ctx);
        ctx.setState({ serverStatus: "online" });
        oomKills = 1;
        jest.useFakeTimers();
        try {
            handleProcessExit(ctx, 137);
            const lines = ctx.state.serverEntries.map((e: any) => e.content);
            expect(lines).toContain("[Server] The computer ran out of memory, so the system ended the server (exit code 137). Give the server less memory or close other programs.");
            expect(crashed(ctx)).toEqual([]);
            expect(lines).toContain(`[Server] Restarting in ${automation.CRASH_RESTART_DELAY_MS / 1000} seconds.`);
        } finally {
            oomKills = 0;
            automation.cancelAutomation();
        }
    });

    it("a SIGKILL without the system's memory count going up is a plain crash", async () => {
        const ctx = makeCtx({ serverStatus: "offline" });
        await startServerInstance(ctx);
        ctx.setState({ serverStatus: "online" });
        jest.useFakeTimers();
        handleProcessExit(ctx, 137);
        automation.cancelAutomation();
        expect(crashed(ctx)).toEqual(["[Server] The server crashed (exit code 137). Logs has what it printed."]);
    });

    it("a Windows crash status is named in hex, as Windows names it", () => {
        jest.useFakeTimers();
        const ctx = makeCtx({ serverStatus: "online" });
        handleProcessExit(ctx, 0xc0000005);
        expect(crashed(ctx)).toEqual(["[Server] The server crashed (exit code 0xC0000005). Logs has what it printed."]);
        expect(ctx.triggers).toContainEqual({ id: "server-crashed", output: 0xc0000005 });
        automation.cancelAutomation();
        jest.useRealTimers();
    });

    it("stops asked for by Paperboard or from inside the game are not crashes", async () => {
        const asked = makeCtx({ serverStatus: "online" });
        await stopServerInstance(asked);
        handleProcessExit(asked, 143);
        const inGame = makeCtx({ serverStatus: "online" });
        handleProcessExit(inGame, 0);
        await realWait();
        for (const ctx of [asked, inGame]) {
            expect(crashed(ctx)).toEqual([]);
            expect(ctx.triggers.some((t: any) => t.id === "server-crashed")).toBe(false);
        }
        expect(starts).toEqual([]);
    });

    it("Minecraft's crash report makes a clean exit a crash", () => {
        jest.useFakeTimers();
        const ctx = makeCtx({ serverStatus: "online" });
        handleProcessData(ctx, "[12:00:00] [Server thread/ERROR]: This crash report has been saved to: /srv/crash-reports/crash.txt\n");
        handleProcessData(ctx, "[12:00:00] [Server thread/INFO]: Stopping server\n");
        handleProcessExit(ctx, 0);
        expect(crashed(ctx)).toEqual(["[Server] The server crashed (exit code 0). Logs has what it printed."]);
        automation.cancelAutomation();
        jest.useRealTimers();
    });

    it("a player typing the crash line in chat is not a crash", () => {
        const ctx = makeCtx({ serverStatus: "online" });
        handleProcessData(ctx, "[12:00:00] [Server thread/INFO]: <Steve> This crash report has been saved to: lol\n");
        handleProcessExit(ctx, 0);
        expect(crashed(ctx)).toEqual([]);
    });

    it("a crash while starting is reported and not restarted", async () => {
        jest.useFakeTimers();
        const ctx = makeCtx({ serverStatus: "starting" });
        handleProcessExit(ctx, 1);
        expect(crashed(ctx)).toEqual(["[Server] The server crashed while starting (exit code 1). Logs has what it printed."]);
        jest.advanceTimersByTime(automation.CRASH_RESTART_DELAY_MS * 2);
        await realWait();
        expect(starts).toEqual([]);
    });

    it("three crashes in ten minutes leave the server stopped", async () => {
        jest.useFakeTimers();
        const ctx = makeCtx({ serverStatus: "online" });
        const t0 = Date.now();
        for (const at of [t0, t0 + 60_000]) {
            ctx.setState({ serverStatus: "online" });
            automation.afterCrash(ctx, { whileStarting: false, exitCode: 1 }, async () => { starts.push("restart"); }, at);
            jest.advanceTimersByTime(automation.CRASH_RESTART_DELAY_MS);
            ctx.setState({ serverStatus: "offline" });
        }
        // the restart timer only starts an offline server, and both restarts ran
        expect(starts).toEqual([]);
        ctx.setState({ serverStatus: "offline" });
        automation.afterCrash(ctx, { whileStarting: false, exitCode: 1 }, async () => { starts.push("restart"); }, t0 + 120_000);
        jest.advanceTimersByTime(automation.CRASH_RESTART_DELAY_MS);
        jest.useRealTimers();
        expect(starts).toEqual([]);
        expect(ctx.state.serverEntries.at(-1).content).toBe("[Server] It crashed 3 times in 10 minutes, so it was not restarted. Start it once the cause is fixed.");
    });

    it("turned off, a crash is reported and the server stays stopped", async () => {
        await automation.writeAutomation(makeCtx(), { restartAfterCrash: false }, async () => {});
        expect((savedConfig as any).automation).toEqual({ restartAfterCrash: false, dailyRestart: null, autoUpdate: true });
        jest.useFakeTimers();
        const ctx = makeCtx({ serverStatus: "online" });
        handleProcessExit(ctx, 1);
        jest.advanceTimersByTime(automation.CRASH_RESTART_DELAY_MS * 2);
        await realWait();
        expect(crashed(ctx).length).toBe(1);
        expect(starts).toEqual([]);
    });
});

describe("daily restart", () => {
    it("takes whole hours only", () => {
        expect(() => automation.validateAutomation({ restartAfterCrash: true, dailyRestart: "04:30" })).toThrow(/whole hour/);
        expect(() => automation.validateAutomation({ restartAfterCrash: true, dailyRestart: "24:00" })).toThrow(/whole hour/);
        expect(() => automation.validateAutomation({ restartAfterCrash: "yes", dailyRestart: null, autoUpdate: true })).toThrow(/on or off/);
        expect(() => automation.validateAutomation({ restartAfterCrash: true, dailyRestart: null, autoUpdate: "yes" })).toThrow("Update automatically must be on or off");
        expect(automation.validateAutomation({ restartAfterCrash: true, dailyRestart: "04:00", autoUpdate: false })).toEqual({ restartAfterCrash: true, dailyRestart: "04:00", autoUpdate: false });
    });

    it("counts to the next time the hour comes round", () => {
        const now = new Date(2026, 10, 1, 3, 30);
        expect(automation.msUntilHour("04:00", now)).toBe(30 * 60_000);
        expect(automation.msUntilHour("03:00", now)).toBe(23.5 * 3_600_000);
    });

    it("warns the players, then restarts the running server", async () => {
        jest.useFakeTimers();
        const now = new Date();
        const hour = `${String((now.getHours() + 2) % 24).padStart(2, "0")}:00`;
        const due = automation.msUntilHour(hour, now);
        const restarts: string[] = [];
        const ctx = makeCtx({ serverStatus: "online", onlinePlayers: ["Steve"] });
        await automation.writeAutomation(ctx, { restartAfterCrash: true, dailyRestart: hour }, async () => { restarts.push("restart"); });
        automation.scheduleDailyRestart(ctx, async () => { restarts.push("restart"); }, now);
        jest.advanceTimersByTime(due - 5 * 60_000);
        await Promise.resolve();
        expect(writes.join("")).toContain("The server restarts in 5 minutes.");
        expect(writes.join("")).not.toContain("1 minute.");
        jest.advanceTimersByTime(4 * 60_000);
        await Promise.resolve();
        expect(writes.join("")).toContain("The server restarts in 1 minute.");
        expect(restarts).toEqual([]);
        jest.advanceTimersByTime(60_000);
        await Promise.resolve();
        expect(restarts).toEqual(["restart"]);
        automation.cancelAutomation();
        jest.useRealTimers();
    });
});

describe("automatic updates", () => {
    // the unscoped service is Minecraft's, which can't update itself; these give it a Steam-style update
    const service = gameServiceFor("minecraft") as any;
    const calls: string[] = [];
    let status: { installed: string; latest: string; updateAvailable: boolean } | Error;
    const canUpdate = () => {
        service.updateStatus = async () => { calls.push("check"); if (status instanceof Error) throw status; return status; };
        service.installUpdate = async () => { calls.push(`install, ${starts.length} starts`); };
    };
    const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
    beforeEach(async () => {
        calls.length = 0;
        status = { installed: "1", latest: "2", updateAvailable: true };
        await automation.writeAutomation(makeCtx(), { restartAfterCrash: true, dailyRestart: null, autoUpdate: true }, async () => {});
        automation.cancelAutomation();
    });
    afterAll(() => { delete service.updateStatus; delete service.installUpdate; });

    it("only a game that can update itself offers the setting", () => {
        delete service.updateStatus;
        delete service.installUpdate;
        expect(automation.automationView(automation.AUTOMATION_DEFAULTS).canUpdate).toBe(false);
        canUpdate();
        expect(automation.automationView(automation.AUTOMATION_DEFAULTS).canUpdate).toBe(true);
    });

    it("a start installs a newer build first and says so in the console", async () => {
        canUpdate();
        const ctx = makeCtx({ serverStatus: "offline" });
        await startServerInstance(ctx);
        expect(calls).toEqual(["check", "install, 0 starts"]);
        expect(starts.length).toBe(1);
        expect(ctx.state.serverEntries.slice(0, 2).map((e: any) => e.content)).toEqual(["[Server] Updating to build 2 before starting.", "[Server] Updated to build 2."]);
    });

    it("a start with nothing new, or with the setting off, installs nothing", async () => {
        canUpdate();
        status = { installed: "2", latest: "2", updateAvailable: false };
        await startServerInstance(makeCtx({ serverStatus: "offline" }));
        await automation.writeAutomation(makeCtx(), { autoUpdate: false }, async () => {});
        status = { installed: "1", latest: "2", updateAvailable: true };
        await startServerInstance(makeCtx({ serverStatus: "offline" }));
        expect(calls).toEqual(["check"]);
        expect(starts.length).toBe(2);
    });

    it("a check Steam can't answer is said, and the server starts as it is", async () => {
        canUpdate();
        status = new Error("SteamCMD exited with code 8");
        const ctx = makeCtx({ serverStatus: "offline" });
        await startServerInstance(ctx);
        expect(starts.length).toBe(1);
        expect(ctx.state.serverEntries[0]).toEqual({ type: "error", content: "[Server] Could not check for an update, so the server starts as it is: SteamCMD exited with code 8" });
    });

    it("a running server with players is warned, then restarts for an update", async () => {
        canUpdate();
        jest.useFakeTimers();
        const restarts: string[] = [];
        const ctx = makeCtx({ serverStatus: "online", onlinePlayers: ["Steve"] });
        automation.scheduleUpdateChecks(ctx, async () => { restarts.push("restart"); });
        jest.advanceTimersByTime(automation.UPDATE_CHECK_MS);
        await flush();
        expect(calls).toEqual(["check"]);
        expect(writes.join("")).toContain("An update is out. The server restarts to install it in 5 minutes.");
        expect(restarts).toEqual([]);
        jest.advanceTimersByTime(automation.UPDATE_WARNING_MS);
        await flush();
        expect(restarts).toEqual(["restart"]);
        automation.cancelAutomation();
        jest.useRealTimers();
    });

    it("an empty server restarts for an update at once, and a stopped one is left alone", async () => {
        canUpdate();
        jest.useFakeTimers();
        const restarts: string[] = [];
        const ctx = makeCtx({ serverStatus: "offline" });
        automation.scheduleUpdateChecks(ctx, async () => { restarts.push("restart"); });
        jest.advanceTimersByTime(automation.UPDATE_CHECK_MS);
        await flush();
        expect(calls).toEqual([]);
        ctx.setState({ serverStatus: "online" });
        jest.advanceTimersByTime(automation.UPDATE_CHECK_MS);
        await flush();
        expect(restarts).toEqual(["restart"]);
        expect(writes.join("")).not.toContain("An update is out");
        automation.cancelAutomation();
        jest.useRealTimers();
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

    it("pre-1.21.11 writes the camelCase name the server speaks", () => {
        const ctx = makeCtx({ serverStatus: "online", serverVersion: "1.21.10" });
        expect(setGamerule(ctx, "keep_inventory", "true")).toBe(true);
        expect(writes).toEqual(["gamerule keepInventory true\n"]);
        // the UI still stores the canonical id
        expect(ctx.state.gamerules.keep_inventory).toBe("true");
    });

    it("pre-1.21.11 inverts disable* rules on write", () => {
        const ctx = makeCtx({ serverStatus: "online", serverVersion: "1.21.10" });
        expect(setGamerule(ctx, "raids", "false")).toBe(true);
        expect(writes).toEqual(["gamerule disableRaids true\n"]);
    });

    it("pre-1.21.11 readouts are canonicalized and un-inverted", () => {
        const ctx = makeCtx({ serverStatus: "online", serverVersion: "1.21.10" });
        handleProcessData(
            ctx,
            "[12:00:02] [Server thread/INFO]: Gamerule keepInventory is currently set to: true\n",
        );
        expect(ctx.state.gamerules.keep_inventory).toBe("true");

        handleProcessData(
            ctx,
            "[12:00:03] [Server thread/INFO]: Gamerule disableRaids is currently set to: true\n",
        );
        expect(ctx.state.gamerules.raids).toBe("false");
    });
});

describe("a start keeps what the last run said", () => {
    it("the console and chat from before the start stay above the new run", async () => {
        const chat = { id: "chat-1", text: "<Hyper> where are my villagers", timestamp: "05:11:02", sender: "Hyper", content: "where are my villagers" };
        const ctx = makeCtx({
            serverStatus: "offline",
            serverEntries: [{ type: "output", content: "Villager was slain by Zombie" }, { type: "warn", content: "[Server] Process stopped." }],
            chatMessages: [chat],
        });
        await startServerInstance(ctx);
        expect(ctx.state.serverStatus).toBe("starting");
        expect(ctx.state.serverEntries.slice(0, 2).map((e: any) => e.content)).toEqual(["Villager was slain by Zombie", "[Server] Process stopped."]);
        expect(ctx.state.serverEntries.length).toBeGreaterThan(2);
        expect(ctx.state.chatMessages).toEqual([chat]);
    });
});
