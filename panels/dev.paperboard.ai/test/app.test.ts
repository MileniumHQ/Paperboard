// Regression: the service reports ready without waiting for Ollama to boot.
//
// The daemon gives a panel service 20 s to send `paperboard:service-ready`
// (papercrane/panelServices.ts) and abandons it after five failed restarts.
// `AiApp.init` used to await `startIfInstalled()`, so a slow or crashed
// Ollama (the Windows GTX 1650 report: a model load took the GPU down) kept
// onInit pending past that deadline and the panel never came back while the
// rest of the app was fine. init must resolve after history/settings, with
// the runtime still starting.
import { describe, it, expect, mock, afterAll } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ProcessHost } from "../src/service/runtime";
import type { AiState } from "../src/core/types";

const filesDir = fs.mkdtempSync(path.join(os.tmpdir(), "pb-ai-app-"));
const secrets = new Map<string, string>();

// mutable so the install test can control the package check and the download
let packageInstalled = true;
let downloadImpl: () => Promise<void> = async () => {};

mock.module("@mileniumhq/paperapi", () => ({
    config: { get: async () => null, set: async () => true },
    secretsApi: {
        get: async (name: string) => ({ found: secrets.has(name), value: secrets.get(name) }),
        set: async (name: string, value: string) => {
            secrets.set(name, value);
        },
        delete: async (name: string) => {
            secrets.delete(name);
        },
    },
    fileApi: { getPath: async () => filesDir },
    packageApi: {
        isInstalled: async () => packageInstalled,
        getPath: async () => "/fake/ollama",
        download: () => downloadImpl(),
    },
    panelsApi: { list: async () => [] },
    actionsApi: {
        list: async () => [],
        call: async () => undefined,
        emit: async () => {},
        emitTrigger: async () => {},
        register: async () => {},
        registerMultiple: async () => {},
    },
    systemApi: { getGpus: async () => ({ gpus: [], errors: [] }) },
    processApi: {},
    defineAction: (definition: unknown) => definition,
}));

const { AiApp } = await import("../src/service/app");
const { initialState } = await import("../src/core/types");

afterAll(() => {
    fs.rmSync(filesDir, { recursive: true, force: true });
});

// Ollama never reports its address and never exits on its own; a kill is
// observed through the exit event, so teardown stays fast.
class HangingHost implements ProcessHost {
    private exit?: (code?: number) => void;
    async start() {
        return { success: true };
    }
    async kill() {
        this.exit?.(1);
    }
    async exists() {
        return false;
    }
    onData() {
        return () => {};
    }
    onExit(_id: string, cb: (code?: number) => void) {
        this.exit = cb;
        return () => {};
    }
}

function makeCtx() {
    let state: AiState = initialState();
    return {
        get state() {
            return state;
        },
        setState(patch: Partial<AiState> | ((prev: AiState) => Partial<AiState>)) {
            state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
        },
        emit() {},
        emitTrigger() {},
    };
}

describe("AiApp provider credentials", () => {
    async function withApp(run: (app: InstanceType<typeof AiApp>) => Promise<void>) {
        const app = new AiApp(new HangingHost(), { readyTimeoutMs: 100 });
        const ctx = makeCtx();
        await app.init(ctx as any);
        const original = globalThis.fetch;
        // model listing dials the endpoint; tests are about the key, not it
        globalThis.fetch = (async () => new Response(JSON.stringify({ data: [] }), { status: 200 })) as any;
        try {
            await run(app);
        } finally {
            globalThis.fetch = original;
            await app.stopRuntime().catch((err) => console.debug("[ai] test teardown:", String(err)));
        }
    }

    it("clears the stored key when the endpoint changes", async () => {
        secrets.clear();
        await withApp(async (app) => {
            await app.setProvider({ id: "custom", baseUrl: "https://api.example.com/v1", apiKey: "k1" });
            expect(secrets.get("openai-api-key")).toBe("k1");
            // a key belongs to the endpoint it was entered for
            await app.setProvider({ id: "custom", baseUrl: "https://other.example.com/v1" });
            expect(secrets.has("openai-api-key")).toBe(false);
        });
    });

    it("refuses to store a key for a plaintext non-loopback endpoint", async () => {
        secrets.clear();
        await withApp(async (app) => {
            await expect(
                app.setProvider({ id: "custom", baseUrl: "http://10.0.0.5:1234", apiKey: "k1" }),
            ).rejects.toThrow(/plaintext/);
            expect(secrets.size).toBe(0);
        });
    });

    it("refuses to test with a stored key over plaintext", async () => {
        secrets.clear();
        await withApp(async (app) => {
            await app.setProvider({ id: "custom", baseUrl: "https://api.example.com/v1", apiKey: "k1" });
            await expect(app.testProvider({ baseUrl: "http://10.0.0.5:1234" })).rejects.toThrow(/plaintext/);
        });
    });
});

describe("AiApp readiness", () => {
    it("resolves init while Ollama is still starting, not after its boot timeout", async () => {
        const readyTimeoutMs = 1500;
        const app = new AiApp(new HangingHost(), { readyTimeoutMs });
        const ctx = makeCtx();
        const started = Date.now();
        try {
            await app.init(ctx as any);
            expect(Date.now() - started).toBeLessThan(readyTimeoutMs / 3);
            expect(app.runtime.api).toBeNull();
            expect(ctx.state.runtime.status).not.toBe("ready");
        } finally {
            await app.stopRuntime().catch((err) => console.debug("[ai] test teardown:", String(err)));
        }
    });
});

async function waitFor(cond: () => boolean, ms = 3000): Promise<void> {
    const start = Date.now();
    while (!cond()) {
        if (Date.now() - start > ms) throw new Error("waitFor timeout");
        await new Promise((r) => setTimeout(r, 5));
    }
}

describe("AiApp installRuntime", () => {
    it("acknowledges before the download finishes and reports through state", async () => {
        packageInstalled = false;
        let downloadStarted = false;
        let finishDownload: (() => void) | null = null;
        downloadImpl = () => {
            downloadStarted = true;
            return new Promise<void>((resolve) => {
                finishDownload = resolve;
            });
        };
        const app = new AiApp(new HangingHost(), { readyTimeoutMs: 150 });
        const ctx = makeCtx();
        try {
            await app.init(ctx as any);
            await waitFor(() => ctx.state.runtime.status === "missing");
            const started = Date.now();
            await app.installRuntime();
            // the action call returns while the download is still in flight
            expect(Date.now() - started).toBeLessThan(200);
            expect(ctx.state.runtime.status).toBe("installing");
            await waitFor(() => downloadStarted);
            finishDownload!();
            // download done, boot attempted; the hanging host times out and
            // the failure surfaces in state, never as a rejected action call
            await waitFor(() => ctx.state.runtime.status === "error");
        } finally {
            packageInstalled = true;
            downloadImpl = async () => {};
            await app.stopRuntime().catch((err) => console.debug("[ai] test teardown:", String(err)));
        }
    });
});
