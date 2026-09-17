// function recursion guard (bun test): a function calling itself (directly
// or through a cycle) must STOP recursing — the call fails with
// "Recursive call ... not allowed" instead of running forever
import { describe, it, expect } from "bun:test";
import { runFunctionCall, executeFlow } from "../src/lib/runtime";
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
    it("independent concurrent calls are not recursion", async () => {
        const waiting = { ...callBlock("unused", "wait"), panelId: "builtin.logic", action: { id: "wait-millis", name: "Wait" }, values: { duration: 15 } };
        const results = await Promise.all([1, 2].map(() => runFunctionCall("parallel", {}, { getFunctionBody: () => [waiting] })));
        expect(results).toEqual([15, 15]);
    });
    it("a failed function stops its parent flow before the next step", async () => {
        const failure = { ...callBlock("unused", "failure"), panelId: "builtin.logic", action: { id: "throw-error", name: "Fail" }, values: { message: "fixture failed" } };
        const following = { ...failure, id: "following", action: { id: "text", name: "Must not execute" }, values: { value: "wrong" } };
        const parent = { ...callBlock("parent", "parent"), isTrigger: true, children: [callBlock("child", "child-call"), following] };
        const result = await executeFlow(parent, {}, undefined, undefined, undefined, { getFunctionBody: () => [failure] });
        expect(result.status).toBe("error");
        expect(result.message).toContain("fixture failed");
        expect(result.steps.some((step) => step.actionName === "Must not execute")).toBe(false);
    });
    it("stops a function that calls itself directly (no runaway recursion)", async () => {
        // A refused nested call must reject the function, not resolve a
        // success-shaped undefined value to its parent.
        await expect(runFunctionCall("fDirect", {}, hooks as any)).rejects.toThrow(/Recursive call/);
    });

    it("stops a function cycle (f -> g -> f) and unwinds the in-flight set", async () => {
        // Cycles fail, and the next independent execution remains usable.
        await expect(runFunctionCall("fCycle", {}, hooks as any)).rejects.toThrow(/Recursive call/);

        // the guard set must be drained after the failed cycle: an
        // immediately following call to a NON-recursive function succeeds
        bodies.set("fCycle", [callBlock("fLeaf", "s1")]);
        const out2 = await runFunctionCall("fCycle", {}, hooks as any);
        // fLeaf has an empty body: executeFlow's captureOutput registers the
        // trigger payload as the return — a resolved call, not a refusal
        expect(out2).toEqual({});
    });
});
