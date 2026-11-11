// spawn helper for detached supervisors
import { spawn, type ChildProcess } from "child_process";
import { randomUUID } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { SupervisedProcessClient, supervisorPresent } from "./supervisor";
import { supervisorLaunch } from "./supervisorLaunch";
import { supervisorBinary } from "./supervisorBinary";
import { logger } from "./logger";
import { LimitError } from "./storage";
import { getLogsDir } from "./paths";

// Live supervised workload budget: each client is a detached supervisor
// process plus a socket and metadata files, so minting unique ids must not
// grow that set without bound (bounded everything). Enforced here — the
// single choke point every create path (RPC, TUI, desktop app) spawns through.
export const MAX_LIVE_CLIENTS = 128;

// how much of a supervisor's stderr a failed start reports
const STARTUP_STDERR_TAIL_BYTES = 4096;

// Where a starting supervisor's stderr goes until it is ready. A file, not a
// pipe: the supervisor keeps running after this daemon exits, and a pipe the
// daemon closed would fail its later writes. The file is removed once the
// start is decided, which a running supervisor does not mind (its handle
// keeps working on every platform Node opens files on).
class StartupStderr {
    private constructor(private readonly file: string, readonly fd: number) {}

    static open(): StartupStderr {
        const dir = getLogsDir();
        fs.mkdirSync(dir, { recursive: true });
        const file = path.join(dir, `supervisor-start-${randomUUID()}.stderr`);
        return new StartupStderr(file, fs.openSync(file, "wx+", 0o600));
    }

    // what the supervisor wrote last, bounded
    tail(): string {
        const size = fs.fstatSync(this.fd).size;
        const length = Math.min(size, STARTUP_STDERR_TAIL_BYTES);
        const buffer = Buffer.alloc(length);
        fs.readSync(this.fd, buffer, 0, length, size - length);
        return buffer.toString("utf8").trim();
    }

    discard(): void {
        try { fs.closeSync(this.fd); } catch (err) { logger.warn(`[engineSupervisor] could not close ${this.file}:`, err); }
        try { fs.rmSync(this.file, { force: true }); } catch (err) { logger.warn(`[engineSupervisor] could not remove ${this.file}:`, err); }
    }
}

function exitDescription(proc: ChildProcess): string {
    if (proc.signalCode !== null) return `it was killed by ${proc.signalCode}`;
    return `it exited with code ${proc.exitCode}`;
}

export interface PreListeners {
    onData?: (data: string) => void;
    onStdout?: (data: string) => void;
    onStderr?: (data: string) => void;
    onExit?: (code: number) => void;
    // runs on the new client before it connects, so a caller can attach
    // its own stream listeners without missing the first output
    attach?: (client: any) => void;
}

export async function spawnSupervisedClient(
    id: string,
    supervisorConfig: any,
    clientsMap: Map<string, any>,
    preListeners?: PreListeners,
): Promise<any> {
    const existing = clientsMap.get(id);
    if (existing && existing.isConnected()) throw new Error(`Process ${id} is already running`);

    // budget counts LIVE clients: a dead entry under the same id is being
    // replaced, not added
    const replacement = existing ? 1 : 0;
    if (clientsMap.size - replacement >= MAX_LIVE_CLIENTS) {
        throw new LimitError(`Too many live supervised workloads (max ${MAX_LIVE_CLIENTS})`);
    }
    if (existing) {
        existing.destroy();
        clientsMap.delete(id);
    }

    // a supervisor already listening for this id (one that outlived a
    // daemon restart) is a running workload: spawning another would take
    // over its endpoint and orphan it beyond the reach of kill and uninstall
    if (supervisorPresent(id)) {
        const probe = new SupervisedProcessClient(id);
        const live = await probe.connect();
        probe.destroy();
        if (live) throw new Error(`Process ${id} is already running; attach to it instead of starting it again`);
    }

    const launch = supervisorLaunch(id, await supervisorBinary());

    let supervisorProc: ChildProcess;
    let startupStderr: StartupStderr | undefined;
    try {
        startupStderr = StartupStderr.open();
        supervisorProc = spawn(launch.command, launch.args, {
            detached: true,
            env: launch.env,
            stdio: ["pipe", "ignore", startupStderr.fd],
            windowsHide: true,
        });
    } catch (err) {
        startupStderr?.discard();
        throw err;
    }

    if (supervisorProc.stdin) {
        // a supervisor that dies before reading its config must not leave
        // an unhandled EPIPE rejection behind
        supervisorProc.stdin.on("error", (err) => logger.debug(`[engineSupervisor] supervisor ${id} stdin closed early:`, err));
        supervisorProc.stdin.write(JSON.stringify(supervisorConfig));
        supervisorProc.stdin.end();
    }
    supervisorProc.unref();

    const client = new SupervisedProcessClient(id);
    clientsMap.set(id, client);

    // listeners first so initial output is never missed
    if (preListeners?.onData) client.on("data", preListeners.onData);
    if (preListeners?.onStdout) client.on("stdout", preListeners.onStdout);
    if (preListeners?.onStderr) client.on("stderr", preListeners.onStderr);
    if (preListeners?.onExit) client.on("exit", preListeners.onExit);
    preListeners?.attach?.(client);

    // up to 5 s for the endpoint to appear. A supervisor that has exited is
    // never coming up.
    let supervisorExited = supervisorProc.exitCode !== null || supervisorProc.signalCode !== null;
    supervisorProc.once("exit", () => { supervisorExited = true; });
    // a binary the system refuses to run (a data directory mounted noexec)
    // is reported here, with no exit to follow
    let spawnFailure: Error | null = null;
    supervisorProc.once("error", (err) => { spawnFailure = err; supervisorExited = true; });
    for (let i = 0; i < 100 && !supervisorExited; i++) {
        const connected = await client.connect();
        if (connected) break;
        await new Promise((r) => setTimeout(r, 50));
    }

    if (!client.isConnected()) {
        client.destroy(); clientsMap.delete(id);
        // read before the stop below: that one's own exit is not the cause
        const failure = spawnFailure as Error | null;
        const cause = failure ? `${launch.command} could not be run: ${failure.message}` : supervisorExited ? exitDescription(supervisorProc) : "it did not answer within 5 s";
        let stderr: string;
        try { stderr = startupStderr.tail(); }
        catch (err) { stderr = `(its stderr could not be read: ${err instanceof Error ? err.message : String(err)})`; }
        startupStderr.discard();
        await stopSpawnedSupervisor(id, supervisorProc);
        throw new Error(`Supervisor ${id} did not become ready: ${cause}${stderr ? `\n${stderr}` : ""}`);
    }
    startupStderr.discard();
    try {
        await client.awaitStarted();
    } catch (err) {
        // if the supervisor got far enough to run a child, the socket is
        // the only channel that stops the child as well as the supervisor;
        // a refused socket kill is the recoverable case (the client is
        // already failing), logged and followed by the process-level stop
        if (client.isConnected()) {
            try {
                client.kill("SIGTERM");
                await exitsOnEvent(client);
            } catch (socketKillErr) {
                logger.debug(`[engineSupervisor] socket stop of supervisor ${id} failed; falling back to process-level stop:`, socketKillErr);
            }
        }
        client.destroy(); clientsMap.delete(id);
        await stopSpawnedSupervisor(id, supervisorProc);
        throw err;
    }
    return client;
}

// A start failure must not leave the detached supervisor (or its child)
// running unclaimed: it is not in the clients map, so nothing without this
// teardown reaches it. The supervisor handles SIGTERM explicitly
// (supervisor/supervisor.go: cleanupAndExit), which unlinks the endpoint too. Each
// signal is a request; the exit is what is observed.
export async function stopSpawnedSupervisor(id: string, supervisorProc: ChildProcess): Promise<void> {
    if (supervisorProc.exitCode !== null || supervisorProc.signalCode !== null) return;
    // SIGTERM → the supervisor's cleanupAndExit stops the workload too
    try {
        supervisorProc.kill("SIGTERM");
    } catch (err) {
        logger.error(`[engineSupervisor] SIGTERM to detached supervisor ${id} failed:`, err);
    }
    if (await exitsEventually(supervisorProc, 3000)) return;
    try {
        supervisorProc.kill("SIGKILL");
    } catch (err) {
        logger.error(`[engineSupervisor] SIGKILL to detached supervisor ${id} failed; the workload stays under supervisor pid ${supervisorProc.pid}:`, err);
    }
    await exitsEventually(supervisorProc, 3000);
}

// a signal was sent is not an exit: observe it
// wait for one client "exit" event; this is the child reporting in
async function exitsOnEvent(client: { off: (ev: string, fn: () => void) => void; on: (ev: string, fn: () => void) => void; isConnected: () => boolean }): Promise<void> {
    if (!client.isConnected()) return;
    await new Promise<void>((resolve) => {
        const timer = setTimeout(done, 3000);
        unrefTimer(timer);
        function done() { clearTimeout(timer); client.off("exit", done); resolve(); }
        client.on("exit", done);
    });
}

async function exitsEventually(proc: ChildProcess, graceMs: number): Promise<boolean> {
    if (proc.exitCode !== null || proc.signalCode !== null) return true;
    return await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), graceMs);
        unrefTimer(timer);
        proc.once("exit", () => { clearTimeout(timer); resolve(true); });
    });
}

function unrefTimer(timer: NodeJS.Timeout): void {
    if (typeof timer.unref === "function") timer.unref();
}
