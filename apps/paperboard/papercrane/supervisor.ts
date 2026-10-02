import * as net from "net";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as cp from "child_process";
import * as crypto from "crypto";
import { spawnPty, getDefaultShell } from "./pty";
import { IPtyProcess } from "./types";
import { logger } from "./logger";
import { redactEnvValues, unrefTimer } from "./storage";

export interface SupervisorSpawnConfig {
    command?: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, string | undefined>;
    isPty?: boolean;
    cols?: number;
    rows?: number;
    appId?: string;
}

export interface SupervisorMetadata {
    id: string;
    pid: number;
    childPid: number;
    isPty: boolean;
    startedAt: string;
    config: SupervisorSpawnConfig;
}

export { getPaperboardDir } from "./paths";
import { ensureDir, getSocketsDir } from "./paths";

// Endpoint names are one-to-one with ids. The old scheme replaced every
// character outside [a-zA-Z0-9_-] with "_", so "a.b" and "a_b" shared one
// socket: a second spawn unlinked the first's live socket (orphaning its
// workload) and an id another panel owned could be reached under a sibling
// spelling. A fixed-length digest also keeps unix socket paths under the
// 104/108-byte limit for any 128-character id.
export function supervisorEndpointName(procId: string): string {
    if (!procId || typeof procId !== "string") {
        throw new Error("supervisor id is required");
    }
    return crypto.createHash("sha256").update(procId, "utf8").digest("hex").slice(0, 32);
}

// TODO(remove after v0.2): the pre-digest endpoint name, used only to
// recover supervisors that were started before the rename and are still
// running (engine.recoverRunningSupervisors)
export function legacySupervisorEndpointName(procId: string): string {
    return procId.replace(/[^a-zA-Z0-9_-]/g, "_");
}

// socket/pipe path for an endpoint name (not an id)
export function supervisorSocketPathForName(name: string): string {
    if (process.platform === "win32") {
        return `\\\\.\\pipe\\papercrane-${name}`;
    }
    const socketsDir = ensureDir(getSocketsDir());
    return path.join(socketsDir, `${name}.sock`);
}

export function getSupervisorSocketPath(procId: string): string {
    return supervisorSocketPathForName(supervisorEndpointName(procId));
}

export function getSupervisorMetadataPath(procId: string): string {
    const socketsDir = ensureDir(getSocketsDir());
    return path.join(socketsDir, `${supervisorEndpointName(procId)}.json`);
}

/**
 * Whether a supervisor endpoint is present enough to attempt a connect.
 * On Windows the endpoint is a named pipe; `fs.existsSync` cannot see a
 * live pipe, so a check against the pipe path is always false and an
 * orphaned supervisor is never found. The metadata file written beside the
 * pipe is the on-disk presence fact there; the connect remains the actual
 * liveness probe (a stale metadata file simply fails to connect).
 */
export function supervisorPresent(
    procId: string,
    platform: NodeJS.Platform = process.platform,
): boolean {
    return platform === "win32"
        ? fs.existsSync(getSupervisorMetadataPath(procId))
        : fs.existsSync(getSupervisorSocketPath(procId));
}

// client for a detached supervisor over IPC socket
export class SupervisedProcessClient {
    private socket: net.Socket | null = null;
    private buffer = "";
    private isConnectedState = false;
    private hasConnectedOnce = false;
    private isManuallyClosed = false;
    private messageQueue: string[] = [];
    private hasExited = false;
    private exitCode = 0;
    private listeners = new Map<string, Function[]>();
    private status: { error?: string } | null = null;

    public pid = 0;
    public childPid = 0;
    public isPty = false;

    constructor(
        public readonly id: string,
        private readonly socketPath: string = getSupervisorSocketPath(id),
    ) {}

    public isConnected(): boolean {
        return this.isConnectedState;
    }

    public on(event: string, callback: Function) {
        if (!this.listeners.has(event)) this.listeners.set(event, []);
        this.listeners.get(event)!.push(callback);
        return this;
    }

    public off(event: string, callback: Function) {
        const list = this.listeners.get(event);
        if (!list) return;
        const index = list.indexOf(callback);
        if (index !== -1) list.splice(index, 1);
    }

    private emit(event: string, ...args: any[]) {
        this.listeners.get(event)?.forEach((cb) => cb(...args));
    }

    public connect(): Promise<boolean> {
        return new Promise((resolve) => {
            const socket = net.connect(this.socketPath);
            this.socket = socket;

            const connectTimeout = setTimeout(() => {
                if (!this.isConnectedState) {
                    socket.destroy();
                    resolve(false);
                }
            }, 1500);
            // a pending connect must never hold the client process open
            unrefTimer(connectTimeout);

            socket.on("connect", () => {
                clearTimeout(connectTimeout);
                this.isConnectedState = true;
                this.hasConnectedOnce = true;
                this.send({ type: "attach" });
                while (this.messageQueue.length > 0) {
                    socket.write(this.messageQueue.shift()!);
                }
                resolve(true);
            });

            socket.on("data", (chunk) => {
                this.buffer += chunk.toString("utf8");
                const lines = this.buffer.split("\n");
                this.buffer = lines.pop() || "";

                for (const line of lines) {
                    if (!line.trim()) continue;
                    try {
                        const msg = JSON.parse(line);
                        this.handleMessage(msg);
                    } catch (err) { logger.debug("[supervisor.ts] op failed:", err) }
                }
            });

            socket.on("error", () => {
                clearTimeout(connectTimeout);
                if (!this.isConnectedState) resolve(false);
            });

            socket.on("close", () => {
                this.isConnectedState = false;
                if (this.hasConnectedOnce && !this.hasExited && !this.isManuallyClosed) {
                    this.hasExited = true;
                    this.emit("exit", this.exitCode);
                }
            });
        });
    }

    private handleMessage(msg: any) {
        switch (msg.type) {
            case "status":
                this.pid = msg.pid;
                this.childPid = msg.childPid;
                this.isPty = Boolean(msg.isPty);
                this.status = { error: typeof msg.error === "string" ? msg.error : undefined };
                this.emit("status", this.status);
                break;
            case "history":
                this.emit("history", msg.data);
                this.emit("data", msg.data);
                break;
            case "data":
                this.emit("data", msg.data);
                if (msg.stream === "stdout") this.emit("stdout", msg.data);
                if (msg.stream === "stderr") this.emit("stderr", msg.data);
                break;
            case "exit":
                this.exitCode = msg.code ?? 0;
                if (!this.hasExited && !this.isManuallyClosed) {
                    this.hasExited = true;
                    this.emit("exit", this.exitCode);
                }
                break;
        }
    }

    /**
     * Resolves once the supervisor has reported whether its workload
     * started. An open pipe only proves the supervisor is listening; the
     * spawn behind it can still have failed (a missing pty backend, a bad
     * cwd), and that failure is the caller's error, not a later exit.
     */
    public awaitStarted(timeoutMs = 5000): Promise<void> {
        return new Promise((resolve, reject) => {
            const settle = (status: { error?: string }) => {
                clearTimeout(timer);
                this.off("status", settle);
                this.off("exit", onExit);
                if (status.error) reject(new Error(status.error));
                else resolve();
            };
            const onExit = () => settle(this.status ?? { error: `Supervisor ${this.id} exited before reporting a start` });
            const timer = setTimeout(
                () => settle({ error: `Supervisor ${this.id} did not report a start within ${timeoutMs}ms` }),
                timeoutMs,
            );
            unrefTimer(timer);
            if (this.status) return settle(this.status);
            this.on("status", settle);
            this.on("exit", onExit);
        });
    }

    public write(data: string) {
        this.send({ type: "stdin", data });
    }

    public resize(cols: number, rows: number) {
        this.send({ type: "resize", cols, rows });
    }

    public kill(signal: string = "SIGTERM") {
        this.send({ type: "kill", signal });
    }

    private send(obj: Record<string, any>) {
        const payload = JSON.stringify(obj) + "\n";
        if (this.isConnectedState && this.socket && !this.socket.destroyed) {
            this.socket.write(payload);
        } else {
            this.messageQueue.push(payload);
        }
    }

    public destroy() {
        this.isManuallyClosed = true;
        if (this.socket && !this.socket.destroyed) {
            this.socket.destroy();
        }
        this.socket = null;
        this.isConnectedState = false;
        this.listeners.clear();
    }
}

// ring buffer for reconnect replay
class CircularBuffer {
    private buffer: string[] = [];
    private currentSize = 0;

    constructor(private readonly maxSize = 64 * 1024) {}

    public push(chunk: string) {
        this.buffer.push(chunk);
        this.currentSize += Buffer.byteLength(chunk, "utf8");
        while (this.currentSize > this.maxSize && this.buffer.length > 0) {
            const removed = this.buffer.shift()!;
            this.currentSize -= Buffer.byteLength(removed, "utf8");
        }
    }

    public getAll(): string {
        return this.buffer.join("");
    }
}

// how long a supervisor whose workload failed to start waits for the
// spawning daemon to connect and read why
const START_FAILURE_LINGER_MS = 10_000;

// detached supervisor serving output over socket/pipe
export async function runSupervisor(procId: string): Promise<void> {
    const socketPath = getSupervisorSocketPath(procId);
    const metadataPath = getSupervisorMetadataPath(procId);

    // Read spawn config from stdin
    const rawConfig = await new Promise<string>((resolve) => {
        let input = "";
        const timer = setTimeout(() => resolve(input), 3000);
        unrefTimer(timer);
        process.stdin.setEncoding("utf8");
        process.stdin.on("data", (chunk) => { input += chunk; });
        process.stdin.on("end", () => {
            clearTimeout(timer);
            resolve(input);
        });
    });

    let config: SupervisorSpawnConfig = {};
    try {
        if (rawConfig.trim()) config = JSON.parse(rawConfig.trim());
    } catch (err) {
        // a supervisor that cannot read its spawn config must die loudly,
        // never sit on the socket with zero config
        console.error("[supervisor] invalid spawn config on stdin, exiting:", err);
        process.exit(1);
    }

    if (process.platform !== "win32" && fs.existsSync(socketPath)) {
        try { fs.unlinkSync(socketPath); } catch (err) { logger.debug("[supervisor.ts] op failed:", err) }
    }

    const ringBuffer = new CircularBuffer(64 * 1024);
    const clients = new Set<net.Socket>();
    let childPid = 0;
    let isExited = false;
    let ptyInstance: IPtyProcess | null = null;
    let childProcess: cp.ChildProcess | null = null;
    // why the workload never started; reported in the status frame so the
    // spawning daemon fails its create call with this reason
    let startError: string | null = null;

    const broadcast = (msgObj: Record<string, any>) => {
        const payload = JSON.stringify(msgObj) + "\n";
        for (const client of clients) {
            try {
                if (!client.destroyed) client.write(payload);
            } catch (err) { logger.debug("[supervisor.ts] op failed:", err) }
        }
    };

    const cleanupAndExit = (code: number) => {
        if (isExited) return;
        isExited = true;
        broadcast({ type: "exit", code });

        for (const client of clients) {
            try { client.end(); } catch (err) { logger.debug("[supervisor.ts] op failed:", err) }
        }
        try { if (fs.existsSync(metadataPath)) fs.unlinkSync(metadataPath); } catch (err) { logger.debug("[supervisor.ts] op failed:", err) }
        try { if (process.platform !== "win32" && fs.existsSync(socketPath)) fs.unlinkSync(socketPath); } catch (err) { logger.debug("[supervisor.ts] op failed:", err) }

        // exit timers never hold the supervisor open: the inner force-exit
        // is already unref'd; the outer close gets the same treatment
        const exitTimer = setTimeout(() => {
            server.close(() => process.exit(code));
            setTimeout(() => process.exit(code), 200).unref();
        }, 40);
        unrefTimer(exitTimer);
    };

    const server = net.createServer((socket) => {
        clients.add(socket);
        socket.write(
            JSON.stringify({
                type: "status",
                pid: process.pid,
                childPid,
                running: !isExited,
                isPty: Boolean(config.isPty),
                ...(startError ? { error: startError } : {}),
            }) + "\n",
        );
        // the status frame carried the failure; this client was the one
        // waiting for it, so the supervisor's job is done
        if (startError) cleanupAndExit(1);

        let socketBuffer = "";
        socket.on("data", (chunk) => {
            socketBuffer += chunk.toString("utf8");
            const lines = socketBuffer.split("\n");
            socketBuffer = lines.pop() || "";
            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const msg = JSON.parse(line);
                    if (msg.type === "attach") {
                        const history = ringBuffer.getAll();
                        if (history) socket.write(JSON.stringify({ type: "history", data: history }) + "\n");
                    } else if (msg.type === "stdin" && typeof msg.data === "string") {
                        if (ptyInstance) ptyInstance.write(msg.data);
                        else childProcess?.stdin?.write(msg.data);
                    } else if (msg.type === "resize" && ptyInstance) {
                        ptyInstance.resize(msg.cols, msg.rows);
                    } else if (msg.type === "kill") {
                        if (ptyInstance) ptyInstance.kill();
                        else childProcess?.kill(msg.signal || "SIGTERM");
                    }
                } catch (err) { logger.debug("[supervisor.ts] op failed:", err) }
            }
        });

        socket.on("close", () => clients.delete(socket));
        socket.on("error", () => clients.delete(socket));
    });

    // a workload that cannot start stays failed: the supervisor keeps
    // listening just long enough for the spawning daemon to read the reason
    // from the status frame, then exits. No metadata is written, so nothing
    // mistakes the dead supervisor for a live one.
    const failStart = (msg: string) => {
        startError = msg;
        logger.error(`[supervisor:${procId}] ${msg}`);
        ringBuffer.push(`\n${msg}\n`);
        const giveUp = setTimeout(() => cleanupAndExit(1), START_FAILURE_LINGER_MS);
        unrefTimer(giveUp);
    };

    server.listen(socketPath, () => {
        // explicit but missing cwd must fail with its path attached
        let finalCwd: string;
        if (config.cwd) {
            if (!fs.existsSync(config.cwd)) {
                failStart(`Working directory does not exist: ${config.cwd}`);
                return;
            }
            finalCwd = config.cwd;
        } else {
            finalCwd = os.homedir();
        }
        try {
            logger.debug(`[supervisor:${procId}] spawning ${config.command || "sh"} in ${finalCwd}`);
        } catch (err) { logger.debug("[supervisor.ts] op failed:", err) }
        const isPtyMode = Boolean(config.isPty || (config as any).type === "pty");

        if (isPtyMode) {
            const shell = config.command || getDefaultShell();
            const cols = config.cols || 80;
            const rows = config.rows || 24;
            const finalEnv = {
                ...process.env,
                TERM_PROGRAM: "Paperboard",
                TERM: "xterm-256color",
                COLORTERM: "truecolor",
                ...(config.env || {}),
            };

            try {
                ptyInstance = spawnPty(shell, cols, rows, finalCwd, finalEnv);
            } catch (err) {
                // no tty backend available is a spawn failure, not a pipe shell
                failStart(`Could not start a terminal: ${(err as Error).message}`);
                return;
            }
            ptyInstance.onData((data) => {
                ringBuffer.push(data);
                broadcast({ type: "data", stream: "stdout", data });
            });
            ptyInstance.onExit((code) => cleanupAndExit(code));
        } else {
            const command = config.command || "sh";
            const args = config.args || [];
            const mergedEnv = { ...process.env, ...(config.env || {}) };
            if (config.env?.JAVA_HOME) {
                const delim = process.platform === "win32" ? ";" : ":";
                mergedEnv.PATH = `${config.env.JAVA_HOME}/bin${delim}${mergedEnv.PATH || ""}`;
            }

            childProcess = cp.spawn(command, args, { cwd: finalCwd, env: mergedEnv, windowsHide: true });
            childPid = childProcess.pid || 0;

            childProcess.stdout?.on("data", (chunk) => {
                const str = chunk.toString("utf8");
                ringBuffer.push(str);
                broadcast({ type: "data", stream: "stdout", data: str });
            });
            childProcess.stderr?.on("data", (chunk) => {
                const str = chunk.toString("utf8");
                ringBuffer.push(str);
                broadcast({ type: "data", stream: "stderr", data: str });
            });
            childProcess.on("close", (code) => cleanupAndExit(code ?? 0));
            childProcess.on("error", (err) => {
                const str = `\n[Process Error] ${err.message}\n`;
                ringBuffer.push(str);
                broadcast({ type: "data", stream: "stderr", data: str });
                cleanupAndExit(1);
            });
        }

        const meta: SupervisorMetadata = {
            id: procId,
            pid: process.pid,
            childPid: childPid || process.pid,
            isPty: Boolean(config.isPty),
            startedAt: new Date().toISOString(),
            // env travels with secrets (bot tokens live here): names that
            // look like secrets are stored redacted, never with values
            config: { ...config, env: redactEnvValues(config.env) },
        };
        try {
            fs.writeFileSync(metadataPath, JSON.stringify(meta, null, 2), "utf8");
        } catch (err) { logger.debug("[supervisor.ts] op failed:", err) }
    });

    process.on("SIGTERM", () => cleanupAndExit(0));
    process.on("SIGINT", () => cleanupAndExit(0));
}
