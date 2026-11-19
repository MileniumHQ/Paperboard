// processApi.stop over the daemon's wire: the server here plays a
// supervisor holding one process, which answers attach, exists and kill as
// the daemon does and reports the exit when a signal ends it.
import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { closeTransport, getTransport, initPaperApi } from "../src/ipc";
import { processApi, stopProcess } from "../src/process";
import { startWireServer, type WireServer } from "./helpers/wire";

setDefaultTimeout(30_000);

let server: WireServer;

beforeEach(async () => {
    server = await startWireServer();
    await initPaperApi({ port: server.port, token: server.token });
});

afterEach(async () => {
    await getTransport().subscriptionsSettled();
    closeTransport();
    await server.close();
});

/** a supervised process "p": `ends` is the signals it dies of; `refuseKill` answers a kill with an error after ending it */
function supervise(opts: { running: boolean; ends: string[]; refuseKill?: boolean }) {
    let running = opts.running;
    server.answer = (action, params) => {
        if (action === "process:attach") return { success: running };
        if (action === "process:exists") return { running };
        if (action === "process:kill") {
            if (opts.ends.includes(params.signal) && running) {
                running = false;
                server.emit("process:exit", { id: "p", exitCode: 143 });
            }
            if (opts.refuseKill) throw new Error("no such process");
            return {};
        }
        return {};
    };
}

const signals = () => server.requests("process:kill").map((f) => f.msg.params.signal);

describe("processApi.stop", () => {
    test("a process that ends on SIGTERM is stopped by it, without waiting out the grace", async () => {
        supervise({ running: true, ends: ["SIGTERM", "SIGKILL"] });
        const started = Date.now();
        await processApi.stop("p");
        expect(signals()).toEqual(["SIGTERM"]);
        expect(Date.now() - started).toBeLessThan(1_500);
    });

    test("a process that ignores SIGTERM gets SIGKILL once the grace has passed", async () => {
        supervise({ running: true, ends: ["SIGKILL"] });
        const started = Date.now();
        await processApi.stop("p", { graceMs: 200 });
        expect(signals()).toEqual(["SIGTERM", "SIGKILL"]);
        expect(Date.now() - started).toBeGreaterThanOrEqual(200);
    });

    test("one that isn't running is already stopped, and one that ended as it was signalled too", async () => {
        supervise({ running: false, ends: ["SIGTERM"] });
        await processApi.stop("p");
        expect(signals()).toEqual([]);
        // the kill is refused because the process just ended: that is a stop
        supervise({ running: true, ends: ["SIGTERM"], refuseKill: true });
        await processApi.stop("p");
        expect(signals()).toEqual(["SIGTERM"]);
    });

    test("one still running after both signals throws, and a refused kill of a running one throws its reason", async () => {
        supervise({ running: true, ends: [] });
        await expect(processApi.stop("p", { graceMs: 50 })).rejects.toThrow("The process p didn't stop");
        expect(signals()).toEqual(["SIGTERM", "SIGKILL"]);
        supervise({ running: true, ends: [], refuseKill: true });
        await expect(processApi.stop("p", { graceMs: 50 })).rejects.toThrow("no such process");
    });
});

describe("an exit listener from before the process started", () => {
    test("doesn't make a later stop think nothing is running, and hears the exit itself", async () => {
        // a service listens for its process's exit before it starts it: the daemon has nothing to attach to yet
        supervise({ running: false, ends: ["SIGTERM"] });
        let heard = 0;
        const off = processApi.onExit("p", () => heard++);
        expect(await off.attached).toBe(false);
        // then it starts, and a stop must find it and end it
        supervise({ running: true, ends: ["SIGTERM"] });
        await processApi.stop("p");
        expect(signals()).toEqual(["SIGTERM"]);
        expect(heard).toBe(1);
        off();
    });
});

describe("stopProcess with a host of its own", () => {
    test("stops what the host runs, the same way: SIGTERM, then SIGKILL past the grace", async () => {
        let running = true;
        const sent: string[] = [];
        const exits = new Set<() => void>();
        const host = {
            exists: async () => running,
            kill: async (_id: string, signal?: string) => {
                sent.push(signal!);
                if (signal === "SIGKILL") {
                    running = false;
                    for (const exit of exits) exit();
                }
            },
            // a plain teardown: no daemon to attach to
            onExit: (_id: string, callback: () => void) => {
                exits.add(callback);
                return () => exits.delete(callback);
            },
        };
        await stopProcess("child", { host, graceMs: 50 });
        expect(sent).toEqual(["SIGTERM", "SIGKILL"]);
        expect(exits.size).toBe(0);
        expect(server.requests("process:kill")).toEqual([]);
    });
});
