// Interrupted-work recovery (bun test): when an interrupted install or
// modpack change cannot be settled, starting the server and installing stay
// blocked, the reason is in state for the UI, and a retry lifts the block.
import { describe, it, expect, mock, beforeEach } from "bun:test";

const filesFake = { read: async () => null, write: async () => "/fake", exists: async () => true, getPath: async () => "/srv/mc", delete: async () => true };

mock.module("@mileniumhq/paperapi", () => ({
    config: { get: async () => ({}), set: async () => true },
    processApi: { write: async () => {}, kill: async () => {}, exists: async () => false, start: async () => ({ success: true }), run: async () => ({}), onData: () => () => {}, onExit: () => () => {} },
    files: filesFake,
    fileApi: filesFake,
    packages: { isInstalled: async () => true, getPath: async () => "/java" },
    system: { getInfo: async () => ({ os: "linux" }) },
}));

const { settleInterruptedWork } = await import("../src/service/recovery");
const { startServerInstance } = await import("../src/service/lifecycle");
const { installServerSoftware } = await import("../src/service/softwareInstall");
const { recoveryBlock, setRecoveryBlock } = await import("../src/service/recoveryState");

function makeCtx() {
    let state: any = { serverStatus: "offline", serverEntries: [], recoveryBlock: null, serverSoftware: "paper", serverVersion: "1.21.11" };
    return {
        get state() { return state; },
        setState: (patch: any) => { state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) }; },
    } as any;
}

const settled = { committed: [], rolledBack: [], discarded: [] };

beforeEach(() => setRecoveryBlock(null));

describe("a recovery that fails blocks start and installs until retried", () => {
    it("refuses starting and installing, shows why, and a successful retry lifts it", async () => {
        const ctx = makeCtx();
        let failing = true;
        const steps = {
            install: async () => { if (failing) throw new Error("staging folder is locked"); return settled; },
            modpack: async () => settled,
        };

        expect(await settleInterruptedWork(ctx, steps)).toBe(false);
        expect(ctx.state.recoveryBlock).toContain("staging folder is locked");
        expect(recoveryBlock()).not.toBeNull();

        await expect(startServerInstance(ctx)).rejects.toThrow("Retry the recovery");
        expect(ctx.state.serverStatus).toBe("offline");
        await expect(installServerSoftware(ctx, "paper", "1.21.11", {} as any)).rejects.toThrow("Retry the recovery");

        failing = false;
        expect(await settleInterruptedWork(ctx, steps)).toBe(true);
        expect(ctx.state.recoveryBlock).toBeNull();
        expect(recoveryBlock()).toBeNull();
        // the block is gone: the refusal is no longer the recovery's
        await expect(installServerSoftware(ctx, "paper", "1.21.11", {} as any)).rejects.not.toThrow("Retry the recovery");
    });

    it("does not run the modpack step after the install step failed", async () => {
        const ctx = makeCtx();
        let modpackRan = false;
        await settleInterruptedWork(ctx, {
            install: async () => { throw new Error("boom"); },
            modpack: async () => { modpackRan = true; return settled; },
        });
        expect(modpackRan).toBe(false);
    });

    it("a modpack step that fails blocks too", async () => {
        const ctx = makeCtx();
        expect(await settleInterruptedWork(ctx, {
            install: async () => settled,
            modpack: async () => { throw new Error("pack staging unreadable"); },
        })).toBe(false);
        expect(ctx.state.recoveryBlock).toContain("modpack change");
    });
});
