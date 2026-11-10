// The daemon's side of the panel's process and package APIs, for tests: real
// child processes, real stdio, real exit codes. Every program the tests start
// is a small JavaScript file of their own, run with the test's own runtime
// (process.execPath), so the same host works on every release target.

import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface StartOptions {
    id: string;
    command: string;
    args: string[];
    cwd?: string;
    env?: Record<string, string>;
    stdin?: boolean;
}

type Listener = (data: string) => void;
type ExitListener = (code?: number) => void;

const WAIT_MS = 15_000;
/** a test that runs real programs: past any wait it does, so a wait fails with its own reason */
export const SLOW = 30_000;

/** A temp folder the test owns; removed by `cleanup`. */
export function tempDir(label = "agents"): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), `pb-${label}-`));
}

/** Resolves when `check` holds, re-checked each time `subscribe` reports a change; fails with `what` past the deadline. */
export function until(subscribe: (changed: () => void) => () => void, check: () => boolean, what: string, ms = WAIT_MS): Promise<void> {
    return new Promise((ok, fail) => {
        if (check()) return ok();
        let off = () => {};
        const timer = setTimeout(() => {
            off();
            fail(new Error(`timed out after ${ms} ms waiting for ${what}`));
        }, ms);
        off = subscribe(() => {
            if (!check()) return;
            clearTimeout(timer);
            off();
            ok();
        });
    });
}

/** Values pushed by the code under test (state, entries, events), awaitable. */
export class Recorder<T> {
    readonly items: T[] = [];
    private watchers = new Set<() => void>();
    push = (item: T) => {
        this.items.push(item);
        for (const w of [...this.watchers]) w();
    };
    subscribe = (cb: () => void) => {
        this.watchers.add(cb);
        return () => this.watchers.delete(cb);
    };
    until(check: (items: T[]) => boolean, what: string, ms?: number) {
        return until(this.subscribe, () => check(this.items), what, ms);
    }
    last(): T | undefined {
        return this.items.at(-1);
    }
}

export class TestHost {
    readonly started: StartOptions[] = [];
    readonly kills: { id: string; signal?: string }[] = [];
    readonly writes: { id: string; data: string }[] = [];
    readonly execs: { command: string; args: string[]; env?: Record<string, string> }[] = [];
    private procs = new Map<string, ChildProcess>();
    private stdout = new Map<string, Set<Listener>>();
    private stderr = new Map<string, Set<Listener>>();
    private exits = new Map<string, Set<ExitListener>>();
    private changes = new Recorder<string>();
    /** everything each process printed, by id, as it arrived */
    readonly output = new Map<string, string>();

    /** `env`: added to every program's environment (where the fakes keep their logs) */
    constructor(private env: Record<string, string> = {}) {}

    private on<T>(map: Map<string, Set<T>>, id: string, cb: T): () => void {
        let set = map.get(id);
        if (!set) map.set(id, (set = new Set()));
        set.add(cb);
        return () => set!.delete(cb);
    }

    start = async (o: StartOptions): Promise<unknown> => {
        if (this.procs.has(o.id)) throw new Error(`${o.id} is already running`);
        this.started.push(structuredClone(o));
        const child = spawn(process.execPath, [o.command, ...o.args], {
            cwd: o.cwd,
            env: { ...process.env, ...this.env, ...o.env },
            stdio: [o.stdin === false ? "ignore" : "pipe", "pipe", "pipe"],
            windowsHide: true,
        });
        await new Promise<void>((ok, fail) => {
            child.once("spawn", ok);
            child.once("error", fail);
        });
        this.procs.set(o.id, child);
        this.output.set(o.id, "");
        child.stdout!.setEncoding("utf8").on("data", (d: string) => {
            this.output.set(o.id, this.output.get(o.id) + d);
            for (const cb of [...(this.stdout.get(o.id) ?? [])]) cb(d);
            this.changes.push(o.id);
        });
        child.stderr!.setEncoding("utf8").on("data", (d: string) => {
            for (const cb of [...(this.stderr.get(o.id) ?? [])]) cb(d);
        });
        child.once("close", (code) => {
            if (this.procs.get(o.id) === child) this.procs.delete(o.id);
            for (const cb of [...(this.exits.get(o.id) ?? [])]) cb(code ?? undefined);
            this.changes.push(o.id);
        });
        return { id: o.id };
    };

    kill = async (id: string, signal?: string): Promise<void> => {
        this.kills.push({ id, signal });
        const child = this.procs.get(id);
        if (!child) throw new Error(`${id} isn't running`);
        child.kill((signal ?? "SIGTERM") as NodeJS.Signals);
    };

    exists = async (id: string): Promise<boolean> => this.procs.has(id);

    write = async (id: string, data: string): Promise<void> => {
        const child = this.procs.get(id);
        if (!child?.stdin) throw new Error(`${id} has no input to write to`);
        this.writes.push({ id, data });
        await new Promise<void>((ok, fail) => child.stdin!.write(data, (e) => (e ? fail(e) : ok())));
    };

    onStdout = (id: string, cb: Listener) => this.on(this.stdout, id, cb);
    onStderr = (id: string, cb: Listener) => this.on(this.stderr, id, cb);
    onExit = (id: string, cb: ExitListener) => this.on(this.exits, id, cb);

    exec = async (command: string, args: string[], o?: { timeoutMs?: number; env?: Record<string, string> }) => {
        this.execs.push({ command, args, env: o?.env });
        const child = spawn(process.execPath, [command, ...args], { env: { ...process.env, ...this.env, ...o?.env }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
        let stdout = "";
        let stderr = "";
        child.stdout.setEncoding("utf8").on("data", (d: string) => (stdout += d));
        child.stderr.setEncoding("utf8").on("data", (d: string) => (stderr += d));
        const timer = setTimeout(() => child.kill("SIGKILL"), o?.timeoutMs ?? WAIT_MS);
        const exitCode = await new Promise<number>((ok, fail) => {
            child.once("error", fail);
            child.once("close", (code) => ok(code ?? -1));
        });
        clearTimeout(timer);
        return { stdout, stderr, exitCode };
    };

    /** Resolves once the process with this id has printed `text`. */
    printed(id: string, text: string, ms?: number) {
        return until(this.changes.subscribe, () => (this.output.get(id) ?? "").includes(text), `${id} to print ${JSON.stringify(text)}`, ms);
    }

    /** Resolves once nothing with this id is running. */
    gone(id: string, ms?: number) {
        return until(this.changes.subscribe, () => !this.procs.has(id), `${id} to exit`, ms);
    }

    startedAs(id: string): StartOptions[] {
        return this.started.filter((s) => s.id === id);
    }

    /** Stop whatever the test left running and observe it gone. */
    async close() {
        const left = [...this.procs.entries()];
        await Promise.all(
            left.map(([id, child]) => {
                const closed = new Promise<void>((ok) => child.once("close", () => ok()));
                child.kill("SIGKILL");
                return closed.then(() => this.procs.delete(id));
            }),
        );
    }
}

/** The daemon's packages: each one installed at a folder of the test's. */
export function packageHost(installed: Record<string, string>) {
    return {
        isInstalled: async (name: string) => name in installed,
        download: async (name: string) => {
            throw new Error(`the test has no download for ${name}`);
        },
        getPath: async (name: string) => {
            const dir = installed[name];
            if (!dir) throw new Error(`${name} isn't installed`);
            return dir;
        },
        version: async (name: string) => (name in installed ? "1.0.0" : null),
        updateWaiting: async () => false,
    };
}

export const FAKE_BRAIN = path.join(import.meta.dir, "fakeBrain.mjs");

const PROGRAMS = { codex: "codex", "claude-code": "claude", opencode: "opencode" } as const;

/**
 * A brain's daemon package: <dir>/bin/<program> is the fake brain, which acts as the harness its name says.
 * Returns the package folder.
 */
export function brainPackage(root: string, harness: keyof typeof PROGRAMS, platform: NodeJS.Platform = process.platform): string {
    const dir = path.join(root, "packages", harness);
    fs.mkdirSync(path.join(dir, "bin"), { recursive: true });
    const exe = path.join(dir, "bin", PROGRAMS[harness] + (platform === "win32" ? ".exe" : ""));
    fs.copyFileSync(FAKE_BRAIN, exe);
    return dir;
}

/** A copy of the fake brain named as the harness's program, outside any package: for a turn's `resolve`. */
export function brainProgram(root: string, harness: keyof typeof PROGRAMS): string {
    const dir = path.join(root, "programs");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${PROGRAMS[harness]}.mjs`);
    fs.copyFileSync(FAKE_BRAIN, file);
    return file;
}

/** What the fake brain logged: one JSON object per line. */
export function fakeLog(dir: string): any[] {
    const file = path.join(dir, "calls.jsonl");
    if (!fs.existsSync(file)) return [];
    return fs
        .readFileSync(file, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l));
}

/** Tell the fake brain how to behave next (see fakeBrain.mjs). */
export function plan(dir: string, p: Record<string, unknown>) {
    fs.writeFileSync(path.join(dir, "plan.json"), JSON.stringify(p));
}

/** Let a fake brain that's holding (told `[[hold]]`) go on. */
export function release(dir: string, name = "release") {
    fs.writeFileSync(path.join(dir, name), "");
}

/** What the fake brain needs in its environment: where to log and plan, and where the transcripts are. */
export function fakeEnv(dir: string): Record<string, string> {
    return { FAKE_DIR: dir, FAKE_FIXTURES: path.join(import.meta.dir, "..", "fixtures") };
}
