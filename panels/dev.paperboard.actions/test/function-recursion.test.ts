// function recursion guard (bun test): a function calling itself (directly
// or through a cycle) must STOP recursing — the call fails with
// "Recursive call ... not allowed" instead of running forever
import { describe, it, expect } from "bun:test";
import { runFunctionCall } from "../src/lib/runtime";
import type { CanvasBlock } from "../src/lib/tree";

const callBlock = (fid: string, stepId: string): CanvasBlock => ({
    id: stepId,
    panelId: "builtin.function",
    pos: { x: 0, y: 0 },
    isTrigger: false,
    action: {
        id: `call-function-${fid}`,
        name: `Call ${fid}`,
    },
    values: {},
});

const bodies = new Map<string, CanvasBlock[]>([
    // self-call: body is a call to the same function
    ["fDirect", [callBlock("fDirect", "s1")]],
    // f <-> g cycle
    ["fCycle", [callBlock("gCycle", "s1")]],
    ["gCycle", [callBlock("fCycle", "s1")]],
    // healthy function with no calls
    ["fLeaf", []],
]);

const hooks = {
    getFunctionBody: (fid: string) => bodies.get(fid) ?? null,
    getFunctionName: (fid: string) => fid,
    countFunctionBodies: () => 1,
    onConsoleLog: () => {},
};

describe("runFunctionCall recursion guard", () => {
    it("stops a function that calls itself directly (no runaway recursion)", async () => {
        // executeFlow converts the refused sub-call into a failed-step log,
        // so the outer call resolves with no captured output instead of
        // looping forever
        const out = await runFunctionCall("fDirect", {}, hooks as any);
        expect(out).toBeUndefined();
    });

    it("stops a function cycle (f -> g -> f) and unwinds the in-flight set", async () => {
        // the refused call surfaces as a failed step in executeFlow's log,
        // but the cycle terminates (does not run forever)
        const out = await runFunctionCall("fCycle", {}, hooks as any);
        expect(out).toEqual({});

        // the guard set must be drained after the failed cycle: an
        // immediately following call to a NON-recursive function succeeds
        bodies.set("fCycle", [callBlock("fLeaf", "s1")]);
        const out2 = await runFunctionCall("fCycle", {}, hooks as any);
        // fLeaf has an empty body: executeFlow's captureOutput registers the
        // trigger payload as the return — a resolved call, not a refusal
        expect(out2).toEqual({});
    });
});
