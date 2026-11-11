// The whole Agent service (AiApp) over a TestHost: its storage in a temp
// folder, Codex installed from a package of fake brains and signed in, and
// the daemon's other parts (config, vault, actions) kept in memory.

import fs from "node:fs";
import path from "node:path";
import type { ActionDefinition } from "@mileniumhq/paperapi";
import { DEFAULT_STATE, type AiState, type ChatEntry, type Settings } from "../../src/contract";
import { AiApp, findProgram, type AppHost } from "../../src/service/app";
import type { ActionEntry } from "../../src/service/actionsToolset";
import { brainPackage, fakeEnv, fakeLog, packageHost, Recorder, TestHost, tempDir } from "./host";

export interface AppRig {
    root: string;
    host: TestHost;
    app: AiApp;
    ctx: { state: AiState };
    entries: Recorder<ChatEntry>;
    triggers: Recorder<{ id: string; payload: any }>;
    registered: ActionDefinition[];
    log(): any[];
    close(): Promise<void>;
}

export async function appRig(o: { settings?: Settings; actions?: ActionEntry[] } = {}): Promise<AppRig> {
    const root = tempDir("app");
    const storage = path.join(root, "storage");
    const host = new TestHost(fakeEnv(root));
    const codex = brainPackage(root, "codex");
    // signed in, as Codex itself would have left it
    fs.mkdirSync(path.join(storage, "brains", "codex"), { recursive: true });
    fs.writeFileSync(path.join(storage, "brains", "codex", "auth.json"), "{}");
    const vault = new Map<string, string>();
    const registered: ActionDefinition[] = [];
    let tools: unknown = null;
    const appHost: AppHost = {
        start: host.start,
        kill: host.kill,
        exists: host.exists,
        onExit: host.onExit,
        onStdout: host.onStdout,
        onStderr: host.onStderr,
        exec: host.exec,
        packages: packageHost({ codex }),
        storageDir: async () => storage,
        readSettings: async () => o.settings ?? { name: "Ada", harness: "codex", model: null, compaction: "summarize" },
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
            actions: {
                list: async () => o.actions ?? [],
                listProjects: async () => [],
                call: async (panel, action) => {
                    throw new Error(`the test has no action ${panel}:${action}`);
                },
            },
        },
        registerAction: async (def) => void registered.push(def),
    };
    const app = new AiApp(appHost);
    const entries = new Recorder<ChatEntry>();
    const triggers = new Recorder<{ id: string; payload: any }>();
    const ctx = {
        state: structuredClone(DEFAULT_STATE),
        setState(patch: Partial<AiState>) {
            ctx.state = { ...ctx.state, ...patch };
        },
        emit: (event: string, payload: unknown) => {
            if (event === "chat-entry") entries.push(payload as ChatEntry);
        },
        trigger: (id: string, payload: unknown) => triggers.push({ id, payload }),
    };
    await app.init(ctx);
    return {
        root,
        host,
        app,
        ctx,
        entries,
        triggers,
        registered,
        log: () => fakeLog(root),
        close: async () => {
            await app.shutdown();
            await host.close();
            fs.rmSync(root, { recursive: true, force: true });
        },
    };
}

/** A flow action of the service's, as the Actions registry would run it. */
export function action(r: AppRig, id: string) {
    const def = r.app.flowActions().find((a) => a.id === id);
    if (!def?.run) throw new Error(`the service has no runnable action ${id}`);
    return (inputs: Record<string, unknown>) => Promise.resolve(def.run!({}, inputs));
}
