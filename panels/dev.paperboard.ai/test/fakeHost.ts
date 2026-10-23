// A stand-in for the daemon's process API: children are records, their
// output and exit are driven by the test.

import type { StartOptions } from "../src/service/computer";

type Listener<T> = (v: T) => void;

export class FakeProcesses {
    started: StartOptions[] = [];
    killed: { id: string; signal?: string }[] = [];
    alive = new Set<string>();
    private listeners = { stdout: new Map<string, Set<Listener<string>>>(), stderr: new Map<string, Set<Listener<string>>>(), exit: new Map<string, Set<Listener<number | undefined>>>() };
    /** what kill does to a child: by default it exits at once */
    exitOnKill = true;
    /** what the child does once started, when a test plays it */
    onStart: ((o: StartOptions) => void | Promise<void>) | null = null;

    start = async (o: StartOptions) => {
        this.started.push(o);
        this.alive.add(o.id);
        await this.onStart?.(o);
        return { id: o.id };
    };
    kill = async (id: string, signal?: string) => {
        this.killed.push({ id, signal });
        if (this.exitOnKill) queueMicrotask(() => this.exit(id, signal === "SIGKILL" ? 137 : 143));
    };
    exists = async (id: string) => this.alive.has(id);
    written: { id: string; data: string }[] = [];
    write = async (id: string, data: string) => {
        if (!this.alive.has(id)) throw new Error(`${id} isn't running`);
        this.written.push({ id, data });
    };
    onStdout = (id: string, cb: Listener<string>) => this.on("stdout", id, cb);
    onStderr = (id: string, cb: Listener<string>) => this.on("stderr", id, cb);
    onExit = (id: string, cb: Listener<number | undefined>) => this.on("exit", id, cb);

    stdout(id: string, data: string) {
        for (const cb of [...(this.listeners.stdout.get(id) ?? [])]) cb(data);
    }
    exit(id: string, code: number | undefined) {
        if (!this.alive.delete(id)) return;
        for (const cb of [...(this.listeners.exit.get(id) ?? [])]) cb(code);
    }
    listenerCount() {
        let n = 0;
        for (const m of Object.values(this.listeners)) for (const s of m.values()) n += s.size;
        return n;
    }

    private on<T>(kind: keyof FakeProcesses["listeners"], id: string, cb: Listener<T>) {
        const map = this.listeners[kind] as Map<string, Set<Listener<T>>>;
        const set = map.get(id) ?? new Set();
        map.set(id, set);
        set.add(cb);
        return () => set.delete(cb);
    }
}

export async function until(cond: () => boolean, ms = 2000) {
    const end = Date.now() + ms;
    while (!cond()) {
        if (Date.now() > end) throw new Error("timed out waiting");
        await new Promise((r) => setTimeout(r, 5));
    }
}
