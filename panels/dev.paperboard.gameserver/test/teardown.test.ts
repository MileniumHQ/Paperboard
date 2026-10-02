// teardown bounds (bun test): player tracking state stays capped
import { describe, it, expect } from "bun:test";
import { trackPlayerActivity, __playersTest } from "../src/service/players";
import { MAX_BUFFERED_ENTRIES } from "../src/service/types";

function makeCtx(seen: string[] = []) {
    let state: any = {
        seenPlayers: seen,
        onlinePlayers: [],
        playerPlaytime: {},
        playerStats: {},
        serverStatus: "online",
    };
    return {
        get state() {
            return state;
        },
        setState: (patch: any) => {
            state = {
                ...state,
                ...(typeof patch === "function" ? patch(state) : patch),
            };
        },
        emitTrigger: () => {},
    } as any;
}

describe("player tracking stays bounded", () => {
    it("lastJoinAt evicts oldest instead of growing forever", () => {
        __playersTest.clearJoins();
        const ctx = makeCtx();
        const total = MAX_BUFFERED_ENTRIES + 5;
        for (let i = 0; i < total; i++) {
            const ss = String(i % 60).padStart(2, "0");
            const mm = String(Math.floor(i / 60) % 60).padStart(2, "0");
            trackPlayerActivity(ctx, `[12:${mm}:${ss}] User${i} joined the game`);
        }
        expect(__playersTest.lastJoinSize()).toBe(MAX_BUFFERED_ENTRIES);
        __playersTest.clearJoins();
    });

    it("seenPlayers is capped at the buffer bound", () => {
        __playersTest.clearJoins();
        const ctx = makeCtx();
        const total = MAX_BUFFERED_ENTRIES + 5;
        for (let i = 0; i < total; i++) {
            const ss = String(i % 60).padStart(2, "0");
            const mm = String(Math.floor(i / 60) % 60).padStart(2, "0");
            trackPlayerActivity(ctx, `[12:${mm}:${ss}] Guest${i} joined the game`);
        }
        expect(ctx.state.seenPlayers.length).toBe(MAX_BUFFERED_ENTRIES);
        __playersTest.clearJoins();
    });
});
