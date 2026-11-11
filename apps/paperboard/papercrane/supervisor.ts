// The daemon's side of a supervised workload: where a supervisor's endpoint
// is, what it is told to run, and the client that talks to it. The supervisor
// itself is its own small binary (apps/paperboard/supervisor), so a workload
// costs a few megabytes to keep running instead of a whole JavaScript runtime.
import * as net from "net";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { logger } from "./logger";
import { ShellMarks } from "./shellIntegration";
import { unrefTimer } from "./storage";

export const INPUT_ENCODINGS = ["utf8", "utf16le"] as const;
export type InputEncoding = (typeof INPUT_ENCODINGS)[number];

export interface SupervisorSpawnConfig {
    command?: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, string | undefined>;
    isPty?: boolean;
    cols?: number;
    rows?: number;
    appId?: string;
    /** the child's input is closed from the start: a program that reads to its end (codex exec) is not left waiting */
    noStdin?: boolean;
    /**
     * how input text is encoded for the child; default UTF-8. A .NET
     * program on Windows that sets Console.InputEncoding to Unicode reads
     * UTF-16, where UTF-8 text never forms a line
     */
    inputEncoding?: InputEncoding;
    /**
     * Windows: the child's input is an empty console instead of a pipe, for
     * a program that reads a console and fails on a pipe (a Source dedicated
     * server in -console mode); the supervisor runs it behind its console
     * relay. Nothing can
     * be written to it. Elsewhere a pipe is a program's console, so this
     * changes nothing there.
     */
    consoleInput?: boolean;
    /**
     * people rely on it while it runs (a game server): an update of what it
     * runs from waits for it instead of stopping it (engine holdsUpdates)
     */
    important?: boolean;
    /**
     * set by earlier builds, whose supervisors ran from an AppImage mount of
     * their own: the runtime holding that mount (supervisorLaunch.ts)
     */
    mountHolderPid?: number;
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
import { ensurePrivateDir, getSocketsDir } from "./paths";

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

// socket/pipe path for an endpoint name (not an id)
export function supervisorSocketPathForName(name: string): string {
    if (process.platform === "win32") {
        return `\\\\.\\pipe\\papercrane-${name}`;
    }
    const socketsDir = ensurePrivateDir(getSocketsDir());
    return path.join(socketsDir, `${name}.sock`);
}

export function getSupervisorSocketPath(procId: string): string {
    return supervisorSocketPathForName(supervisorEndpointName(procId));
}

export function getSupervisorMetadataPath(procId: string): string {
    const socketsDir = ensurePrivateDir(getSocketsDir());
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
    /** a terminal's foreground program, as the supervisor last named it */
    public foreground = "";
    // a terminal's shell marks its commands and folder in its output
    private marks = new ShellMarks({
        command: (finished) => this.emit("command", finished),
        cwd: (cwd) => this.emit("cwd", cwd),
    });
    /** the folder a terminal's shell last said it is in */
    public get cwd(): string {
        return this.marks.cwd;
    }

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

            // a decoding stream keeps a character split across reads whole
            socket.setEncoding("utf8");
            socket.on("data", (chunk: string) => {
                this.buffer += chunk;
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
                // a replay repeats commands already reported; only the folder
                // it ends in is news to a daemon that just connected
                if (this.isPty && typeof msg.data === "string") this.marks.replay(msg.data);
                this.emit("history", msg.data);
                this.emit("data", msg.data);
                break;
            case "data":
                if (this.isPty && typeof msg.data === "string") this.marks.feed(msg.data);
                this.emit("data", msg.data);
                if (msg.stream === "stdout") this.emit("stdout", msg.data);
                if (msg.stream === "stderr") this.emit("stderr", msg.data);
                break;
            case "foreground":
                if (typeof msg.name === "string" && msg.name) {
                    this.foreground = msg.name;
                    this.emit("foreground", msg.name);
                }
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
