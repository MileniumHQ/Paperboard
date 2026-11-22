import { afterEach, beforeEach, describe, expect, jest, setDefaultTimeout, test } from "bun:test";
import { backupApi } from "../src/backups";
import { blocksApi } from "../src/blocks";
import net from "node:net";
import { createPanelBridge } from "../src/bridge";
import { fileApi } from "../src/file";
import { terminalApi } from "../src/index";
import { closeTransport, configureHostConnection, getTransport, initPaperApi, invoke, on } from "../src/ipc";
import { processApi } from "../src/process";
import { definePanelService } from "../src/service";
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
        await t.registerBlock("dev.a", "command.ping", () => "from a", pingSchema);
        await t.registerBlock("dev.b", "command.ping", () => "from b", pingSchema);
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
        await t.registerBlock("dev.a", "command.slow", () => {
            entered.ok.resolve(undefined);
            return finish.ok.promise;
        }, { kind: "command", id: "slow", name: "Slow" });
        await t.registerBlock("dev.a", "command.doomed", async () => {
            entered.fail.resolve(undefined);
            await finish.fail.promise;
            throw new Error("boom");
        }, { kind: "command", id: "doomed", name: "Doomed" });
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
        await t.registerBlock("dev.a", "command.start", () => null, startSchema);
        await t.registerBlock("dev.b", "command.stop", () => null, stopSchema);
        await t.defineBlocksProject("dev.a", { id: "server1", name: "Server 1" });
        await t.defineBlocksProject("dev.a", { id: "server10", name: "Server 10", icon: "dns" });
        await t.registerBlock("dev.a", "server1/command.start", () => null, startSchema);
        await t.registerBlock("dev.a", "server10/command.start", () => null, startSchema);

        await server.dropConnections();
        await server.next("the replayed server10/command.start", (f) => f.conn === 1 && f.msg?.action === "blocks:register" && f.msg.params.entry === "server10/command.start");
        const replay = server.frames.filter(on_(1));
        const registers = replay.filter(isAction("blocks:register")).map((f) => ({ panelId: f.msg.params.panelId, entry: f.msg.params.entry, schema: f.msg.params.schema }));
        expect(registers.sort((a, b) => (`${a.panelId} ${a.entry}` < `${b.panelId} ${b.entry}` ? -1 : 1))).toEqual([
            { panelId: "dev.a", entry: "command.start", schema: startSchema },
            { panelId: "dev.a", entry: "server1/command.start", schema: startSchema },
            { panelId: "dev.a", entry: "server10/command.start", schema: startSchema },
            { panelId: "dev.b", entry: "command.stop", schema: stopSchema },
        ]);
        const defines = replay.filter(isAction("blocks:project-define")).map((f) => f.msg.params);
        expect(defines.map((p) => ({ panelId: p.panelId, project: p.project, name: p.name, icon: p.icon }))).toEqual([
            { panelId: "dev.a", project: "server1", name: "Server 1", icon: undefined },
            { panelId: "dev.a", project: "server10", name: "Server 10", icon: "dns" },
        ]);
        const lastDefine = Math.max(...replay.map((f, i) => (f.msg?.action === "blocks:project-define" ? i : -1)));
        const firstRegister = replay.findIndex((f) => f.msg?.action === "blocks:register");
        expect(lastDefine).toBeLessThan(firstRegister);

        // removing server1 forgets only its own blocks, never server10's
        await t.removeBlocksProject("dev.a", "server1");
        await server.dropConnections();
        await server.next("the second replay", (f) => f.conn === 2 && f.msg?.action === "blocks:register" && f.msg.params.entry === "server10/command.start");
        await server.next("the second replay's dev.b stop", (f) => f.conn === 2 && f.msg?.action === "blocks:register" && f.msg.params.entry === "command.stop");
        const second = server.frames.filter((f) => f.conn === 2 && f.msg?.action === "blocks:register").map((f) => f.msg.params.entry);
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

// Failures reach the caller.
describe("failures reach the caller", () => {
    test("terminal and process writes, resizes, creates, destroys and kills reject with the daemon's reason", async () => {
        await initPaperApi({ port: server.port, token: server.token });
        server.answer = (action) => {
            throw new Error(`refused ${action}`);
        };
        await expect(terminalApi.create("t1")).rejects.toThrow("refused term:create");
        await expect(terminalApi.write("t1", "ls\n")).rejects.toThrow("refused term:write");
        await expect(terminalApi.resize("t1", 80, 24)).rejects.toThrow("refused term:resize");
        await expect(terminalApi.destroy("t1")).rejects.toThrow("refused term:destroy");
        await expect(processApi.write("p1", "say hi\n")).rejects.toThrow("refused process:write");
        await expect(processApi.closeInput("p1")).rejects.toThrow("refused process:close-input");
        await expect(processApi.kill("p1")).rejects.toThrow("refused process:kill");
    });

    test("a call on a socket the daemon closes fails with the daemon's code and reason", async () => {
        await initPaperApi({ port: server.port, token: server.token });
        const unanswered = deferred();
        server.answer = () => unanswered.promise;
        const write = terminalApi.write("t1", "ls\n");
        await server.next("the write to reach the daemon", isAction("term:write"));
        await server.dropConnections({ code: 4429, reason: "Too many concurrent requests" });
        await expect(write).rejects.toThrow("PaperCrane connection closed (4429 Too many concurrent requests)");
    });

    test("attaching to a process that is not there reports failure and is not replayed on reconnect", async () => {
        await initPaperApi({ port: server.port, token: server.token });
        getTransport().subscribeEvent("keepalive", () => {});
        server.answer = (action, params) => (action === "process:attach" ? { success: params.id === "alive" } : {});
        expect(await processApi.attach("gone")).toEqual({ success: false });
        expect(await processApi.attach("alive")).toEqual({ success: true });
        await server.dropConnections();
        const replayed = await server.next("the attach replayed", isAction("process:attach", 1));
        expect(replayed.msg.params.id).toBe("alive");
        await server.next("the second connection's announcement", isAction("events:subscribe", 1));
        await server.next("the second connection's state", (f) => f.conn === 1 && f.msg?.action === "auth:verify");
        expect(server.frames.filter(isAction("process:attach", 1)).map((f) => f.msg.params.id)).toEqual(["alive"]);
    });

    test("a stream whose attach fails says so to its subscriber and is not replayed on reconnect", async () => {
        await initPaperApi({ port: server.port, token: server.token });
        getTransport().subscribeEvent("keepalive", () => {});
        server.answer = (action, params) => {
            if (action === "term:attach") throw new Error("not this panel's terminal");
            if (action === "process:attach") return { success: params.id === "alive" };
            return {};
        };
        const consoleError = console.error;
        console.error = () => {};
        try {
            const refused = terminalApi.onData("theirs", () => {});
            await expect(refused.attached).rejects.toThrow("not this panel's terminal");
            const gone = processApi.onExit("gone", () => {});
            const alive = processApi.onExit("alive", () => {});
            // a second subscriber shares the first one's answer
            expect(await processApi.onData("gone", () => {}).attached).toBe(false);
            expect(await gone.attached).toBe(false);
            expect(await alive.attached).toBe(true);
        } finally {
            console.error = consoleError;
        }
        await server.dropConnections();
        await server.next("the second connection's announcement", isAction("events:subscribe", 1));
        await server.next("the second connection's state", (f) => f.conn === 1 && f.msg?.action === "auth:verify");
        expect(server.frames.filter((f) => f.conn === 1 && /:attach$/.test(f.msg?.action ?? "")).map((f) => f.msg.params.id)).toEqual(["alive"]);
    });

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

    test("a state change the page could not be told is sent again until it arrives", async () => {
        await initPaperApi({ port: server.port, token: server.token });
        let refusals = 1;
        server.answer = (action) => {
            if (action === "blocks:emit" && refusals-- > 0) throw new Error("the daemon is restarting");
            return {};
        };
        const lines: string[] = [];
        const consoleError = console.error;
        console.error = (...args: unknown[]) => void lines.push(args.map(String).join(" "));
        try {
            const service = definePanelService({ id: "dev.test.resync", state: { running: false, players: 0 } });
            await service.ready;
            service.setState({ running: true });
            const retried = await server.next("the state sent again", (f) => f.msg?.action === "blocks:emit" && server.requests("blocks:emit").indexOf(f) === 1);
            expect(retried.msg.params.payload).toEqual({ state: { running: true } });
            expect(lines.some((l) => l.includes("[Service:dev.test.resync] Failed to sync state") && l.includes("the daemon is restarting"))).toBe(true);
        } finally {
            console.error = consoleError;
        }
    });

    test("a refused download rejects and stops its progress listener", async () => {
        await initPaperApi({ port: server.port, token: server.token });
        server.answer = (action) => {
            if (action === "file:download") throw new Error("checksum algorithm md5 is not allowed");
            return {};
        };
        const progress: unknown[] = [];
        await expect(
            fileApi.download({ url: "https://example.invalid/a", targetPath: "a", appId: "dev.a", onProgress: (p) => progress.push(p) }),
        ).rejects.toThrow("checksum algorithm md5 is not allowed");
        const downloadId = server.requests("file:download")[0].msg.params.downloadId;
        // the progress subscription is withdrawn from the daemon
        await server.next("the announcement without progress", (f) => f.msg?.action === "events:subscribe" && !f.msg.params.events.includes("progress"));
        server.emit("progress", { downloadId, stage: "downloading", percent: 10 });
        // a later event this transport does listen for arrives after it
        const heard = deferred();
        getTransport().subscribeEvent("sentinel", () => heard.resolve(null));
        await server.next("the sentinel announcement", (f) => f.msg?.action === "events:subscribe" && f.msg.params.events.includes("sentinel"));
        server.emit("sentinel", {});
        await heard.promise;
        expect(progress).toEqual([]);
    });
});

// A panel bridge's state reads: late answers lose.
describe("a panel bridge keeps the newest state", () => {
    test("an older read answered last, or a field patched while a read was out, never rolls the state back", async () => {
        await initPaperApi({ port: server.port, token: server.token });
        const reads: ((state: unknown) => void)[] = [];
        server.answer = (action) =>
            action === "blocks:call" ? new Promise((resolve) => reads.push((state) => resolve({ result: state }))) : {};
        const bridge = createPanelBridge<{ players: number; map: string }>({ panelId: "dev.test.bridge", defaultState: { players: 0, map: "" } });
        try {
            // the hydration read is out; a refresh overtakes it
            await server.next("the hydration read", (f) => server.requests("blocks:call").indexOf(f) === 0);
            const refresh = bridge.refreshState();
            await server.next("the refresh read", (f) => server.requests("blocks:call").indexOf(f) === 1);
            reads[1]({ players: 2, map: "forest" });
            expect(await refresh).toEqual({ players: 2, map: "forest" });
            reads[0]({ players: 1, map: "desert" });
            await flushMicrotasks();
            expect(bridge.getState()).toEqual({ players: 2, map: "forest" });

            // a patch lands while a read is out: the read keeps only the fields the patch left alone
            const announced = await server.next("the state event announcement", (f) => f.msg?.action === "events:subscribe" && f.msg.params.events.some((e: string) => e.startsWith("blocks:dev.test.bridge:")));
            const stateEvent = announced.msg.params.events.find((e: string) => e.startsWith("blocks:dev.test.bridge:"));
            await getTransport().subscriptionsSettled();
            const patched = deferred();
            const offPatch = bridge.onStateChange((patch) => {
                if ("players" in patch && patch.players === 3) patched.resolve(null);
            });
            const later = bridge.refreshState();
            await server.next("the third read", (f) => server.requests("blocks:call").indexOf(f) === 2);
            server.emit(stateEvent, { state: { players: 3 } });
            await patched.promise;
            offPatch();
            reads[2]({ players: 2, map: "tundra" });
            expect(await later).toEqual({ players: 3, map: "tundra" });
        } finally {
            bridge.dispose();
        }
    });
});

// A backup progress listener has no caller to tell when it can't connect.
describe("a backup progress listener that can't connect yet", () => {
    test("says why on the transport's status, keeps trying, and hears progress once it connects", async () => {
        let refusals = 1;
        const release = configureHostConnection(async () => {
            if (refusals-- > 0) throw new Error("the host has no credential yet");
            return { port: server.port, token: server.token };
        });
        const statuses: { connected: boolean; error?: string }[] = [];
        const connected = deferred();
        const errors: string[] = [];
        const consoleError = console.error;
        console.error = (...args: unknown[]) => void errors.push(args.map(String).join(" "));
        try {
            getTransport("local").onStatus((s) => {
                statuses.push(s);
                if (s.connected) connected.resolve(null);
            });
            const heard = deferred<unknown>();
            const off = backupApi.onProgress("dev.test.backups", (change) => heard.resolve(change), "local");
            await connected.promise;
            expect(statuses[0]).toEqual({ connected: false, error: "the host has no credential yet" });
            await server.next("the progress announcement", (f) => f.msg?.action === "events:subscribe" && f.msg.params.events.includes("backup:progress"));
            await getTransport("local").subscriptionsSettled();
            server.emit("backup:progress", { panelId: "dev.test.backups", sourceId: null, progress: null });
            expect(await heard.promise).toEqual({ panelId: "dev.test.backups", sourceId: null, progress: null });
            off();
        } finally {
            console.error = consoleError;
            release();
        }
        expect(errors.some((l) => l.includes("the host has no credential yet"))).toBe(true);
    });
});

// A subscription is what no caller waits on: made while the daemon is
// down, it keeps trying and hears events once the daemon is back.
describe("a subscription made while the daemon is down", () => {
    const subscriptions = [
        { name: "Blocks' registry", event: "blocks:registry-updated", payload: { type: "registered", panelId: "dev.a" }, listen: (cb: (p: unknown) => void) => blocksApi.onRegistryChange(cb) },
        { name: "a process's output", event: "process:data", payload: { id: "p1", data: "up", stream: "stdout" }, listen: (cb: (p: unknown) => void) => on("process-data:p1", (_e: unknown, data: unknown) => cb({ id: "p1", data, stream: "stdout" })) },
    ];
    for (const sub of subscriptions) {
        test(`hears ${sub.name} once the daemon is up`, async () => {
            const { port, token } = server;
            await server.close();
            // the daemon is down: its port drops every connection, and says when
            const turnedAway: (() => void)[] = [];
            const refusing = net.createServer((socket) => {
                socket.destroy();
                turnedAway.shift()?.();
            });
            await new Promise<void>((ok) => refusing.listen(port, "127.0.0.1", ok));
            const refused = () => new Promise<void>((ok) => turnedAway.push(ok));
            let attempt = refused();
            const down = await initPaperApi({ port, token }).then(() => null, (err: Error) => err.message);
            await attempt;
            expect(down).not.toBeNull();
            const heard = deferred<unknown>();
            attempt = refused();
            const off = sub.listen((p) => heard.resolve(p));
            try {
                // the subscription's own try is turned away too
                await attempt;
                await new Promise<void>((ok) => refusing.close(() => ok()));
                server = await startWireServer(token, port);
                server.answer = (action) => (action === "process:attach" ? { success: true } : {});
                await server.next("the announcement", (f) => f.msg?.action === "events:subscribe" && f.msg.params.events.includes(sub.event));
                await getTransport().subscriptionsSettled();
                server.emit(sub.event, sub.payload);
                expect(await heard.promise).toEqual(sub.payload);
            } finally {
                off();
            }
        });
    }
});

// A bridge's first read has no button waiting for it: a failure is shown as the panel's problem.
describe("a panel bridge's first read that fails reaches the person", () => {
    test("it is reported as the panel's problem, and cleared once a read gets the state", async () => {
        await initPaperApi({ port: server.port, token: server.token });
        let refusals = 1;
        server.answer = (action) => {
            if (action === "blocks:call" && refusals-- > 0) throw new Error("the service is not running");
            return action === "blocks:call" ? { result: { players: 4 } } : {};
        };
        const bridge = createPanelBridge<{ players: number }>({ panelId: "dev.test.unread", defaultState: { players: 0 } });
        try {
            const reported = await server.next("the problem report", (f) => f.msg?.action === "problems:report");
            expect(reported.msg.params).toMatchObject({ panelId: "dev.test.unread", key: "paperapi:state", message: "the service is not running" });
            expect(await bridge.refreshState()).toEqual({ players: 4 });
            const cleared = await server.next("the problem cleared", (f) => f.msg?.action === "problems:clear");
            expect(cleared.msg.params).toMatchObject({ panelId: "dev.test.unread", key: "paperapi:state" });
            // the daemon answers in order on one connection: once a later read is answered, so was the clear
            await bridge.refreshState();
        } finally {
            bridge.dispose();
        }
    });
});
