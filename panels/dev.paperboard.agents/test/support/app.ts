// The whole Agent service (AiApp) over a TestHost: its storage in a temp
// folder, Codex installed from a package of fake brains and signed in, and
// the daemon's other parts (config, vault, the Blocks registry) kept in memory.

import fs from "node:fs";
import path from "node:path";
import { DEFAULT_STATE, type AiState, type ChatEntry, type Settings } from "../../src/contract";
import { AiApp, findProgram, type AppHost } from "../../src/service/app";
import { TestBlocks } from "./blocks";
import { brainPackage, fakeEnv, fakeLog, packageHost, Recorder, TestHost, tempDir } from "./host";

export interface AppRig {
    root: string;
    host: TestHost;
    app: AiApp;
    ctx: { state: AiState };
    entries: Recorder<ChatEntry>;
    blocks: TestBlocks;
    log(): any[];
    close(): Promise<void>;
}

export async function appRig(o: { settings?: Settings; downloads?: ("claude-code" | "opencode")[] } = {}): Promise<AppRig> {
    const root = tempDir("app");
    const storage = path.join(root, "storage");
    const host = new TestHost(fakeEnv(root));
    const codex = brainPackage(root, "codex");
    // signed in, as Codex itself would have left it
    fs.mkdirSync(path.join(storage, "brains", "codex"), { recursive: true });
    fs.writeFileSync(path.join(storage, "brains", "codex", "auth.json"), "{}");
    const vault = new Map<string, string>();
    const blocks = new TestBlocks();
    let tools: unknown = null;
    const appHost: AppHost = {
        start: host.start,
        kill: host.kill,
        closeInput: host.closeInput,
        exists: host.exists,
        onExit: host.onExit,
        onStdout: host.onStdout,
        onStderr: host.onStderr,
        exec: host.exec,
        // a brain to download installs the fake one
        packages: packageHost({ codex }, Object.fromEntries((o.downloads ?? []).map((h) => [h, brainPackage(root, h)]))),
        storageDir: async () => storage,
        readSettings: async () => o.settings ?? { name: "Ada", color: "primary", harness: "codex", model: null, compaction: "summarize" },
        writeSettings: async () => {},
        findProgram,
        // a brain on the machine running the tests is never the one under test
        findBrain: () => null,
        tools: {
            write: host.write,
            readTools: async () => tools,
            writeTools: async (c) => void (tools = c),
            vault: {
                get: async (n) => vault.get(n) ?? null,
                set: async (n, v) => void vault.set(n, v),
                delete: async (n) => vault.delete(n),
                list: async () => [...vault.keys()],
            },
            // the Blocks registry holds only the agent's own blocks, which its toolset withholds
            blocks: {
                list: async () => blocks.list(),
                projects: async () => [],
                run: (panel) => Promise.reject(new Error(`the test has no blocks of ${panel}`)),
                read: (panel) => Promise.reject(new Error(`the test has no blocks of ${panel}`)),
                property: (type) => Promise.reject(new Error(`the test has no type ${type}`)),
                choices: (panel) => Promise.reject(new Error(`the test has no blocks of ${panel}`)),
                typeChoices: (type) => Promise.reject(new Error(`the test has no type ${type}`)),
            },
        },
        blocks,
    };
    const app = new AiApp(appHost);
    const entries = new Recorder<ChatEntry>();
    const ctx = {
        state: structuredClone(DEFAULT_STATE),
        setState(patch: Partial<AiState>) {
            ctx.state = { ...ctx.state, ...patch };
        },
        emit: (event: string, payload: unknown) => {
            if (event === "entry") entries.push(payload as ChatEntry);
        },
    };
    await app.init(ctx);
    return {
        root,
        host,
        app,
        ctx,
        entries,
        blocks,
        log: () => fakeLog(root),
        close: async () => {
            await app.shutdown();
            await host.close();
            fs.rmSync(root, { recursive: true, force: true });
        },
    };
}
