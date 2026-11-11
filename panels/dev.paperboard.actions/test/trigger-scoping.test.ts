// Stored flows require a named source. Old wildcard/panel-less definitions
// refuse execution until the author chooses that source.
import { describe, it, expect, afterAll, beforeEach } from "bun:test";
import { handleTriggerEventForTest, __actionsTestState } from "../src/service";
import type { CanvasBlock } from "../src/lib/tree";

const origWarn = console.warn;
const emitted: { trigger: string; output: any }[] = [];
__actionsTestState.setServiceCtx({
    emitTrigger: (id: string, output: any) => emitted.push({ trigger: id, output }),
    setIdle: () => {},
    setState: () => {},
} as any);

let n = 0;
const flowWith = (panelId: string | undefined): CanvasBlock => ({
    id: `flow_scoping_${++n}`,
    panelId: panelId as any,
    pos: { x: 0, y: 0 },
    isTrigger: true,
    action: { id: "on-message", name: "On Message" },
    children: [],
});

// stored runs are fire-and-forget: flushing them makes the assertions
// below deterministic (runStoredFlow swallows, never rethrows)
async function fire(): Promise<void> {
    handleTriggerEventForTest({ content: "hello" }, {
        trigger: "on-message",
        panelId: "dev.paperboard.botcreator",
    });
    await Bun.sleep(20);
}

describe("handleTriggerEvent panel scoping", () => {
    beforeEach(() => {
        emitted.length = 0;
        __actionsTestState.clearProjects();
    });

    it("refuses a flow with no source panel instead of firing for every panel", async () => {
        const warns: string[] = [];
        console.warn = (...a: any[]) => warns.push(a.map(String).join(" "));
        __actionsTestState.setFlows([flowWith(undefined)]);
        await fire();
        console.warn = origWarn;
        const joined = warns.join("\n");
        expect(joined.includes("select an explicit source panel")).toBe(true);
        // No cross-panel execution is inferred from missing identity.
        expect(emitted.some((e) => e.trigger === "flow-start")).toBe(false);
    });

    it("matches NOTHING when panel ids simply differ", async () => {
        __actionsTestState.setFlows([flowWith("dev.paperboard.other")]);
        await fire();
        expect(emitted.some((e) => e.trigger === "flow-start")).toBe(false);
    });

    it("matches the named panel without any warning", async () => {
        const warns: string[] = [];
        console.warn = (...a: any[]) => warns.push(a.map(String).join(" "));
        try {
            __actionsTestState.setFlows([flowWith("dev.paperboard.botcreator")]);
            await fire();
        } finally {
            console.warn = origWarn;
        }
        expect(emitted.some((e) => e.trigger === "flow-start")).toBe(true);
        expect(warns.join("\n").includes("no panelId")).toBe(false);
    });

    it("a project switched off starts nothing; the projects still on do", async () => {
        __actionsTestState.setFlows([flowWith("dev.paperboard.botcreator")], "p-off", "Parked");
        __actionsTestState.setEnabled("p-off", false);
        await fire();
        expect(emitted.some((e) => e.trigger === "flow-start")).toBe(false);

        __actionsTestState.setFlows([flowWith("dev.paperboard.botcreator")], "p-on", "Live");
        await fire();
        const started = emitted.filter((e) => e.trigger === "flow-start");
        expect(started.map((e) => e.output.project)).toEqual(["p-on"]);
    });

    it("wildcard flows are refused until an explicit source is selected", async () => {
        const warns: string[] = [];
        console.warn = (...a: any[]) => warns.push(a.map(String).join(" "));
        try {
            __actionsTestState.setFlows([flowWith("*")]);
            await fire();
        } finally {
            console.warn = origWarn;
        }
        expect(warns.join("\n").includes("select an explicit source panel")).toBe(true);
        expect(emitted.some((e) => e.trigger === "flow-start")).toBe(false);
    });
});

afterAll(() => {
    console.warn = origWarn;
    __actionsTestState.setFlows([]);
});
