// Tab sync (bun test): every change to the tab list is published in the
// service's state, so each open window, on any computer, shows the same tabs
// instead of only the window that made the change.
import { describe, it, expect, afterEach } from "bun:test";
import { __terminalTestState, type TerminalServiceState } from "../src/service";

function recordingCtx() {
    const patches: Partial<TerminalServiceState>[] = [];
    const ctx = {
        state: {} as TerminalServiceState,
        setState: (patch: Partial<TerminalServiceState>) => patches.push(patch),
        emit: () => {},
        emitTrigger: () => {},
    };
    return { ctx, patches };
}

function run(action: string, ctx: unknown, inputs: Record<string, unknown>) {
    return (__terminalTestState().actionForTest(action) as any).run(ctx, inputs);
}

afterEach(() => {
    __terminalTestState().clearTabsForTest();
});

describe("the tab list is service state", () => {
    it("publishes a rename to every window", async () => {
        const t = __terminalTestState();
        t.registerTabForTest("tab_a");
        t.registerTabForTest("tab_b");
        const { ctx, patches } = recordingCtx();
        await run("rename-tab", ctx, { id: "tab_b", label: "Logs" });
        expect(patches.at(-1)?.tabs).toEqual([
            { id: "tab_a", label: "tab_a" },
            { id: "tab_b", label: "Logs" },
        ]);
    });

    it("publishes a new order to every window", async () => {
        const t = __terminalTestState();
        t.registerTabForTest("tab_a");
        t.registerTabForTest("tab_b");
        const { ctx, patches } = recordingCtx();
        await run("reorder-tabs", ctx, { orderedIds: ["tab_b", "tab_a"] });
        expect(patches.at(-1)?.tabs?.map((tab) => tab.id)).toEqual(["tab_b", "tab_a"]);
    });

    it("publishes copies, so later edits cannot reach a window unannounced", async () => {
        const t = __terminalTestState();
        t.registerTabForTest("tab_a");
        const { ctx, patches } = recordingCtx();
        await run("rename-tab", ctx, { id: "tab_a", label: "One" });
        await run("rename-tab", ctx, { id: "tab_a", label: "Two" });
        expect(patches.map((p) => p.tabs?.[0]?.label)).toEqual(["One", "Two"]);
    });
});
