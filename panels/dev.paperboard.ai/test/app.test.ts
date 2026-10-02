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

mock.module("@paperboard-dev/paperapi", () => ({
    config: { get: async () => null, set: async () => true },
    fileApi: { getPath: async () => filesDir },
    packageApi: {
        isInstalled: async () => true,
        getPath: async () => "/fake/ollama",
        download: async () => {},
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
