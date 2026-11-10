import { afterEach, beforeEach, describe, expect, jest, setDefaultTimeout, test } from "bun:test";
import { actionsApi } from "../src/actions";
import { fileApi } from "../src/file";
import { terminalApi } from "../src/index";
import { closeTransport, getTransport, initPaperApi, invoke, on, RPC_ROUTES } from "../src/ipc";
import { processApi } from "../src/process";
import { TransportRegistry } from "../src/transport/registry";
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
    test("the same action name under two panels dispatches by panelId:action and removing one leaves the other", async () => {
        const t = transport({ panelId: "dev.ambient" });
        await t.registerAction("dev.a", "ping", () => "from a");
        await t.registerAction("dev.b", "ping", () => "from b");
        const reply = async (callId: string, panelId: string | undefined, action: string) => {
            server.sendRaw({ type: "action_call", callId, panelId, action, args: [] });
            return (await server.next(`the reply to ${callId}`, (f) => f.msg?.type === "action_reply" && f.msg.callId === callId)).msg;
        };
        expect(await reply("1", "dev.a", "ping")).toEqual({ type: "action_reply", callId: "1", result: "from a" });
        expect(await reply("2", "dev.b", "ping")).toEqual({ type: "action_reply", callId: "2", result: "from b" });
        // a bare name or the ambient panel owns nothing
        expect((await reply("3", undefined, "ping")).error).toBe("Handler for action 'ping' not found");
        expect((await reply("4", "dev.ambient", "ping")).error).toBe("Handler for action 'ping' not found");

        await t.unregisterAction("dev.a", "ping");
        expect((await reply("5", "dev.a", "ping")).error).toBe("Handler for action 'ping' not found");
        expect(await reply("6", "dev.b", "ping")).toEqual({ type: "action_reply", callId: "6", result: "from b" });
    });

    test("the registry keys every handler by its panel", () => {
        const registry = new TransportRegistry();
        registry.addAction("dev.a", "ping", () => "a");
        registry.addAction("dev.b", "ping", () => "b");
        expect(registry.getHandler("ping")).toBeUndefined();
        expect(registry.getHandler("dev.a:ping")?.()).toBe("a");
        registry.removeAction("dev.a", "ping");
        expect(registry.getHandler("dev.a:ping")).toBeUndefined();
        expect(registry.getHandler("dev.b:ping")?.()).toBe("b");
    });
});

// Reconnect replays registrations faithfully.
describe("reconnect replays registrations faithfully", () => {
    test("every registration is re-sent once under its own panel and schema, projects before their actions", async () => {
        const t = transport({ panelId: "dev.ambient" });
        const schema = { id: "start", name: "Start", description: "Starts it" };
        await t.registerAction("dev.a", "start", () => null, schema);
        await t.registerAction("dev.b", "stop", () => null);
        await t.defineProject("dev.a", { id: "server1", name: "Server 1" });
        await t.defineProject("dev.a", { id: "server10", name: "Server 10", icon: "dns" });
        await t.registerAction("dev.a", "server1/start", () => null);
        await t.registerAction("dev.a", "server10/start", () => null);

        await server.dropConnections();
        await server.next("the replayed server10/start", (f) => f.conn === 1 && f.msg?.action === "actions:register" && f.msg.params.action === "server10/start");
        const replay = server.frames.filter(on_(1));
        const registers = replay.filter(isAction("actions:register")).map((f) => ({ panelId: f.msg.params.panelId, action: f.msg.params.action, schema: f.msg.params.schema }));
        expect(registers.sort((a, b) => (`${a.panelId} ${a.action}` < `${b.panelId} ${b.action}` ? -1 : 1))).toEqual([
            { panelId: "dev.a", action: "server1/start", schema: undefined },
            { panelId: "dev.a", action: "server10/start", schema: undefined },
            { panelId: "dev.a", action: "start", schema },
            { panelId: "dev.b", action: "stop", schema: undefined },
        ]);
        const defines = replay.filter(isAction("actions:project-define")).map((f) => f.msg.params);
        expect(defines.map((p) => ({ panelId: p.panelId, project: p.project, name: p.name, icon: p.icon }))).toEqual([
            { panelId: "dev.a", project: "server1", name: "Server 1", icon: undefined },
            { panelId: "dev.a", project: "server10", name: "Server 10", icon: "dns" },
        ]);
        const lastDefine = Math.max(...replay.map((f, i) => (f.msg?.action === "actions:project-define" ? i : -1)));
        const firstRegister = replay.findIndex((f) => f.msg?.action === "actions:register");
        expect(lastDefine).toBeLessThan(firstRegister);

        // removing server1 forgets only its own actions, never server10's
        await t.removeProject("dev.a", "server1");
        await server.dropConnections();
        await server.next("the second replay", (f) => f.conn === 2 && f.msg?.action === "actions:register" && f.msg.params.action === "server10/start");
        await server.next("the second replay's dev.b stop", (f) => f.conn === 2 && f.msg?.action === "actions:register" && f.msg.params.action === "stop");
        const second = server.frames.filter((f) => f.conn === 2 && f.msg?.action === "actions:register").map((f) => f.msg.params.action);
        expect(second.sort()).toEqual(["server10/start", "start", "stop"]);
        expect(server.frames.filter((f) => f.conn === 2 && f.msg?.action === "actions:project-define").map((f) => f.msg.params.project)).toEqual(["server10"]);
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
        await t.call("ping", {});
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
        expect(await t.call("file:read", { targetPath: "y" })).toEqual({});
        const read = await server.next("file:read inside the new tunnel", (f) => f.msg?.action === "file:read");
        expect(read.tunnel).not.toBeNull();
        expect(read.tunnel).not.toBe(firstTunnel);
        expect(plainRequests()).toEqual([]);
    });

    test("after a socket drop it reconnects, reopens the tunnel and replays terminal attaches through it", async () => {
        const t = transport({ computerId: "remote-1" });
        await t.call("ping", {});
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

    test("subscribers to one terminal share one attach until the last unsubscribes", async () => {
        await initPaperApi({ port: server.port, token: server.token });
        // keeps an announcement on every connection, so each replay has an end to wait for
        getTransport().subscribeEvent("keepalive", () => {});
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
    test("uninstall, backup and restore carry no timeout while ordinary routes keep 30 s", () => {
        expect(RPC_ROUTES["panel-uninstall"].timeoutMs).toBeNull();
        expect(RPC_ROUTES["backup-create"].timeoutMs).toBeNull();
        expect(RPC_ROUTES["backup-restore"].timeoutMs).toBeNull();
        expect(RPC_ROUTES["file-read"].timeoutMs).toBeUndefined();
    });

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
            expect(await uninstallCall).toBe(true);
            expect(await restoreCall).toEqual({ success: true });
        } finally {
            jest.useRealTimers();
        }
    });

    test("actionsApi.call honours timeoutMs: a number bounds the call, null waits", async () => {
        await initPaperApi({ port: server.port, token: server.token });
        const held = deferred();
        server.answer = (action, params) => (action === "actions:call" && params.timeoutMs === null ? held.promise : new Promise(() => {}));
        jest.useFakeTimers();
        try {
            const bounded = track(actionsApi.call("dev.a", "slow", {}, { timeoutMs: 1_000 }));
            const unboundedCall = actionsApi.call("dev.a", "install", {}, { timeoutMs: null, extra: 1 });
            const unbounded = track(unboundedCall);
            const calls = async () => {
                await server.next("the bounded call", (f) => f.msg?.action === "actions:call" && f.msg.params.action === "slow");
                return server.next("the unbounded call", (f) => f.msg?.action === "actions:call" && f.msg.params.action === "install");
            };
            const unboundedFrame = await calls();
            expect(server.frames.find((f) => f.msg?.params?.action === "slow")?.msg.params.timeoutMs).toBe(1_000);
            expect(unboundedFrame.msg.params.timeoutMs).toBeNull();
            expect(unboundedFrame.msg.params.args).toEqual([{}, { extra: 1 }]);
            jest.advanceTimersByTime(1_001);
            await flushMicrotasks();
            expect(bounded.error?.message).toBe("PaperCrane 'actions:call' timed out");
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
        await expect(processApi.kill("p1")).rejects.toThrow("refused process:kill");
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

// Event and trigger subscriptions are scoped to a panel.
describe("event and trigger subscriptions are scoped to a panel", () => {
    test("on and onTrigger throw without a panel identity and refuse the wildcard", async () => {
        await initPaperApi({ port: server.port, token: server.token });
        expect(() => actionsApi.on("joined", () => {})).toThrow("could not resolve this panel's id");
        expect(() => actionsApi.onTrigger("joined", () => {})).toThrow("could not resolve this panel's id");
        expect(() => actionsApi.on("*", "joined", () => {})).toThrow('does not accept "*"');
        expect(() => actionsApi.on("dev.a", "*", () => {})).toThrow('does not accept "*"');
        expect(() => actionsApi.onTrigger("*", "joined", () => {})).toThrow('does not accept "*"');
        expect(() => actionsApi.onTrigger("dev.a", "*", () => {})).toThrow('does not accept "*"');
    });

    test("the two-argument onTrigger hears only this panel's trigger, never another's of the same name", async () => {
        await initPaperApi({ port: server.port, token: server.token, panelId: "dev.me" });
        const heard: unknown[] = [];
        const arrived = deferred();
        const off = actionsApi.onTrigger("joined", (output, payload) => {
            heard.push({ output, payload });
            arrived.resolve(null);
        });
        const subscribed = await server.next("the trigger subscription", (f) => f.msg?.action === "events:subscribe");
        expect(subscribed.msg.params.events).toEqual(["triggers:dev.me:joined"]);
        server.emit("triggers:dev.other:joined", { who: "intruder" });
        server.emit("triggers:dev.me:joined", { who: "friend" });
        await arrived.promise;
        expect(heard).toEqual([{ output: { who: "friend" }, payload: { panelId: "dev.me", trigger: "joined", output: { who: "friend" } } }]);
        off();
    });
});
