// Runtime lifecycle against a real child process speaking Ollama's startup
// log and API (test/fakeOllama.ts serve). The host below is a stand-in for
// processApi with the same contract: data events, one exit event per child.
import { describe, it, expect, afterEach } from "bun:test";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { OllamaRuntime, ollamaEnv, type ProcessHost, type RuntimeLayout } from "../src/service/runtime";
import type { RuntimeState } from "../src/core/types";

const FAKE = path.join(import.meta.dir, "fakeOllama.ts");

class ChildHost implements ProcessHost {
    children = new Map<string, ChildProcess>();
    data = new Map<string, Set<(d: string) => void>>();
    exits = new Map<string, Set<(c?: number) => void>>();
    started: { command: string; env: Record<string, string> }[] = [];
    signals: string[] = [];

    constructor(private mode = "") {}

    async start(o: { id: string; command: string; args: string[]; cwd: string; env: Record<string, string> }) {
        this.started.push({ command: o.command, env: o.env });
        const child = spawn(process.execPath, [FAKE, ...o.args], {
            cwd: o.cwd,
            env: { ...process.env, ...o.env, FAKE_OLLAMA_MODE: this.mode },
            stdio: ["ignore", "pipe", "pipe"],
        });
        this.children.set(o.id, child);
        const emit = (chunk: Buffer) => this.data.get(o.id)?.forEach((cb) => cb(chunk.toString()));
        child.stdout!.on("data", emit);
        child.stderr!.on("data", emit);
        child.on("exit", (code) => {
            this.children.delete(o.id);
            this.exits.get(o.id)?.forEach((cb) => cb(code ?? undefined));
        });
        return { success: true };
    }
    async kill(id: string, signal = "SIGTERM") {
        this.signals.push(signal);
        this.children.get(id)?.kill(signal as NodeJS.Signals);
    }
    async exists(id: string) {
        return this.children.has(id);
    }
    onData(id: string, cb: (d: string) => void) {
        if (!this.data.has(id)) this.data.set(id, new Set());
        this.data.get(id)!.add(cb);
        return () => this.data.get(id)!.delete(cb);
    }
    onExit(id: string, cb: (c?: number) => void) {
        if (!this.exits.has(id)) this.exits.set(id, new Set());
        this.exits.get(id)!.add(cb);
        return () => this.exits.get(id)!.delete(cb);
    }
    killAll() {
        for (const c of this.children.values()) c.kill("SIGKILL");
    }
}

const layout: RuntimeLayout = {
    command: "/pkg/ollama/bin/ollama",
    filesDir: process.cwd(),
    modelsDir: "/files/dev.paperboard.ai/models",
    homeDir: "/files/dev.paperboard.ai/home",
    windows: false,
};

let hosts: ChildHost[] = [];
afterEach(() => {
    for (const h of hosts) h.killAll();
    hosts = [];
});

function setup(mode = "", timeouts: { ready?: number; stop?: number } = {}) {
    const host = new ChildHost(mode);
    hosts.push(host);
    const states: Partial<RuntimeState>[] = [];
    let state: Partial<RuntimeState> = {};
    const runtime = new OllamaRuntime({
        procId: "dev.paperboard.ai.ollama",
        host,
        onState: (p) => {
            states.push(p);
            state = { ...state, ...p };
        },
        readyTimeoutMs: timeouts.ready ?? 10_000,
        stopTimeoutMs: timeouts.stop ?? 3_000,
    });
    return { host, runtime, states, current: () => state };
}

describe("ollama runtime", () => {
    it("keeps everything Ollama writes inside the panel's files, loopback only", () => {
        expect(ollamaEnv(layout)).toEqual({
            OLLAMA_HOST: "127.0.0.1:0",
            OLLAMA_MODELS: "/files/dev.paperboard.ai/models",
            HOME: "/files/dev.paperboard.ai/home",
            OLLAMA_NO_CLOUD: "1",
            OLLAMA_NOHISTORY: "1",
        });
        expect(ollamaEnv({ ...layout, windows: true }).USERPROFILE).toBe("/files/dev.paperboard.ai/home");
    });

    it("is ready only once the logged port answers, and reports Ollama's compute", async () => {
        const { host, runtime, current } = setup();
        expect(runtime.api).toBeNull();
        await runtime.start(layout);
        expect(current().status).toBe("ready");
        expect(current().version).toBe("0.0.0-fake");
        expect(current().compute).toEqual([{ library: "Vulkan", name: "Fake GPU 9000", totalBytes: 16 * 1024 ** 3, availableBytes: 15 * 1024 ** 3 }]);
        expect(await runtime.requireApi().version()).toEqual({ version: "0.0.0-fake" });
        expect(host.started[0]!.command).toBe(layout.command);
        await runtime.stop();
        expect(current().status).toBe("stopped");
        expect(runtime.api).toBeNull();
        expect(await host.exists("dev.paperboard.ai.ollama")).toBe(false);
    });

    it("a child that dies at startup is an error with its output, not a hang", async () => {
        const { runtime, current } = setup("exit-early");
        await expect(runtime.start(layout)).rejects.toThrow(/exited during startup/);
        expect(current().status).toBe("error");
        expect(current().errorDetail).toContain("address already in use");
    });

    it("a crash after startup is reported and drops the API", async () => {
        const { host, runtime, current } = setup();
        await runtime.start(layout);
        host.children.get("dev.paperboard.ai.ollama")!.kill("SIGKILL");
        const start = Date.now();
        while (current().status !== "error" && Date.now() - start < 3000) await new Promise((r) => setTimeout(r, 10));
        expect(current().status).toBe("error");
        expect(current().error).toMatch(/exited unexpectedly/);
        expect(runtime.api).toBeNull();
        expect(() => runtime.requireApi()).toThrow(/not running/);
    });

    it("a child that ignores SIGTERM is escalated to SIGKILL and observed gone", async () => {
        const { host, runtime, current } = setup("ignore-term", { stop: 300 });
        await runtime.start(layout);
        await runtime.stop();
        expect(host.signals).toEqual(["SIGTERM", "SIGKILL"]);
        expect(current().status).toBe("stopped");
        expect(await host.exists("dev.paperboard.ai.ollama")).toBe(false);
    });

    it("restart replaces the running child, never runs two", async () => {
        const { host, runtime } = setup();
        await runtime.start(layout);
        const first = host.children.get("dev.paperboard.ai.ollama")!;
        await runtime.start(layout);
        expect(first.exitCode !== null || first.signalCode !== null).toBe(true);
        expect(host.children.size).toBe(1);
        expect(host.started).toHaveLength(2);
        await runtime.stop();
    });

    it("a leftover child from a previous service run is stopped before starting", async () => {
        const leftover = setup();
        await leftover.runtime.start(layout);
        // a new service instance (new runtime) sharing the same host
        const states: Partial<RuntimeState>[] = [];
        const runtime = new OllamaRuntime({ procId: "dev.paperboard.ai.ollama", host: leftover.host, onState: (p) => states.push(p), stopTimeoutMs: 3000 });
        const old = leftover.host.children.get("dev.paperboard.ai.ollama")!;
        await runtime.start(layout);
        expect(old.exitCode !== null || old.signalCode !== null).toBe(true);
        expect(states.some((s) => s.status === "ready")).toBe(true);
        await runtime.stop();
    });
});
