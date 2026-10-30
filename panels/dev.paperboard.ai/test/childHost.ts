// The agent process surface over real child processes, for tests: the same
// argv spawn, stdio and exit events the daemon's supervisor gives processApi,
// without a daemon. Every child it starts is killed by stopAll.
import { spawn, type ChildProcess } from "node:child_process";
import type { AgentProcessHost } from "../src/service/agents";

type Listener<T> = Set<(v: T) => void>;

export class ChildHost implements AgentProcessHost {
    readonly children = new Map<string, ChildProcess>();
    readonly starts: { id: string; command: string; args: string[]; cwd: string }[] = [];
    readonly writes: string[] = [];
    private stdout = new Map<string, Listener<string>>();
    private stderr = new Map<string, Listener<string>>();
    private exits = new Map<string, Listener<number | undefined>>();

    private listeners<T>(map: Map<string, Listener<T>>, id: string): Listener<T> {
        let set = map.get(id);
        if (!set) map.set(id, (set = new Set()));
        return set;
    }

    private on<T>(map: Map<string, Listener<T>>, id: string, cb: (v: T) => void): () => void {
        const set = this.listeners(map, id);
        set.add(cb);
        return () => set.delete(cb);
    }

    async start(options: { id: string; command: string; args: string[]; cwd: string; env: Record<string, string> }): Promise<unknown> {
        if (this.children.has(options.id)) throw new Error(`${options.id} is already running`);
        this.starts.push({ id: options.id, command: options.command, args: options.args, cwd: options.cwd });
        const child = spawn(options.command, options.args, { cwd: options.cwd, env: { ...process.env, ...options.env }, stdio: "pipe" });
        this.children.set(options.id, child);
        child.stdout!.setEncoding("utf8");
        child.stderr!.setEncoding("utf8");
        child.stdout!.on("data", (d: string) => this.listeners(this.stdout, options.id).forEach((cb) => cb(d)));
        child.stderr!.on("data", (d: string) => this.listeners(this.stderr, options.id).forEach((cb) => cb(d)));
        child.stdin!.on("error", () => undefined);
        child.on("exit", (code) => {
            this.children.delete(options.id);
            this.listeners(this.exits, options.id).forEach((cb) => cb(code ?? undefined));
        });
        return { pid: child.pid };
    }

    async kill(id: string, signal = "SIGTERM"): Promise<void> {
        this.children.get(id)?.kill(signal as NodeJS.Signals);
    }

    async exists(id: string): Promise<boolean> {
        return this.children.has(id);
    }

    async write(id: string, data: string): Promise<void> {
        if (data.length > 65536) throw new Error("process:write takes at most 65536 characters");
        const child = this.children.get(id);
        if (!child) throw new Error(`${id} is not running`);
        this.writes.push(data);
        await new Promise<void>((resolve, reject) => child.stdin!.write(data, (err) => (err ? reject(err) : resolve())));
    }

    onStdout(id: string, cb: (data: string) => void): () => void {
        return this.on(this.stdout, id, cb);
    }

    onStderr(id: string, cb: (data: string) => void): () => void {
        return this.on(this.stderr, id, cb);
    }

    onExit(id: string, cb: (code?: number) => void): () => void {
        return this.on(this.exits, id, cb);
    }

    /** Kills whatever a test left running and waits for each exit. */
    async stopAll(): Promise<void> {
        await Promise.all(
            [...this.children.values()].map(
                (child) =>
                    new Promise<void>((resolve) => {
                        child.once("exit", () => resolve());
                        child.kill("SIGKILL");
                    }),
            ),
        );
    }
}
