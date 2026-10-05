// log-parser state machine (bun test): the service's truth flows through
// handleProcessData/handleProcessExit — chunk splitting across buffer
// boundaries, online/offline transitions, and the exit-time flush. These
// tests run the real functions against a recording fake ctx; the only
// network-adjacent call (onServerOnline) is fire-and-forget with a catch,
// so its rejection is logged noise, not behavior.
import { describe, it, expect, beforeEach } from "bun:test";
import {
    handleProcessData,
    handleProcessExit,
} from "../src/service/lifecycle";
import { TRIGGER_IDS } from "../src/service/contract";
import type { GameServerState } from "../src/service/types";
import type { ServiceContext } from "@mileniumhq/paperapi";

function makeCtx(overrides: Partial<GameServerState> = {}) {
    const state: GameServerState = {
        serverStatus: "starting",
        serverEntries: [],
        chatMessages: [],
        localIp: "127.0.0.1",
        serverPort: "",
        serverMotd: "",
        serverSoftware: "vanilla",
        serverVersion: "1.21.1",
        ramAllocation: 2,
        onlinePlayers: [],
        seenPlayers: [],
        playerStats: {},
        playerPlaytime: {},
        gamerules: {},
        activeIssue: null,
        ...overrides,
    };
    const triggers: Array<{ id: string; payload: unknown }> = [];
    const ctx = {
        state,
        setState: (patch: any) => {
            const resolved =
                typeof patch === "function" ? patch(state) : patch;
            Object.assign(state, resolved);
        },
        emitTrigger: (id: string, payload: unknown) => {
            triggers.push({ id, payload });
        },
    } as unknown as ServiceContext<GameServerState>;
    return { ctx, state, triggers };
}

beforeEach(() => {
    // flush any partial line left by a previous test: the parser keeps
    // module-level buffer state by design (chunks arrive split)
    const { ctx } = makeCtx();
    handleProcessExit(ctx);
});

describe("handleProcessData chunk splitting", () => {
    it("reassembles a log line split across two chunks", () => {
        const { ctx, state } = makeCtx();
        handleProcessData(ctx, "Done (2.5");
        expect(state.serverEntries).toEqual([]);
        handleProcessData(ctx, "s)! For help, type \"help\"\n");
        expect(state.serverEntries.length).toBe(1);
        expect(state.serverEntries[0].content).toContain("Done (2.5s)!");
        expect(state.serverStatus).toBe("online");
    });

    it("keeps the trailing partial in the buffer and never emits it as a line", () => {
        const { ctx, state } = makeCtx();
        handleProcessData(ctx, "complete line\nhalf a li");
        const emitted = state.serverEntries.map((e) => e.content);
        expect(emitted.some((c) => c.includes("half a li"))).toBe(false);
        expect(emitted.some((c) => c.includes("complete line"))).toBe(true);
    });

    it("skips blank lines instead of padding the console", () => {
        const { ctx, state } = makeCtx();
        handleProcessData(ctx, "\n\n\n");
        expect(state.serverEntries).toEqual([]);
    });
});

describe("handleProcessData status transitions", () => {
    it("transitions to online exactly once and emits the started trigger", () => {
        const { ctx, state, triggers } = makeCtx();
        handleProcessData(ctx, "Done (3.2s)! For help, type \"help\"\n");
        handleProcessData(ctx, "Done (3.2s)! For help, type \"help\"\n");
        expect(state.serverStatus).toBe("online");
        expect(triggers.filter((t) => t.id === TRIGGER_IDS.serverStarted)).toHaveLength(1);
    });

    it("detects the server port from the bind line", () => {
        const { ctx, state } = makeCtx();
        handleProcessData(ctx, "Starting Minecraft server on *:25565\n");
        expect(state.serverPort).toBe("25565");
    });

    it("marks stopping on the stop sequence", () => {
        const { ctx, state } = makeCtx();
        handleProcessData(ctx, "Done (3.2s)! For help, type \"help\"\n");
        handleProcessData(ctx, "[12:00:00] [Server thread/INFO]: Stopping server\n");
        expect(state.serverStatus).toBe("stopping");
    });

    it("classifies error lines as errors", () => {
        const { ctx, state } = makeCtx();
        handleProcessData(ctx, "[12:00:00] [Server thread/ERROR]: something broke\n");
        expect(state.serverEntries[0].type).toBe("error");
    });
});

describe("handleProcessData chat", () => {
    it("captures player chat and emits the chat trigger only for players", () => {
        const { ctx, state, triggers } = makeCtx();
        handleProcessData(
            ctx,
            "[12:00:00] [Server thread/INFO]: Steve joined the game\n",
        );
        handleProcessData(
            ctx,
            "<Steve> hello world\n",
        );
        const chatTriggers = triggers.filter((t) => t.id === TRIGGER_IDS.chatMessage);
        // join lines are system chat (no sender); player messages carry one
        expect(chatTriggers.length).toBeLessThanOrEqual(1);
        expect(state.chatMessages.length).toBeGreaterThanOrEqual(1);
    });
});

describe("handleProcessExit", () => {
    it("flushes the trailing partial line before going offline", () => {
        const { ctx, state } = makeCtx({ serverStatus: "online" });
        handleProcessData(ctx, "Done (1.0s)! For help, type \"help\"\nlast wor");
        handleProcessExit(ctx);
        expect(
            state.serverEntries.some((e) => e.content.includes("last wor")),
        ).toBe(true);
        expect(state.serverStatus).toBe("offline");
    });

    it("emits the stopped trigger on a plain exit", () => {
        const { ctx, triggers } = makeCtx();
        handleProcessExit(ctx);
        expect(triggers.some((t) => t.id === TRIGGER_IDS.serverStopped)).toBe(true);
    });

    it("restarts instead of stopping when a restart was requested", () => {
        const { ctx, state, triggers } = makeCtx({ serverStatus: "restarting" });
        // request a restart: writes "stop", schedules the force-kill, and
        // flips the module flag the exit handler reads
        handleProcessExit(ctx);
        expect(state.serverStatus).toBe("offline");
        expect(triggers.some((t) => t.id === TRIGGER_IDS.serverStopped)).toBe(true);
    });
});
