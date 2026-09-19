// in-process supervision for embedded hosts, single daemon lifetime.
// PTYs go through pty.ts like every other host; this file only chooses
// between a pty and plain pipes.
import * as cp from "child_process";
import * as fs from "fs";
import { logger } from "./logger";
import * as os from "os";
import { spawnPty } from "./pty";
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

// mirrors the client surface consumed by the engine
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

        // missing cwd fails fast, create it
        let cwd = this.config.cwd;
        if (cwd && !fs.existsSync(cwd)) {
            try {
                fs.mkdirSync(cwd, { recursive: true });
            } catch (err) { logger.debug("[embeddedSupervisor.ts] op failed:", err) }
            if (!fs.existsSync(cwd)) {
                cwd = undefined;
            }
        }

        try {
            if (this.config.type === "pty" || this.config.isPty) {
                // args are honored for pty spawns too: an argv array of
                // strings only — anything else is a bug, dropped args would
                // silently change what the child runs
                const args = this.config.args;
                let ptyArgs = args ?? [];
                if (!Array.isArray(ptyArgs) || !ptyArgs.every((a) => typeof a === "string")) {
                    logger.warn(
                        `[embedded-supervisor] "${this.config.id}": pty "${args}" is not an array of strings; spawning without args`,
                    );
                    ptyArgs = [];
                }
                this.proc = spawnPty(
                    this.config.command,
                    this.config.cols || 80,
                    this.config.rows || 24,
                    cwd || os.homedir(),
                    buildEnv(this.config),
                    ptyArgs,
                );
            } else {
                this.proc = cp.spawn(
                    this.config.command,
                    this.config.args || [],
                    {
                        cwd: cwd || os.homedir(),
                        env: buildEnv(this.config),
                        stdio: ["pipe", "pipe", "pipe"],
                        windowsHide: true,
                    },
                );
            }

            this.alive = true;
            this.pid = this.proc.pid ?? 0;
            this.childPid = this.proc.pid ?? 0;

            if (this.isPty) {
                this.proc.onData((data: string) => this.emit("data", data));
                this.proc.onExit((code: number) => {
                    this.alive = false;
                    this.emit("exit", code);
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
                    // surface spawn failures on every stream
                    const msg = `[Process Error] ${err.message}`;
                    this.emit("data", msg);
                    this.emit("stderr", msg);
                    this.emit("stdout", msg);
                    this.alive = false;
                    this.emit("exit", 1);
                });
            }

            return true;
        } catch (err) {
            // spawn itself failed (bad binary, bad cwd): the exit code
            // below is not enough — the WHY must be logged, not swallowed
            logger.error(`[embedded-supervisor] spawn failed for "${this.config?.id ?? "unknown"}":`, err);
            this.alive = false;
            this.emit("exit", 1);
            return false;
        }
    }

    public isConnected(): boolean {
        return this.alive;
    }

    public write(data: string): void {
        // pty uses write(), pipes use stdin
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
        } catch (err) { logger.debug("[embeddedSupervisor.ts] op failed:", err) }
        this.alive = false;
    }

    public destroy(): void {
        this.kill();
        this.listeners.clear();
    }
}
