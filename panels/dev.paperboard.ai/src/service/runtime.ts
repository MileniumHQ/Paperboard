// Lifecycle of the panel's own `ollama serve`: one generation at a time,
// readiness observed (the bound port from its log, then /api/version),
// and stop observed through the exit event, never inferred.

import { appendTail, LineSplitter, parseInferenceCompute, parseListening } from "../core/ollamaLog";
import type { ComputeDevice, RuntimeState } from "../core/types";
import { OllamaClient } from "./ollamaClient";

/** The process surface the runtime needs (processApi in production). */
export interface ProcessHost {
    start(options: { id: string; command: string; args: string[]; cwd: string; env: Record<string, string> }): Promise<unknown>;
    kill(id: string, signal?: string): Promise<void>;
    exists(id: string): Promise<boolean>;
    onData(id: string, cb: (data: string) => void): () => void;
    onExit(id: string, cb: (code?: number) => void): () => void;
}

export interface RuntimeLayout {
    /** ollama executable */
    command: string;
    /** the panel's files dir: cwd, models, home */
    filesDir: string;
    modelsDir: string;
    homeDir: string;
    windows: boolean;
}

export interface RuntimeDeps {
    procId: string;
    host: ProcessHost;
    onState: (patch: Partial<RuntimeState>) => void;
    /** time allowed from spawn to a ready API */
    readyTimeoutMs?: number;
    stopTimeoutMs?: number;
}

type Generation = {
    offData: () => void;
    offExit: () => void;
    exited: Promise<number | undefined>;
    tail: string[];
    compute: ComputeDevice[];
    stopping: boolean;
    /** a failed start keeps its error state through the stop that follows */
    keepError: boolean;
};

export class OllamaRuntime {
    private generation: Generation | null = null;
    private client: OllamaClient | null = null;
    private transition: Promise<void> = Promise.resolve();

    constructor(private readonly deps: RuntimeDeps) {}

    /** The API of the running, ready server; null otherwise. */
    get api(): OllamaClient | null {
        return this.client;
    }

    requireApi(): OllamaClient {
        if (!this.client) throw new Error("Ollama is not running. Start it from the AI panel first.");
        return this.client;
    }

    /** Serializes start/stop so two clicks never race two children. */
    private serial(op: () => Promise<void>): Promise<void> {
        const next = this.transition.then(op, op);
        this.transition = next.catch((err) => console.debug("[ai] runtime transition failed:", String(err)));
        return next;
    }

    start(layout: RuntimeLayout): Promise<void> {
        return this.serial(() => this.startNow(layout));
    }

    stop(): Promise<void> {
        return this.serial(() => this.stopNow());
    }

    private async startNow(layout: RuntimeLayout): Promise<void> {
        await this.stopNow();
        // a child from a previous service run is ours, but its port was in
        // a log we never saw: stop it and observe the exit before replacing
        if (await this.deps.host.exists(this.deps.procId)) {
            await this.killAndWait(this.subscribeExit());
        }

        const { host, procId, onState } = this.deps;
        onState({ status: "starting", error: undefined, errorDetail: undefined, compute: [] });
        const splitter = new LineSplitter(64 * 1024);
        let resolveListening!: (port: number) => void;
        const listening = new Promise<number>((resolve) => (resolveListening = resolve));
        let version: string | undefined;

        const exitWatch = this.subscribeExit();
        const gen: Generation = {
            offData: () => {},
            offExit: exitWatch.off,
            exited: exitWatch.exited,
            tail: [],
            compute: [],
            stopping: false,
            keepError: false,
        };
        gen.offData = host.onData(procId, (chunk) => {
            let lines: string[];
            try {
                lines = splitter.push(chunk);
            } catch (err) {
                lines = [`[output line dropped: ${String(err)}]`];
            }
            gen.tail = appendTail(gen.tail, lines);
            for (const line of lines) {
                const l = parseListening(line);
                if (l) {
                    version = l.version;
                    resolveListening(l.port);
                }
                const device = parseInferenceCompute(line);
                if (device) {
                    gen.compute = [...gen.compute.filter((d) => d.name !== device.name), device].slice(0, 16);
                    if (this.generation === gen) onState({ compute: gen.compute });
                }
            }
        });
        this.generation = gen;
        void gen.exited.then((code) => this.handleExit(gen, code));

        try {
            await host.start({
                id: procId,
                command: layout.command,
                args: ["serve"],
                cwd: layout.filesDir,
                env: ollamaEnv(layout),
            });
            const timeoutMs = this.deps.readyTimeoutMs ?? 60_000;
            const port = await raceReady(listening, gen.exited, timeoutMs, "Ollama did not report its address");
            const client = new OllamaClient(`http://127.0.0.1:${port}`);
            await waitForApi(client, gen.exited, timeoutMs);
            if (this.generation !== gen) return;
            this.client = client;
            onState({ status: "ready", version, error: undefined, errorDetail: undefined });
        } catch (err) {
            if (this.generation === gen) {
                onState({ status: "error", error: messageOf(err), errorDetail: gen.tail.join("\n") });
                await this.stopNow({ keepError: true });
            }
            throw err;
        }
    }

    private subscribeExit(): { exited: Promise<number | undefined>; off: () => void } {
        let off: () => void = () => {};
        const exited = new Promise<number | undefined>((resolve) => {
            off = this.deps.host.onExit(this.deps.procId, (code) => resolve(code));
        });
        return { exited, off };
    }

    private handleExit(gen: Generation, code: number | undefined): void {
        gen.offData();
        gen.offExit();
        if (this.generation !== gen) return;
        this.generation = null;
        this.client = null;
        if (gen.stopping) {
            if (!gen.keepError) this.deps.onState({ status: "stopped", compute: [] });
        } else {
            this.deps.onState({
                status: "error",
                error: `Ollama exited unexpectedly (code ${code ?? "unknown"})`,
                errorDetail: gen.tail.join("\n"),
                compute: [],
            });
        }
    }

    private async killAndWait(watch: { exited: Promise<number | undefined>; off: () => void }): Promise<void> {
        const { host, procId } = this.deps;
        const timeoutMs = this.deps.stopTimeoutMs ?? 10_000;
        try {
            await host.kill(procId, "SIGTERM");
            const gone = await Promise.race([watch.exited.then(() => true), delay(timeoutMs).then(() => false)]);
            if (!gone) {
                await host.kill(procId, "SIGKILL");
                const killed = await Promise.race([watch.exited.then(() => true), delay(timeoutMs).then(() => false)]);
                if (!killed && (await host.exists(procId))) {
                    throw new Error("Ollama did not exit after SIGKILL");
                }
            }
        } finally {
            watch.off();
        }
    }

    private async stopNow(opts: { keepError?: boolean } = {}): Promise<void> {
        const gen = this.generation;
        this.client = null;
        if (!gen) return;
        gen.stopping = true;
        gen.keepError = Boolean(opts.keepError);
        await this.killAndWait({ exited: gen.exited, off: () => {} });
        // handleExit ran, or the child was already gone: retire the generation
        gen.offData();
        gen.offExit();
        if (this.generation === gen) {
            this.generation = null;
            if (!gen.keepError) this.deps.onState({ status: "stopped", compute: [] });
        }
    }
}

export function ollamaEnv(layout: RuntimeLayout): Record<string, string> {
    const env: Record<string, string> = {
        // loopback only, kernel-chosen port (read back from the log)
        OLLAMA_HOST: "127.0.0.1:0",
        // everything Ollama writes lives in the panel's files
        OLLAMA_MODELS: layout.modelsDir,
        HOME: layout.homeDir,
        // local models only: no remote inference, web search, or model
        // recommendations fetched from ollama.com
        OLLAMA_NO_CLOUD: "1",
        OLLAMA_NOHISTORY: "1",
    };
    if (layout.windows) env.USERPROFILE = layout.homeDir;
    return env;
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
        const t = setTimeout(resolve, ms);
        (t as { unref?: () => void }).unref?.();
    });
}

function messageOf(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

async function raceReady<T>(ready: Promise<T>, exited: Promise<number | undefined>, timeoutMs: number, what: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            ready,
            exited.then((code) => {
                throw new Error(`Ollama exited during startup (code ${code ?? "unknown"})`);
            }),
            new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new Error(`${what} within ${Math.round(timeoutMs / 1000)}s`)), timeoutMs);
            }),
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

async function waitForApi(client: OllamaClient, exited: Promise<number | undefined>, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let dead = false;
    void exited.then(() => (dead = true));
    let last: unknown;
    while (Date.now() < deadline) {
        if (dead) throw new Error("Ollama exited during startup");
        try {
            await client.version();
            return;
        } catch (err) {
            last = err;
            await delay(250);
        }
    }
    throw new Error(`Ollama's API did not answer within ${Math.round(timeoutMs / 1000)}s (${messageOf(last)})`);
}
