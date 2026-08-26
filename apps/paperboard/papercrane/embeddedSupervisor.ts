// In-process supervision for embedded PaperCrane (running inside Electron).
//
// The detached supervisor model spawns process.execPath --supervise, which
// requires a Bun/Node runtime. Inside Electron, execPath is the Electron
// binary itself, so we supervise directly here instead: node-pty for
// terminals, child_process for background processes. Behavior parity with
// the detached supervisor is limited to a single daemon lifetime — embedded
// sessions do not survive app restarts (by design; dispose() kills them).
//
// NOTE: node-pty is resolved lazily via require because papercrane must not
// hard-depend on it (standalone daemons use the Bun FFI pty instead).

import * as cp from "child_process";
import * as os from "os";
import type { PaperCraneClientLike } from "./supervisorTypes";

export function isEmbeddedHost(): boolean {
    const g = globalThis as any;
    return !g.Bun && !!(process as any).versions?.electron;
}

interface SupervisorConfig {
    id: string;
    type?: string;
    isPty?: boolean;
    command: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
    cols?: number;
    rows?: number;
}

function buildEnv(config: SupervisorConfig): Record<string, string> {
    const merged = { ...process.env, ...(config.env || {}) } as Record<
        string,
        string
    >;
    if (config.env?.JAVA_HOME) {
        const delim = process.platform === "win32" ? ";" : ":";
        merged.PATH = `${config.env.JAVA_HOME}/bin${delim}${merged.PATH || ""}`;
    }
    return merged;
}

// Mirrors the SupervisedProcessClient surface consumed by the engine.
export class EmbeddedSupervisor implements PaperCraneClientLike {
    public pid = 0;
    public childPid = 0;
    public isPty: boolean;

    private listeners = new Map<string, Function[]>();
    private proc: any = null;
    private alive = false;

    constructor(
        public readonly id: string,
        private readonly config: SupervisorConfig,
    ) {
        this.isPty = Boolean(config.isPty);
    }

    private emit(event: string, ...args: any[]) {
        this.listeners.get(event)?.forEach((cb) => cb(...args));
    }

    public on(event: string, cb: Function): this {
        if (!this.listeners.has(event)) this.listeners.set(event, []);
        this.listeners.get(event)!.push(cb);
        return this;
    }

    public off(event: string, cb: Function): this {
        const list = this.listeners.get(event);
        if (!list) return this;
        const index = list.indexOf(cb);
        if (index !== -1) list.splice(index, 1);
        return this;
    }

    public async connect(): Promise<boolean> {
        if (this.alive) return true;

        // Resolve the working directory defensively: panels often point at
        // directories that do not exist yet (first boot of a server). A
        // missing cwd makes child_process fail instantly with ENOENT.
        let cwd = this.config.cwd;
        if (cwd && !require("fs").existsSync(cwd)) {
            try {
                require("fs").mkdirSync(cwd, { recursive: true });
            } catch {}
            if (!require("fs").existsSync(cwd)) {
                cwd = undefined;
            }
        }

        try {
            if (this.config.type === "pty" || this.config.isPty) {
                // eslint-disable-next-line @typescript-eslint/no-var-requires
                const pty = require("node-pty");
                this.proc = pty.spawn(this.config.command, [], {
                    name: "xterm-256color",
                    cols: this.config.cols || 80,
                    rows: this.config.rows || 24,
                    cwd: cwd || os.homedir(),
                    env: buildEnv(this.config),
                });
            } else {
                this.proc = cp.spawn(
                    this.config.command,
                    this.config.args || [],
                    {
                        cwd: cwd || os.homedir(),
                        env: buildEnv(this.config),
                        stdio: ["pipe", "pipe", "pipe"],
                    },
                );
            }

            this.alive = true;
            this.pid = this.proc.pid ?? 0;
            this.childPid = this.proc.pid ?? 0;

            if (this.isPty) {
                this.proc.onData((data: string) => this.emit("data", data));
                this.proc.onExit((e: { exitCode?: number }) => {
                    this.alive = false;
                    this.emit("exit", e.exitCode ?? 0);
                });
            } else {
                this.proc.stdout?.on("data", (chunk: Buffer) =>
                    this.emit("data", chunk.toString("utf8")),
                );
                this.proc.stderr?.on("data", (chunk: Buffer) => {
                    this.emit("stderr", chunk.toString("utf8"));
                    this.emit("data", chunk.toString("utf8"));
                });
                this.proc.stdout?.on("data", (chunk: Buffer) =>
                    this.emit("stdout", chunk.toString("utf8")),
                );
                this.proc.on("close", (code: number | null) => {
                    this.alive = false;
                    this.emit("exit", code ?? 0);
                });
                this.proc.on("error", (err: Error) => {
                    // Surface spawn failures (missing binary, bad cwd, …) on
                    // every stream so consoles actually show WHY it died.
                    const msg = `[Process Error] ${err.message}`;
                    this.emit("data", msg);
                    this.emit("stderr", msg);
                    this.emit("stdout", msg);
                    this.alive = false;
                    this.emit("exit", 1);
                });
            }

            return true;
        } catch {
            this.alive = false;
            this.emit("exit", 1);
            return false;
        }
    }

    public isConnected(): boolean {
        return this.alive;
    }

    public write(data: string): void {
        // PTY processes expose write(); child_process pipes go through stdin.
        if (this.isPty) this.proc?.write?.(data);
        else this.proc?.stdin?.write(data);
    }

    public resize(cols: number, rows: number): void {
        this.proc?.resize?.(cols, rows);
    }

    public kill(signal: string = "SIGTERM"): void {
        try {
            if (this.isPty) this.proc?.kill();
            else this.proc?.kill(signal as NodeJS.Signals);
        } catch {}
        this.alive = false;
    }

    public destroy(): void {
        this.kill();
        this.listeners.clear();
    }
}
