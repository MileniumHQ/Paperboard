import {
    definePanelService,
    defineAction,
    actionsApi,
    config,
    type ServiceContext,
} from "@paperboard-dev/paperapi";
import {
    type ExecutionLog,
    executeFlow,
    runFunctionCall,
    initVariablesStore,
} from "./lib/runtime";
import {
    type FunctionDef,
    buildCallSchema,
} from "./lib/functions";
import type { CanvasBlock } from "./lib/tree";
import { isCanvasBlock } from "./lib/tree";
// canonical panel id (shared with the UI bundle); the explicit identity
// every config/registry call below carries
import { ACTIONS_PANEL_ID } from "./panelId";

interface ActionsServiceState {
    flowCount: number;
    functionCount: number;
    rev: number;
}

type Ctx = ServiceContext<ActionsServiceState>;

let flows: CanvasBlock[] = [];
let functions: FunctionDef[] = [];
let rev = 0;
let serviceCtx: Ctx | null = null;

const registeredFunctionIds = new Set<string>();

// internal trigger ids, never matched against user flows
const INTERNAL_TRIGGER_IDS = ["flow-step", "flow-log", "flow-start", "flow-end"];

// per-flow trigger subscriptions (see resubscribeTriggers) — identity is
// granted per subscription, never ambient, and the legacy wildcard is
// only opened when a stored flow actually still uses it
let triggerUnsubs: Array<() => void> = [];
let legacyWildcardUnsub: (() => void) | null = null;

function serviceHooks() {
    return {
        getFunctionBody: (fid: string): CanvasBlock[] | null => {
            if (!functions.some((f) => f.id === fid)) return null;
            const trig = flows.find(
                (b) =>
                    b.isTrigger &&
                    (b.action as any)?.id === `function-trigger-${fid}`,
            );
            if (!trig) return null;
            return trig.children && trig.children.length > 0 ? trig.children : [];
        },
        getFunctionName: (fid: string): string => {
            const def = functions.find((f) => f.id === fid);
            if (def) return def.name;
            const trig = flows.find(
                (b) =>
                    b.isTrigger &&
                    (b.action as any)?.id === `function-trigger-${fid}`,
            );
            const tname = (trig?.action as any)?.name;
            if (typeof tname === "string" && tname) {
                return tname.replace(/^Function /, "");
            }
            return fid;
        },
        countFunctionBodies: (fid: string): number =>
            flows.filter(
                (b) =>
                    b.isTrigger &&
                    (b.action as any)?.id === `function-trigger-${fid}`,
            ).length,
    };
}

const functionSignature = (def: FunctionDef): string =>
    JSON.stringify({ name: def.name, params: def.params });

const registeredFunctionSignatures = new Map<string, string>();

async function syncFunctionRegistry() {
    const wanted = new Set(functions.map((d) => d.id));
    for (const id of [...registeredFunctionIds]) {
        if (!wanted.has(id)) {
            try {
                await actionsApi.unregister(`call-function-${id}`, ACTIONS_PANEL_ID);
            } catch (err) {
                console.debug("[actions] unregister stale function failed:", id, String(err));
            }
            registeredFunctionIds.delete(id);
            registeredFunctionSignatures.delete(id);
        }
    }
    for (const def of functions) {
        const sig = functionSignature(def);
        if (
            registeredFunctionIds.has(def.id) &&
            registeredFunctionSignatures.get(def.id) === sig
        ) {
            continue;
        }
        if (registeredFunctionIds.has(def.id)) {
            try {
                await actionsApi.unregister(`call-function-${def.id}`, ACTIONS_PANEL_ID);
            } catch (err) {
                console.debug("[actions] unregister function before re-register failed:", def.id, String(err));
            }
        }
        try {
            const schema = buildCallSchema(def);
            await actionsApi.register(
                {
                    id: schema.id,
                    name: schema.name,
                    description: schema.description || "",
                    template: schema.template,
                    inputs: schema.inputs,
                    output: schema.output,
                    icon: schema.icon,
                    run: async (_ctx: any, inputs: any) =>
                        runFunctionCall(def.id, inputs || {}, {
                            ...serviceHooks(),
                        }),
                },
                undefined,
                ACTIONS_PANEL_ID,
            );
            registeredFunctionIds.add(def.id);
            registeredFunctionSignatures.set(def.id, sig);
        } catch (err) {
            console.error(`[ActionsService] Failed to register function "${def.name}":`, err);
        }
    }
}

function updateCounts(ctx: Ctx) {
    ctx.setState({
        flowCount: flows.length,
        functionCount: functions.length,
        rev,
    });
}

// concurrent stored-flow runs are BOUNDED: a chatty trigger stacking
// unbounded concurrent executeFlow runs is exactly the resource surprise
// this panel must not produce. Beyond the cap, the run is refused loudly.
const MAX_CONCURRENT_FLOW_RUNS = 8;
let runningFlows = 0;

// typed refusal, exported for tests: EVERY flow execution (stored AND
// test runs) goes through this ONE gate — the cap is never mirrored
export class FlowRunRefused extends Error {
    name = "FlowRunRefused";
}

const flowCallbacks = (ctx: Ctx) => ({
    onStepChange: (stepId: string | null, status: "start" | "end") => {
        if (stepId) ctx.emitTrigger("flow-step", { blockId: stepId, status });
    },
    onLog: (entry: { time: string; message: string }) => {
        ctx.emitTrigger("flow-log", entry);
    },
});

export function flowRunCap(): number {
    return MAX_CONCURRENT_FLOW_RUNS;
}

async function executeFlowGated(
    ctx: Ctx,
    triggerBlock: CanvasBlock,
    payload: any,
): Promise<ExecutionLog> {
    if (runningFlows >= MAX_CONCURRENT_FLOW_RUNS) {
        const message = `Flow run refused: ${runningFlows} flows already running (cap ${MAX_CONCURRENT_FLOW_RUNS})`;
        console.warn(`${message} — skipped "${triggerBlock.action?.name || triggerBlock.id}"`);
        throw new FlowRunRefused(message);
    }
    runningFlows++;
    ctx.emitTrigger("flow-start", { triggerBlockId: triggerBlock.id });
    const { onStepChange, onLog } = flowCallbacks(ctx);
    try {
        return await executeFlow(triggerBlock, payload, undefined, onStepChange, onLog, serviceHooks());
    } finally {
        runningFlows--;
        ctx.emitTrigger("flow-end", { triggerBlockId: triggerBlock.id });
    }
}

function handleTriggerEvent(output: any, data: any): void {
    if (!data || INTERNAL_TRIGGER_IDS.includes(data.trigger)) return;
    // cross-panel flows must name the panel they listen to. legacy stored
    // "*" flows AND panel-less flows still fire with a loud warning instead
    // of honest-looking silence (they die with v3.1 — TODO(remove after v3.1))
    for (const b of flows) {
        if (!b.isTrigger) continue;
        const actionId =
            b.action?.id || (b.action as any)?.trigger || (b as any).trigger;
        const matchesTrigger = actionId === data.trigger;
        let matchesPanel = b.panelId === data.panelId;
        if (b.panelId === "*") {
            matchesPanel = true;
            console.warn(
                `[ActionsService] flow "${b.id}" still uses wildcard panelId "*"; declare the panel explicitly (wildcards die with v3.1). TODO(remove after v3.1)`,
            );
        } else if (!b.panelId) {
            matchesPanel = true;
            console.warn(
                `[ActionsService] flow "${b.id}" has no panelId; it fires for every panel — declare the panel explicitly (deprecated; denied at registry-open). TODO(remove after v3.1)`,
            );
        }
        if (matchesTrigger && matchesPanel) {
            void runStoredFlow(serviceCtx, b, output);
        }
    }
}

// exported for tests: direct access to event matching (panel-less and
// wildcard flows are deprecated paths — see handleTriggerEvent)
export function handleTriggerEventForTest(output: any, data: any): void {
    return handleTriggerEvent(output, data);
}

// test-only access to the module-level flow list and service ctx
export const __actionsTestState = {
    flows: () => flows,
    setFlows: (list: CanvasBlock[]) => {
        flows = list;
    },
    setServiceCtx: (ctx: Ctx | null) => {
        serviceCtx = ctx;
    },
    running: () => runningFlows,
};

function flowTriggerName(b: CanvasBlock): string | null {
    const actionId =
        b.action?.id || (b.action as any)?.trigger || (b as any).trigger;
    if (typeof actionId !== "string" || actionId.length === 0) return null;
    if (INTERNAL_TRIGGER_IDS.includes(actionId)) return null;
    if (actionId.startsWith("function-trigger-")) return null;
    return actionId;
}

// every user flow is subscribed EXPLICITLY: onTrigger(panel, trigger).
// Subscription set is rebuilt whenever the flow set changes. The
// deprecated wildcard subscription is opened ONLY while some stored flow
// still carries the "*" panelId — it is removed with the flows themselves
// after v3.1 (TODO(remove after v3.1)).
function resubscribeTriggers(): void {
    for (const unsub of triggerUnsubs) unsub();
    triggerUnsubs = [];
    if (legacyWildcardUnsub) {
        legacyWildcardUnsub();
        legacyWildcardUnsub = null;
    }
    for (const b of flows) {
        if (!b.isTrigger || b.panelId === "*") continue;
        const triggerName = flowTriggerName(b);
        if (!triggerName) continue;
        const panelId = b.panelId || ACTIONS_PANEL_ID;
        triggerUnsubs.push(
            actionsApi.onTrigger(panelId, triggerName, handleTriggerEvent),
        );
    }
    if (flows.some((b) => b.isTrigger && b.panelId === "*")) {
        legacyWildcardUnsub = actionsApi.onTrigger("*", handleTriggerEvent);
        console.warn(
            "[ActionsService] wildcard trigger subscription opened for legacy '+' flows; wildcards die with v3.1. TODO(remove after v3.1)",
        );
    }
}

// exported for the actions below AND tests: same bounded gate as test runs
export async function runStoredFlow(
    ctx: Ctx | null,
    triggerBlock: CanvasBlock,
    payload: any,
): Promise<ExecutionLog | null> {
    if (!ctx) return null;
    try {
        return await executeFlowGated(ctx, triggerBlock, payload);
    } catch (err) {
        if (err instanceof FlowRunRefused) {
            // the gate already logged the refusal; stored runs (their
            // caller is a trigger) swallow it, test runs rethrow
            return null;
        }
        const message = (err as any)?.message || String(err);
        console.error(
            `[ActionsService] Flow "${triggerBlock.action?.name || triggerBlock.id}" failed:`,
            message,
        );
        ctx.emitTrigger("flow-log", {
            time: new Date().toLocaleTimeString(),
            message: `Flow "${triggerBlock.action?.name || triggerBlock.id}" failed: ${message}`,
        });
        // stored runs are triggered, so their failures surface via the
        // console log — never an unhandled rejection (matches pre-gate)
        return null;
    }
}

// test runs share the SAME bounded gate as stored runs; over the cap the
// refusal reaches the caller as a typed error instead of silent skipping
export async function runTestFlow(
    ctx: Ctx,
    inputs: { triggerBlockId: string; payload?: any },
): Promise<ExecutionLog> {
    const triggerBlock = flows.find((b) => b.id === inputs?.triggerBlockId);
    if (!triggerBlock) {
        throw new Error(`Unknown trigger block "${inputs?.triggerBlockId}"`);
    }
    serviceCtx = ctx;
    return await executeFlowGated(ctx, triggerBlock, inputs?.payload || {});
}

const actions = [
    defineAction({
        id: "sync-flows",
        name: "Sync Flows",
        description: "Replaces the server-side flow and function definitions",
        template: "Sync flows",
        inputs: {
            flows: {
                type: "object",
                label: "Flows",
            },
            functions: {
                type: "object",
                label: "Functions",
            },
        },
        output: {
            type: "object",
            label: "Sync Result",
        },
        icon: "sync",
        run: async (ctx: Ctx, inputs: { flows?: CanvasBlock[]; functions?: FunctionDef[] }) => {
            if (Array.isArray(inputs?.flows)) {
                // boundary: stored flows are executable content — malformed
                // blocks are dropped loudly, never trusted into the runtime
                const valid = inputs.flows.filter(isCanvasBlock);
                const dropped = inputs.flows.length - valid.length;
                if (dropped > 0) {
                    console.warn(`[ActionsService] sync-flows dropped ${dropped} malformed block(s)`);
                }
                for (const b of valid) {
                    if (!b.panelId) {
                        console.warn(
                            `[ActionsService] stored flow "${b.id}" has no panelId; inferring it from ${ACTIONS_PANEL_ID} sync (declare it in the canvas — deprecated). TODO(remove after v3.1)`,
                        );
                        b.panelId = ACTIONS_PANEL_ID;
                    }
                }
                flows = valid;
            }
            if (Array.isArray(inputs?.functions)) {
                functions = inputs.functions.filter(
                    (f: any) => f && typeof f.id === "string" && typeof f.name === "string",
                );
            }
            rev += 1;
            serviceCtx = ctx;
            resubscribeTriggers();
            await syncFunctionRegistry();
            updateCounts(ctx);
            console.log(
                `[ActionsService] Synced rev ${rev}: ${flows.length} top-level blocks, ${functions.length} functions.`,
            );
            return { flows: flows.length, functions: functions.length, rev };
        },
    }),

    defineAction({
        id: "test-run-flow",
        name: "Test Run Flow",
        description: "Executes one stored flow by trigger block id and returns its log",
        template: "Test run flow",
        inputs: {
            triggerBlockId: {
                type: "string",
                label: "Trigger Block ID",
                required: true,
            },
            payload: {
                type: "object",
                label: "Payload",
            },
        },
        output: {
            type: "object",
            label: "Execution Log",
        },
        icon: "play_arrow",
        run: async (ctx: Ctx, inputs: { triggerBlockId: string; payload?: any }) =>
            // gate is shared with stored runs (one invariant, one impl);
            // over the cap this throws FlowRunRefused, never silently runs
            runTestFlow(ctx, inputs),
    }),
];

export const actionsService = definePanelService({
    id: ACTIONS_PANEL_ID,
    state: {
        flowCount: 0,
        functionCount: 0,
        rev: 0,
    },
    actions,
    triggers: [],
    async onInit(ctx: Ctx) {
        serviceCtx = ctx;

        await initVariablesStore();

        try {
            const saved = await config.get<any>(ACTIONS_PANEL_ID);
            if (saved?.flows && Array.isArray(saved.flows)) {
                flows = saved.flows;
            }
            if (saved?.functions && Array.isArray(saved.functions)) {
                functions = saved.functions.filter(
                    (f: any) => f && typeof f.id === "string" && typeof f.name === "string",
                );
            }
        } catch (err) {
            console.error("[ActionsService] Failed to load stored flows:", err);
        }

        await syncFunctionRegistry();
        updateCounts(ctx);
        console.log(
            `[ActionsService] Ready with ${flows.length} top-level blocks and ${functions.length} functions.`,
        );

        resubscribeTriggers();
    },
});

export default actionsService;
