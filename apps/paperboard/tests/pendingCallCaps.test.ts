// Outstanding-call caps and the rpc timeout clamp (bun test) — T1.
// The 1000-cap refusal must be typed (code travels on the error, never in
// the message), mirror the client's PaperAPI MAX_PENDING_CALLS = 1000, and
// be refused BEFORE the call is queued.
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { ActionsRegistry, actionsRegistry, MAX_PENDING_CALLS, MAX_PENDING_CALLS_PER_SOCKET } from "../papercrane/actions";
import { handleActions, assertCallTimeout } from "../papercrane/rpc/actions";

function fakeWs(ok = true) {
    return {
        readyState: ok ? 1 : 2, // 1 = OPEN
        send: (text: string) => {
            sendLogs.push(text);
        },
    } as any;
}

let sendLogs: string[] = [];
let replyLogs: { result: any; error?: string; code?: string }[] = [];

function makeRegistry(callerWs: any) {
    const reg = new ActionsRegistry();
    const handlerWs = fakeWs();
    const r = reg.register("target", "ping", handlerWs);
    if (!r.ok) throw new Error("setup: registration refused");
    // the target answers every action_call immediately
    const origSend = handlerWs.send;
    handlerWs.send = (text: string) => {
        origSend(text);
        const msg = JSON.parse(text) as { callId: string };
        reg.handleReply(msg.callId, { pong: true }, undefined, handlerWs);
    };
    return { reg, handlerWs, callerWs };
}

beforeEach(() => {
    sendLogs = [];
    replyLogs = [];
    replyLogs = [];
});

afterEach(() => {
    sendLogs = sendLogs.slice(0, 0);
});

describe("pendingCalls are bounded server-side", () => {
    it("slot 1001 is refused with a typed error naming the cap", async () => {
        const callerWs = fakeWs();
        // outstanding calls: the target never replies, so all 1000 slots
        // stay occupied until the teardown below
        const reg = new ActionsRegistry();
        reg.register("target", "ping", fakeWs());
        for (let i = 0; i < MAX_PENDING_CALLS_PER_SOCKET; i++) {
            reg.call("target", "ping", [], callerWs, 60_000).catch(() => undefined);
        }
        expect(sendLogs.length).toBe(MAX_PENDING_CALLS_PER_SOCKET);
        let thrown: unknown = null;
        try {
            await reg.call("target", "ping", [], callerWs, 5000);
        } catch (err) {
            thrown = err;
        }
        expect((thrown as Error)?.name).toBe("RpcError");
        expect((thrown as any)?.code).toBe("FORBIDDEN");
        expect(String((thrown as Error)?.message)).toMatch(/cap 1000/);
        // the refused call queued nothing
        expect(sendLogs.length).toBe(MAX_PENDING_CALLS_PER_SOCKET);
        reg.handleSocketClose(callerWs);
    });

    it("teardown on socket close releases the pending-call slots", async () => {
        const callerWs = fakeWs();
        const reg = new ActionsRegistry();
        reg.register("target", "slow", fakeWs());
        const first = reg.call("target", "slow", [], callerWs, 60_000);
        expect(sendLogs.length).toBe(1);
        // a runaway socket that disconnects cannot hold its slots forever
        reg.handleSocketClose(callerWs);
        await first.then(
            () => {
                throw new Error("expected rejection");
            },
            () => undefined,
        );
        // slots freed: a fresh caller is accepted again (not refused with
        // the cap error). The fresh call is settled via the same close
        // path, then we inspect its rejection: a cap-filled refusal here
        // would mean the slot was never released.
        const fresh = fakeWs();
        const freshCall = reg.call("target", "slow", [], fresh, 60_000);
        reg.handleSocketClose(fresh);
        let second: unknown = null;
        await freshCall.then(undefined, (err: unknown) => {
            second = err;
        });
        if ((second as any)?.message?.match(/outstanding action calls/)) {
            throw new Error("slot not released after socket close");
        }
    });

    it("a second socket's calls are capped per-connection, not just globally", async () => {
        const reg = new ActionsRegistry();
        reg.register("target", "ping", fakeWs());
        const a = fakeWs();
        const b = fakeWs();
        // both sockets fill their own windows
        for (let i = 0; i < MAX_PENDING_CALLS_PER_SOCKET; i++) {
            reg.call("target", "ping", [], a, 60_000).catch(() => undefined);
            reg.call("target", "ping", [], b, 60_000).catch(() => undefined);
        }
        expect(sendLogs.length).toBe(2 * MAX_PENDING_CALLS_PER_SOCKET);
        for (const ws of [a, b]) {
            let thrown: unknown = null;
            try {
                await reg.call("target", "ping", [], ws, 60_000);
            } catch (err) {
                thrown = err;
            }
            expect((thrown as any)?.code).toBe("FORBIDDEN");
        }
        reg.handleSocketClose(a);
        reg.handleSocketClose(b);
    });

    it("rpc actions:call maps the refusal code onto the wire", async () => {
        const reg = actionsRegistry;
        reg.register("cap-target", "ping", fakeWs()); // never answers
        const callerWs = fakeWs();
        const ctx = {
            ws: callerWs,
            callerPanelId: () => null,
            reply: (_id: unknown, result: any, error?: string, code?: string) =>
                replyLogs.push({ result, error, code }),
            broadcastEvent: () => undefined,
        };
        // fill the caller's window with outstanding calls
        for (let i = 0; i < MAX_PENDING_CALLS_PER_SOCKET; i++) {
            reg.call("cap-target", "ping", [], callerWs, 60_000).catch(() => undefined);
        }
        await handleActions("actions:call", 1, { panelId: "cap-target", action: "ping", timeoutMs: 1000 }, ctx as any);
        expect(replyLogs.length).toBe(1);
        expect(replyLogs[0].code).toBe("FORBIDDEN");
        expect(replyLogs[0].error).toMatch(/cap 1000/);
        reg.handleSocketClose(callerWs);
        reg.unregister("cap-target", "ping");
    });
});

describe("rpc timeout clamp", () => {
    it("timeoutMs above the 60s cap is refused INVALID_PARAMS and never reaches the registry", async () => {
        const reg = actionsRegistry;
        reg.register("clamp-target", "ping", fakeWs());
        let called = 0;
        const origCall = reg.call.bind(reg);
        (reg as any).call = (...args: any[]) => {
            called++;
            return origCall(...args);
        };
        const ctx = {
            ws: fakeWs(),
            callerPanelId: () => null,
            reply: (_id: unknown, result: any, error?: string, code?: string) =>
                replyLogs.push({ result, error, code }),
            broadcastEvent: () => undefined,
        };
        let thrown: unknown = null;
        try {
            await handleActions("actions:call", 1, { panelId: "clamp-target", action: "ping", timeoutMs: 61_000 }, ctx as any);
        } catch (err) {
            thrown = err;
        }
        // refusal is typed, thrown to the WS dispatcher
        expect(thrown).toBeInstanceOf(Error);
        expect((thrown as any)?.name).toBe("InvalidParamsError");
        expect(String((thrown as Error)?.message)).toMatch(/60\s?000 ms cap/);
        // the registry was never invoked with an oversized timeout
        expect(called).toBe(0);
        // a timeout at the cap passes through to the registry (the call is
        // queued against a never-replying target, so it settles when we
        // close its caller socket below — handleActions awaits the call)
        const atCap = handleActions("actions:call", 2, { panelId: "clamp-target", action: "ping", timeoutMs: 60_000 }, ctx as any).catch(() => undefined);
        expect(called).toBe(1);
        reg.handleSocketClose((ctx as any).ws);
        await atCap;
        reg.unregister("clamp-target", "ping");
    });
});

describe("explicit no-timeout action calls", () => {
    it("assertCallTimeout: null opts out, undefined falls back, numeric is capped", () => {
        expect(assertCallTimeout(null, "timeoutMs", 30_000)).toBeNull();
        expect(assertCallTimeout(undefined, "timeoutMs", 30_000)).toBe(30_000);
        expect(assertCallTimeout(45_000, "timeoutMs", 30_000)).toBe(45_000);
        expect(() => assertCallTimeout(60_001, "timeoutMs", 30_000)).toThrow(/cap/);
    });

    it("a null-timeout call waits for the reply instead of timing out", async () => {
        const reg = new ActionsRegistry();
        const handlerWs = fakeWs();
        reg.register("target", "slow", handlerWs);
        const callerWs = fakeWs();
        let settled: unknown = "pending";
        const p = reg.call("target", "slow", [], callerWs, null).then(
            (r) => {
                settled = r;
            },
            (e) => {
                settled = e;
            },
        );
        // no timer is armed, so nothing settles the call on its own
        await new Promise((r) => setTimeout(r, 20));
        expect(settled).toBe("pending");
        // the target's reply is what settles it
        const callId = (JSON.parse(sendLogs[0]) as { callId: string }).callId;
        reg.handleReply(callId, { done: true }, undefined, handlerWs);
        await p;
        expect(settled).toEqual({ done: true });
    });

    it("handleActions forwards an explicit null to the registry, not the 30s default", async () => {
        const reg = actionsRegistry;
        reg.register("null-target", "ping", fakeWs());
        let seen: number | null | undefined;
        // call the prototype method directly: an earlier test may have left
        // its own spy on the shared singleton
        const realCall = ActionsRegistry.prototype.call;
        (reg as any).call = (...args: any[]) => {
            seen = args[4];
            return realCall.apply(reg, args);
        };
        const ctx = {
            ws: fakeWs(),
            callerPanelId: () => null,
            reply: () => undefined,
            broadcastEvent: () => undefined,
        };
        const call = handleActions("actions:call", 1, { panelId: "null-target", action: "ping", timeoutMs: null }, ctx as any).catch(() => undefined);
        expect(seen).toBeNull();
        reg.handleSocketClose((ctx as any).ws);
        await call;
        delete (reg as any).call;
        reg.unregister("null-target", "ping");
    });
});
