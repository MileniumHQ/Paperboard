// Home widgets (bun test): the Run button's "Workflow" choices are the flows
// started by hand, a deleted or non-manual flow is refused by the service,
// and every run lands in the bounded recent-runs history with its real result.
import { describe, it, expect, beforeEach } from "bun:test";
import {
    __actionsTestState,
    describeWidgetFlow,
    runWidgetFlow,
    widgetFlowChoices,
} from "../src/service";
import { BUILTIN_DEFS } from "../src/lib/builtins";
import { flowLabels, manualFlowChoices, MAX_FLOW_CHOICES, RUN_HISTORY_LIMIT } from "../src/lib/widgetFlows";
import type { CanvasBlock } from "../src/lib/tree";

const schemaFor = (id: string): any => {
    for (const def of BUILTIN_DEFS as any[]) if (def.id === id) return def.item.schema;
    throw new Error(`no schema for ${id}`);
};

let n = 0;
const step = (actionId: string, values: Record<string, any> = {}): CanvasBlock => ({
    id: `s${++n}`,
    panelId: "builtin.logic",
    pos: { x: 0, y: 0 },
    isTrigger: false,
    action: schemaFor(actionId),
    values,
});
const flow = (id: string, children: CanvasBlock[], trigger = "on-play"): CanvasBlock => ({
    id,
    panelId: trigger === "on-play" ? "builtin.logic" : "dev.paperboard.actions",
    pos: { x: 0, y: 0 },
    isTrigger: true,
    action: trigger === "on-play" ? schemaFor("on-play") : { id: trigger, name: "On Message" },
    values: {},
    children,
});

const patches: any[] = [];
const ctx: any = {
    setState: (patch: any) => patches.push(patch),
    emitTrigger: () => {},
    emit: () => {},
};

const passing = flow("play_ok", [step("log-console", { message: "hi" }), step("wait-millis", { duration: 30 })]);
const failing = flow("play_bad", [step("math-calculate", { expression: "2 +" })]);
const evented = flow("on_msg", [step("log-console", { message: "x" })], "on-message");

beforeEach(() => {
    patches.length = 0;
    __actionsTestState.setFlows([passing, failing, evented]);
    __actionsTestState.setDefinitionsError(null);
});

describe("Run button workflow choices", () => {
    it("offers only flows started by hand, named by their steps", () => {
        expect(widgetFlowChoices()).toEqual([
            { value: "play_ok", label: "Log Message, Wait Milliseconds" },
            { value: "play_bad", label: "Calculate" },
        ]);
    });

    it("numbers flows that read the same, and caps the list at what the gallery accepts", () => {
        const many = Array.from({ length: MAX_FLOW_CHOICES + 5 }, (_, i) => flow(`f${i}`, [step("log-console")]));
        const choices = manualFlowChoices(many);
        expect(choices).toHaveLength(MAX_FLOW_CHOICES);
        expect(choices[0].label).toBe("Log Message");
        expect(choices[1].label).toBe("Log Message (2)");
        expect(new Set(choices.map((c) => c.label)).size).toBe(choices.length);
        const long = flow("long", Array.from({ length: 2 }, () => ({ ...step("log-console"), action: { id: "x", name: "A".repeat(80) } })));
        expect(flowLabels([long]).get("long")!.length).toBeLessThanOrEqual(64);
    });

    it("refuses to list, describe or run while the saved workflows are unreadable", async () => {
        __actionsTestState.setDefinitionsError("Actions couldn't read its saved workflows: EIO");
        expect(() => widgetFlowChoices()).toThrow(/couldn't read/);
        expect(() => describeWidgetFlow("play_ok")).toThrow(/couldn't read/);
        await expect(runWidgetFlow(ctx, "play_ok")).rejects.toThrow(/couldn't read/);
    });
});

describe("Run button runs", () => {
    it("reports running while the run is in flight, then records it as passed", async () => {
        const run = runWidgetFlow(ctx, "play_ok");
        await Bun.sleep(5);
        expect(patches.some((p) => p.running?.includes("play_ok"))).toBe(true);
        expect(await run).toMatchObject({ status: "passed" });
        const last = patches.at(-1);
        expect(last.running).toEqual([]);
        expect(last.runs[0]).toMatchObject({ flowId: "play_ok", label: "Log Message, Wait Milliseconds", status: "passed" });
    });

    it("answers and records a failing flow as failed with its error", async () => {
        const result = await runWidgetFlow(ctx, "play_bad");
        expect(result.status).toBe("failed");
        expect(result.message).toMatch(/cannot parse expression/);
        expect(__actionsTestState.runs()[0]).toMatchObject({ flowId: "play_bad", status: "failed" });
    });

    it("shows a deleted workflow as gone and refuses to run it", async () => {
        expect(describeWidgetFlow("play_ok")).toEqual({ id: "play_ok", label: "Log Message, Wait Milliseconds" });
        __actionsTestState.setFlows([failing]);
        expect(describeWidgetFlow("play_ok")).toEqual({ gone: true });
        await expect(runWidgetFlow(ctx, "play_ok")).rejects.toThrow(/no longer exists/);
        expect(patches).toEqual([]);
    });

    it("refuses flows that are not started by hand, and malformed ids", async () => {
        await expect(runWidgetFlow(ctx, "on_msg")).rejects.toThrow(/no longer exists/);
        expect(describeWidgetFlow("on_msg")).toEqual({ gone: true });
        await expect(runWidgetFlow(ctx, 42)).rejects.toThrow(/workflow id is required/);
        await expect(runWidgetFlow(ctx, "x".repeat(200))).rejects.toThrow(/workflow id is required/);
    });

    it("keeps only the latest runs", async () => {
        for (let i = 0; i < RUN_HISTORY_LIMIT + 3; i++) await runWidgetFlow(ctx, "play_bad");
        expect(__actionsTestState.runs()).toHaveLength(RUN_HISTORY_LIMIT);
        expect(new Set(__actionsTestState.runs().map((r) => r.id)).size).toBe(RUN_HISTORY_LIMIT);
    });
});
