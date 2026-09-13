// flow execution gate (bun test): stored runs AND test runs share ONE
// bounded gate — spamming test-run-flow beyond the cap refuses with the
// same typed refusal instead of running unbounded
import { describe, it, expect, afterAll } from "bun:test";
import {
    runStoredFlow,
    runTestFlow,
    FlowRunRefused,
    __actionsTestState,
} from "../src/service";
import { BUILTIN_CATEGORIES } from "../src/lib/builtins";
import type { CanvasBlock } from "../src/lib/tree";

const emitted: { trigger: string; output: any }[] = [];
__actionsTestState.setServiceCtx({
    emitTrigger: (id: string, output: any) => emitted.push({ trigger: id, output }),
    setState: () => {},
} as any);

const waitSchema: any = (() => {
    for (const cat of BUILTIN_CATEGORIES as any[]) {
        for (const item of cat.items || []) {
            if (item.action === "wait-millis") return item.schema;
        }
    }
    throw new Error("wait-millis schema missing");
})();

const trigger: CanvasBlock = {
    id: "trig_gate",
    panelId: "dev.paperboard.actions",
    pos: { x: 0, y: 0 },
    isTrigger: true,
    action: { id: "on-message", name: "Slow Trigger", output: { type: "any" } },
    values: {},
    children: [
        {
            id: "w1",
            panelId: "builtin.logic",
            pos: { x: 0, y: 0 },
            isTrigger: false,
            action: waitSchema,
            values: { duration: 250 },
        },
    ],
};

describe("bounded flow execution gate", () => {
    it("refuses the 9th concurrent run — stored or test — with a typed refusal", async () => {
        __actionsTestState.setFlows([trigger]);
        // saturate the gate: 8 capped concurrent stored runs
        const runs: Promise<any>[] = [];
        for (let i = 0; i < 8; i++) {
            runs.push(runStoredFlow({ emitTrigger: () => {}, setState: () => {} } as any, trigger, {}));
        }
        await Bun.sleep(20);
        expect(__actionsTestState.running()).toBe(8);

        // test runs go through the SAME gate and rethrow as a typed refusal
        let caught: unknown = null;
        try {
            await runTestFlow(
                {
                    emitTrigger: (id: string, output: any) => emitted.push({ trigger: id, output }),
                    setState: () => {},
                } as any,
                { triggerBlockId: "trig_gate", payload: {} },
            );
        } catch (err) {
            caught = err;
        }
        expect(caught).toBeInstanceOf(FlowRunRefused);
        expect((caught as Error).message).toMatch(/already running \(cap 8\)/);

        // stored runs swallow the refusal (console-log path), never crash
        const refused = await runStoredFlow({ emitTrigger: () => {}, setState: () => {} } as any, trigger, {});
        expect(refused).toBe(null);

        await Promise.all(runs);
        expect(__actionsTestState.running()).toBe(0);
    }, 10000);

    it("recovers: after the running flows drain, a test run is accepted", async () => {
        const ctx = {
            emitTrigger: (id: string, output: any) => emitted.push({ trigger: id, output }),
            setState: () => {},
        } as any;
        const log = await runTestFlow(ctx, { triggerBlockId: "trig_gate", payload: {} });
        expect(log.status).toBe("success");
    });
});

afterAll(() => {
    __actionsTestState.setFlows([]);
});
