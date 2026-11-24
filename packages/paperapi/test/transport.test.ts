import { afterEach, beforeEach, describe, expect, jest, setDefaultTimeout, test } from "bun:test";
import { blocksApi } from "../src/blocks";
import { closeTransport, getTransport, initPaperApi, invoke, on } from "../src/ipc";
import { processApi } from "../src/process";
import { CraneTransport } from "../src/ws";
import { startWireServer, type Frame, type WireServer } from "./helpers/wire";

setDefaultTimeout(30_000);

let server: WireServer;
const transports: CraneTransport[] = [];

function transport(opts: { computerId?: string; panelId?: string } = {}): CraneTransport {
    const t = new CraneTransport({ port: server.port, token: server.token, ...opts });
    transports.push(t);
    return t;
}

beforeEach(async () => {
    server = await startWireServer();
});

afterEach(async () => {
    for (const t of transports.splice(0)) t.close();
    closeTransport();
    await server.close();
});

// a connection's frames, in order
const on_ = (conn: number) => (f: Frame) => f.conn === conn;
const isAction = (action: string, conn?: number) => (f: Frame) => f.msg?.action === action && (conn === undefined || f.conn === conn);

function deferred<T = unknown>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((r) => {
        resolve = r;
    });
    return { promise, resolve };
}

// settles a promise into a readable state, for checking that it has not settled
function track<T>(promise: Promise<T>) {
    const state = { settled: false, value: undefined as T | undefined, error: undefined as Error | undefined };
    promise.then(
        (value) => {
            state.settled = true;
            state.value = value;
        },
        (error: Error) => {
            state.settled = true;
            state.error = error;
        },
    );
    return state;
}

// lets every already-queued promise reaction run
async function flushMicrotasks(): Promise<void> {
    for (let i = 0; i < 50; i++) await Promise.resolve();
}

// Handlers are owned by the panel that registers them.
describe("handlers are owned by the panel that registers them", () => {
    const pingSchema = { kind: "command", id: "ping", name: "Ping" } as const;
    test("the same block name under two panels dispatches by panelId:entry and removing one leaves the other", async () => {
        const t = transport({ panelId: "dev.ambient" });
        await t.registerBlocks("dev.a", [{ entry: "command.ping", handler: () => "from a", schema: pingSchema }]);
        await t.registerBlocks("dev.b", [{ entry: "command.ping", handler: () => "from b", schema: pingSchema }]);
        const reply = async (callId: string, panelId: string | undefined, action: string) => {
            server.sendRaw({ type: "action_call", registry: "blocks", callId, panelId, action, args: [] });
            return (await server.next(`the reply to ${callId}`, (f) => f.msg?.type === "action_reply" && f.msg.callId === callId)).msg;
        };
        expect(await reply("1", "dev.a", "command.ping")).toEqual({ type: "action_reply", callId: "1", result: "from a" });
        expect(await reply("2", "dev.b", "command.ping")).toEqual({ type: "action_reply", callId: "2", result: "from b" });
        // a bare name or the ambient panel owns nothing
        expect((await reply("3", undefined, "command.ping")).error).toBe("Handler for action 'command.ping' not found");
        expect((await reply("4", "dev.ambient", "command.ping")).error).toBe("Handler for action 'command.ping' not found");

        await t.unregisterBlock("dev.a", "command.ping");
        expect((await reply("5", "dev.a", "command.ping")).error).toBe("Handler for action 'command.ping' not found");
        expect(await reply("6", "dev.b", "command.ping")).toEqual({ type: "action_reply", callId: "6", result: "from b" });
    });

    test("a reply that finishes after the connection closed is reported loudly, never thrown into the service", async () => {
        const t = transport({ panelId: "dev.ambient" });
        const entered = { ok: deferred(), fail: deferred() };
        const finish = { ok: deferred<string>(), fail: deferred<void>() };
        await t.registerBlocks("dev.a", [
            {
                entry: "command.slow",
                handler: () => {
                    entered.ok.resolve(undefined);
                    return finish.ok.promise;
                },
                schema: { kind: "command", id: "slow", name: "Slow" },
            },
            {
                entry: "command.doomed",
                handler: async () => {
                    entered.fail.resolve(undefined);
                    await finish.fail.promise;
                    throw new Error("boom");
                },
                schema: { kind: "command", id: "doomed", name: "Doomed" },
            },
        ]);
        server.sendRaw({ type: "action_call", registry: "blocks", callId: "late-ok", panelId: "dev.a", action: "command.slow", args: [] });
        server.sendRaw({ type: "action_call", registry: "blocks", callId: "late-fail", panelId: "dev.a", action: "command.doomed", args: [] });
        await Promise.all([entered.ok.promise, entered.fail.promise]);

        const unhandled: unknown[] = [];
        const onUnhandled = (reason: unknown) => unhandled.push(reason);
        process.on("unhandledRejection", onUnhandled);
        const lines: string[] = [];
        const consoleError = console.error;
        console.error = (...args: unknown[]) => void lines.push(args.map(String).join(" "));
        try {
            t.close();
            finish.ok.resolve("too late");
            finish.fail.resolve();
            await flushMicrotasks();
            // one macrotask turn: where an unhandled rejection is reported
            await new Promise((r) => setImmediate(r));
            expect(unhandled).toEqual([]);
            expect(lines.some((l) => l.includes("reply to dev.a:command.slow (call late-ok) was not delivered") && l.includes("connection closed"))).toBe(true);
            expect(lines.some((l) => l.includes("reply to dev.a:command.doomed (call late-fail) was not delivered") && l.includes("connection closed"))).toBe(true);
        } finally {
            console.error = consoleError;
            process.off("unhandledRejection", onUnhandled);
        }
    });
});

// Reconnect replays registrations faithfully.
describe("reconnect replays registrations faithfully", () => {
    test("every registration is re-sent once under its own panel and schema, projects before their blocks", async () => {
        const t = transport({ panelId: "dev.ambient" });
        const startSchema = { kind: "command", id: "start", name: "Start", description: "Starts it" } as const;
        const stopSchema = { kind: "command", id: "stop", name: "Stop" } as const;
        await t.registerBlocks("dev.a", [{ entry: "command.start", handler: () => null, schema: startSchema }]);
        await t.registerBlocks("dev.b", [{ entry: "command.stop", handler: () => null, schema: stopSchema }]);
        await t.defineBlocksProject("dev.a", { id: "server1", name: "Server 1" });
        await t.defineBlocksProject("dev.a", { id: "server10", name: "Server 10", icon: "dns" });
        await t.registerBlocks("dev.a", [{ entry: "server1/command.start", handler: () => null, schema: startSchema }]);
        await t.registerBlocks("dev.a", [{ entry: "server10/command.start", handler: () => null, schema: startSchema }]);

        await server.dropConnections();
        await server.next("the replayed dev.b set", (f) => f.conn === 1 && f.msg?.action === "blocks:register-set" && f.msg.params.panelId === "dev.b");
        await server.next("the replayed dev.a set", (f) => f.conn === 1 && f.msg?.action === "blocks:register-set" && f.msg.params.panelId === "dev.a");
        const replay = server.frames.filter(on_(1));
        // one set per panel, each block once with its own schema
        const sets = replay.filter(isAction("blocks:register-set")).map((f) => ({ panelId: f.msg.params.panelId, entries: f.msg.params.entries }));
        expect(sets.sort((a, b) => (a.panelId < b.panelId ? -1 : 1))).toEqual([
            {
                panelId: "dev.a",
                entries: [
                    { entry: "command.start", schema: startSchema },
                    { entry: "server1/command.start", schema: startSchema },
                    { entry: "server10/command.start", schema: startSchema },
                ],
            },
            { panelId: "dev.b", entries: [{ entry: "command.stop", schema: stopSchema }] },
        ]);
        expect(replay.filter(isAction("blocks:register"))).toEqual([]);
        const defines = replay.filter(isAction("blocks:project-define")).map((f) => f.msg.params);
        expect(defines.map((p) => ({ panelId: p.panelId, project: p.project, name: p.name, icon: p.icon }))).toEqual([
            { panelId: "dev.a", project: "server1", name: "Server 1", icon: undefined },
            { panelId: "dev.a", project: "server10", name: "Server 10", icon: "dns" },
        ]);
        const lastDefine = Math.max(...replay.map((f, i) => (f.msg?.action === "blocks:project-define" ? i : -1)));
        const firstRegister = replay.findIndex((f) => f.msg?.action === "blocks:register-set");
        expect(lastDefine).toBeLessThan(firstRegister);

        // removing server1 forgets only its own blocks, never server10's
        await t.removeBlocksProject("dev.a", "server1");
        await server.dropConnections();
        await server.next("the second replay's dev.a set", (f) => f.conn === 2 && f.msg?.action === "blocks:register-set" && f.msg.params.panelId === "dev.a");
        await server.next("the second replay's dev.b set", (f) => f.conn === 2 && f.msg?.action === "blocks:register-set" && f.msg.params.panelId === "dev.b");
        const second = server.frames.filter((f) => f.conn === 2 && f.msg?.action === "blocks:register-set").flatMap((f) => f.msg.params.entries.map((e: { entry: string }) => e.entry));
        expect(second.sort()).toEqual(["command.start", "command.stop", "server10/command.start"]);
        expect(server.frames.filter((f) => f.conn === 2 && f.msg?.action === "blocks:project-define").map((f) => f.msg.params.project)).toEqual(["server10"]);
    });
});

// Remote-computer traffic never leaks outside its tunnel.
describe("remote-computer traffic never leaks outside its tunnel", () => {
    const plainRequests = (conn?: number) =>
        server.frames.filter((f) => f.tunnel === null && f.msg?.action && f.msg.action !== "auth:verify" && (conn === undefined || f.conn === conn));

    test("every request rides the tunnel envelope, without this computer's token", async () => {
        server.answer = (action) => (action === "file:read" ? { content: "remote" } : {});
        const t = transport({ computerId: "remote-1" });
        expect(await t.call("file:read", { targetPath: "a.txt", appId: "dev.a" })).toEqual({ content: "remote" });
        const open = await server.next("remote:open", (f) => f.msg?.type === "remote:open");
        expect(open.msg.computerId).toBe("remote-1");
        const read = await server.next("file:read", isAction("file:read"));
        expect(read.tunnel).toBe(open.msg.id);
        expect(read.msg.params.token).toBeUndefined();
        expect(read.msg.params.targetPath).toBe("a.txt");
        expect(plainRequests()).toEqual([]);
    });

    test("a closed or refused tunnel sends no plain frame, and later calls wait for a new tunnel", async () => {
        const t = transport({ computerId: "remote-1" });
        await t.call("term:write", { id: "ping", data: "" });
        const firstTunnel = (await server.next("the first tunnel", (f) => f.msg?.type === "remote:open")).msg.id;

        server.refuseTunnels = true;
        server.closeTunnel();
        // the transport tries to reopen at once and is refused
        await server.next("the reopen attempt", (f) => f.msg?.type === "remote:open" && f.msg.id !== firstTunnel);
        const refused = await t.call("file:read", { targetPath: "x" }).then(
            () => null,
            (err: Error) => err,
        );
        expect(refused?.message).toBe("Remote tunnel failed: refused by test");
        expect(plainRequests()).toEqual([]);

        server.refuseTunnels = false;
        server.answer = (action) => (action === "file:read" ? { content: null } : {});
        expect(await t.call("file:read", { targetPath: "y" })).toEqual({ content: null });
        const read = await server.next("file:read inside the new tunnel", (f) => f.msg?.action === "file:read");
        expect(read.tunnel).not.toBeNull();
        expect(read.tunnel).not.toBe(firstTunnel);
        expect(plainRequests()).toEqual([]);
    });

    test("a tunnel that closes and can't reopen is reported, then reopens and replays attaches on its own", async () => {
        const t = transport({ computerId: "remote-1" });
        await t.call("term:write", { id: "ping", data: "" });
        t.trackProcess("proc-1");
        const firstTunnel = (await server.next("the first tunnel", (f) => f.msg?.type === "remote:open")).msg.id;
        const heard = (what: string, match: (s: { connected: boolean; error?: string }) => boolean) =>
            new Promise<void>((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error(`no status ${what}`)), 10_000);
                t.onStatus((s) => {
                    if (!match(s)) return;
                    clearTimeout(timer);
                    resolve();
                });
            });
        const lines: string[] = [];
        const consoleError = console.error;
        console.error = (...args: unknown[]) => void lines.push(args.map(String).join(" "));
        try {
            const refused = heard("naming the refusal", (s) => !s.connected && s.error === "Remote tunnel failed: refused by test");
            server.refuseTunnels = true;
            server.closeTunnel();
            await refused;
            expect(lines.some((l) => l.includes("reconnect to remote-1 failed") && l.includes("refused by test"))).toBe(true);

            // nothing calls the transport: it retries by itself
            const back = heard("connected again", (s) => s.connected);
            server.refuseTunnels = false;
            await back;
        } finally {
            console.error = consoleError;
        }
        const attach = await server.next("the replayed attach", (f) => f.msg?.action === "process:attach" && f.tunnel !== firstTunnel);
        expect(attach.tunnel).not.toBeNull();
        expect(attach.msg.params.id).toBe("proc-1");
        expect(t.isConnected()).toBe(true);
    });

    test("after a socket drop it reconnects, reopens the tunnel and replays terminal attaches through it", async () => {
        const t = transport({ computerId: "remote-1" });
        await t.call("term:write", { id: "ping", data: "" });
        t.trackTerminal("term-1");
        await server.dropConnections();
        const reopened = await server.next("the tunnel on the new socket", (f) => f.conn === 1 && f.msg?.type === "remote:open");
        const attach = await server.next("the replayed attach", (f) => f.conn === 1 && f.msg?.action === "term:attach");
        expect(attach.tunnel).toBe(reopened.msg.id);
        expect(attach.msg.params.id).toBe("term-1");
        expect(plainRequests()).toEqual([]);
    });
});

// Subscriptions and stream attaches survive reconnect and teardown.
describe("subscriptions and stream attaches survive reconnect and teardown", () => {
    test("the full listener set is announced on connect and again after a reconnect", async () => {
        const t = transport();
        t.subscribeEvent("alpha", () => {});
        t.subscribeEvent("beta", () => {});
        await t.ensureConnected();
        const first = await server.next("the first announcement", isAction("events:subscribe", 0));
        expect(first.msg.params.events.sort()).toEqual(["alpha", "beta"]);
        await server.dropConnections();
        const again = await server.next("the announcement after reconnect", isAction("events:subscribe", 1));
        expect(again.msg.params.events.sort()).toEqual(["alpha", "beta"]);
    });

    test("a refused announcement is sent again on the same connection until the daemon takes it", async () => {
        const t = transport();
        let refusals = 1;
        server.answer = (action) => {
            if (action === "events:subscribe" && refusals-- > 0) throw new Error("the daemon is busy");
            return {};
        };
        t.subscribeEvent("alpha", () => {});
        await t.ensureConnected();
        await expect(t.subscriptionsSettled()).rejects.toThrow("the daemon is busy");
        const again = await server.next("the announcement sent again", (f) => isAction("events:subscribe", 0)(f) && server.requests("events:subscribe").indexOf(f) === 1);
        expect(again.msg.params.events).toEqual(["alpha"]);
        await t.subscriptionsSettled();
        expect(server.connections()).toBe(1);
    });

    test("subscribers to one terminal share one attach until the last unsubscribes", async () => {
        await initPaperApi({ port: server.port, token: server.token });
        // keeps an announcement on every connection, so each replay has an end to wait for
        getTransport().subscribeEvent("keepalive", () => {});
        server.answer = (action) => (action === "term:attach" ? { success: true } : {});
        const offFirst = on("terminal-data:t1", () => {});
        const offSecond = on("terminal-data:t1", () => {});
        await server.next("the attach", isAction("term:attach", 0));
        expect(server.requests("term:attach").length).toBe(1);

        offFirst();
        await server.dropConnections();
        const replayed = await server.next("the attach replayed for the remaining subscriber", isAction("term:attach", 1));
        expect(replayed.msg.params.id).toBe("t1");

        offSecond();
        await server.dropConnections();
        // the replay on the third socket is complete once its announcement is in
        await server.next("the third connection's announcement", isAction("events:subscribe", 2));
        await server.next("the third connection's state", (f) => f.conn === 2 && f.msg?.action === "auth:verify");
        expect(server.frames.filter(isAction("term:attach", 2))).toEqual([]);
    });

    test("close() drops every listener, so events from the dying socket reach no one", async () => {
        const t = transport();
        const heard: unknown[] = [];
        const first = deferred();
        t.subscribeEvent("ping", (p) => {
            heard.push(p);
            first.resolve(null);
        });
        await t.ensureConnected();
        await server.next("the announcement", isAction("events:subscribe", 0));
        server.emit("ping", 1);
        await first.promise;
        t.close();
        server.emit("ping", 2);
        await server.connectionClosed(0);
        expect(heard).toEqual([1]);
    });

    test("close() cancels a pending reconnect", async () => {
        const closed = transport();
        const control = transport();
        await closed.ensureConnected();
        await control.ensureConnected();
        const RealWebSocket = globalThis.WebSocket;
        const constructed: string[] = [];
        (globalThis as any).WebSocket = class extends RealWebSocket {
            constructor(url: string | URL) {
                super(url);
                constructed.push(String(url));
            }
        };
        jest.useFakeTimers();
        try {
            // a dropped socket schedules a reconnect on each transport
            await server.dropConnections();
            closed.close();
            jest.advanceTimersByTime(10_000);
            jest.useRealTimers();
            await server.next("the control transport's reconnect", (f) => f.conn === 2 && f.msg?.action === "auth:verify");
            expect(constructed.length).toBe(1);
            await expect(closed.ensureConnected()).rejects.toThrow("PaperCrane transport is disposed");
        } finally {
            jest.useRealTimers();
            (globalThis as any).WebSocket = RealWebSocket;
        }
    });
});

// Long operations are not cut off by the default deadline.
describe("long operations are not cut off by the default deadline", () => {
    test("an unanswered uninstall still waits after the default deadline, an ordinary call times out at 30 s", async () => {
        await initPaperApi({ port: server.port, token: server.token });
        const held = deferred();
        server.answer = (action) => (action === "panel:uninstall" || action === "backup:restore" ? held.promise : new Promise(() => {}));
        jest.useFakeTimers();
        try {
            const uninstallCall = invoke("panel-uninstall", "dev.a");
            const restoreCall = invoke("backup-restore", { panelId: "dev.a", backupId: "b1" });
            const uninstall = track(uninstallCall);
            const restore = track(restoreCall);
            const read = track(invoke("file-read", { targetPath: "x", appId: "dev.a" }));
            await server.next("all three requests", (f) => f.msg?.action === "file:read");
            await server.next("the restore", isAction("backup:restore"));
            await server.next("the uninstall", isAction("panel:uninstall"));
            jest.advanceTimersByTime(29_000);
            await flushMicrotasks();
            expect(read.settled).toBe(false);
            jest.advanceTimersByTime(10 * 60_000);
            await flushMicrotasks();
            expect(read.error?.message).toBe("PaperCrane 'file:read' timed out");
            expect(uninstall.settled).toBe(false);
            expect(restore.settled).toBe(false);
            jest.useRealTimers();
            held.resolve({ success: true });
            expect(await uninstallCall).toEqual({});
            expect(await restoreCall).toEqual({ success: true });
        } finally {
            jest.useRealTimers();
        }
    });

    test("blocksApi.run honours timeoutMs: a number bounds the call, null waits", async () => {
        await initPaperApi({ port: server.port, token: server.token });
        const held = deferred();
        server.answer = (action, params) => (action === "blocks:call" && params.timeoutMs === null ? held.promise : new Promise(() => {}));
        jest.useFakeTimers();
        try {
            const bounded = track(blocksApi.run("dev.a", "slow", {}, { timeoutMs: 1_000 }));
            const unboundedCall = blocksApi.run("dev.a", "install", { extra: 1 }, { timeoutMs: null });
            const unbounded = track(unboundedCall);
            const calls = async () => {
                await server.next("the bounded call", (f) => f.msg?.action === "blocks:call" && f.msg.params.entry === "command.slow");
                return server.next("the unbounded call", (f) => f.msg?.action === "blocks:call" && f.msg.params.entry === "command.install");
            };
            const unboundedFrame = await calls();
            expect(server.frames.find((f) => f.msg?.params?.entry === "command.slow")?.msg.params.timeoutMs).toBe(1_000);
            expect(unboundedFrame.msg.params.timeoutMs).toBeNull();
            expect(unboundedFrame.msg.params.request).toEqual({ inputs: { extra: 1 } });
            jest.advanceTimersByTime(1_001);
            await flushMicrotasks();
            expect(bounded.error?.message).toBe("PaperCrane 'blocks:call' timed out");
            jest.advanceTimersByTime(60 * 60_000);
            await flushMicrotasks();
            expect(unbounded.settled).toBe(false);
            jest.useRealTimers();
            held.resolve({ result: "installed" });
            expect(await unboundedCall).toBe("installed");
        } finally {
            jest.useRealTimers();
        }
    });
});

// processApi.run timeouts kill the child and report RUN_TIMEOUT.
describe("processApi.run timeouts", () => {
    test("a process.run timeout kills the child and resolves RUN_TIMEOUT", async () => {
        await initPaperApi({ port: server.port, token: server.token });
        server.answer = (action) => (action === "process:run" ? { success: true } : {});
        const result = await processApi.run({ command: "sleep-forever" }, 50);
        expect(result).toEqual({ exitCode: -1, code: "RUN_TIMEOUT" });
        const run = server.requests("process:run")[0].msg.params;
        const kill = (await server.next("the kill", isAction("process:kill"))).msg.params;
        expect(kill).toMatchObject({ id: run.id, signal: "SIGTERM" });
    });

    test("a process.run timeout stays a timeout when the killed child's exit arrives before the kill is answered", async () => {
        await initPaperApi({ port: server.port, token: server.token });
        let answerKill!: () => void;
        server.answer = (action, params) => {
            if (action !== "process:kill") return { success: true };
            // the child dies of the SIGTERM and its exit is pushed first
            server.emit("process:exit", { id: params.id, exitCode: 143 });
            return new Promise((resolve) => (answerKill = () => resolve({})));
        };
        const run = processApi.run({ command: "sleep-forever" }, 50);
        await server.next("the kill", isAction("process:kill"));
        expect(await run).toEqual({ exitCode: -1, code: "RUN_TIMEOUT" });
        answerKill();
    });

    test("a process.run timeout whose kill is refused rejects, and exec rejects instead of returning output", async () => {
        await initPaperApi({ port: server.port, token: server.token });
        server.answer = (action) => {
            if (action === "process:kill") throw new Error("the process would not die");
            return { success: true };
        };
        await expect(processApi.run({ command: "stubborn" }, 50)).rejects.toThrow('"stubborn" timed out after 50 ms and could not be stopped: the process would not die');
        server.answer = () => ({ success: true });
        await expect(processApi.exec("slow", [], { timeoutMs: 50 })).rejects.toThrow('RUN_TIMEOUT: "slow" exceeded 50ms and was killed');
    });

    test("a process.run the daemon refuses to start rejects and leaves nothing behind to kill it later", async () => {
        await initPaperApi({ port: server.port, token: server.token });
        server.answer = (action) => {
            if (action === "process:run") throw new Error("env PATH is not allowed");
            return action === "system:ip" ? { ip: "10.0.0.2" } : {};
        };
        const unhandled: unknown[] = [];
        const onUnhandled = (reason: unknown) => unhandled.push(reason);
        process.on("unhandledRejection", onUnhandled);
        jest.useFakeTimers();
        try {
            await expect(processApi.run({ command: "refused" }, 50)).rejects.toThrow("env PATH is not allowed");
            // past the run's deadline: a timer left behind sends its kill now
            jest.advanceTimersByTime(60_000);
            await flushMicrotasks();
            // one socket keeps its order: a kill sent before this answer was heard before it
            await invoke("system-get-ip");
            expect(server.requests("process:kill")).toEqual([]);
            expect(unhandled).toEqual([]);
        } finally {
            jest.useRealTimers();
            process.off("unhandledRejection", onUnhandled);
        }
    });
});
