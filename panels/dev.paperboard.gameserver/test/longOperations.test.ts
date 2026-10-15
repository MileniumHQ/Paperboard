// Long-running UI calls (bun test): installing a server version or a modpack
// takes minutes, so the bridge call must not be cut off at its 30 s default
// while the service is still working.
import { describe, it, expect, mock, beforeAll } from "bun:test";

const calls: { action: string; options: unknown }[] = [];

mock.module("@mileniumhq/paperapi", () => ({
    createPanelBridge: () => ({
        onStateChange: () => {},
        refreshState: async () => ({}),
        call: async (action: string, _inputs?: unknown, options?: unknown) => {
            calls.push({ action, options });
            return {};
        },
    }),
    config: { get: async () => ({}), set: async () => true },
    fileApi: {},
    files: {},
    processApi: {},
    system: { getInfo: async () => ({ os: "linux" }) },
}));
mock.module("../src/lib/ensureJava", () => ({ ensureJavaRuntime: async () => {} }));

let ACTION_IDS: typeof import("../src/service/contract").ACTION_IDS;
let modpacks: typeof import("../src/lib/modpacks");
let installRun: typeof import("../src/lib/installRun");

beforeAll(async () => {
    ({ ACTION_IDS } = await import("../src/service/contract"));
    modpacks = await import("../src/lib/modpacks");
    installRun = await import("../src/lib/installRun");
});

describe("long installs are waited out, not cut off at 30 seconds", () => {
    it("modpack install and removal pass no deadline", async () => {
        calls.length = 0;
        await modpacks.installModpack("proj", "ver");
        await modpacks.removeModpack();
        expect(calls).toEqual([
            { action: ACTION_IDS.installModpack, options: { timeoutMs: null } },
            { action: ACTION_IDS.removeModpack, options: { timeoutMs: null } },
        ]);
    });

    it("a server version install passes no deadline", async () => {
        calls.length = 0;
        await installRun.createInstallRun().run("paper", "1.21.11");
        expect(calls).toEqual([{ action: ACTION_IDS.installServerVersion, options: { timeoutMs: null } }]);
    });
});
