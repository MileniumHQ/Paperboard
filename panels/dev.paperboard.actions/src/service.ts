import {
    definePanelService,
    defineAction,
    actionsApi,
    config,
    type ServiceContext,
} from "@paperboard-dev/paperapi";
import { executeFlow, runFunctionCall, initVariablesStore } from "./lib/runtime";
import {
    type FunctionDef,
    buildCallSchema,
} from "./lib/functions";
import type { CanvasBlock } from "./lib/tree";

// pass PANEL_ID explicitly, ambient scope resolves to last-imported panel
export const ACTIONS_PANEL_ID = "dev.paperboard.actions";

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
                await actionsApi.unregister(`call-function-${id}`, "dev.paperboard.actions");
            } catch {}
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
                await actionsApi.unregister(`call-function-${def.id}`, "dev.paperboard.actions");
            } catch {}
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
                "dev.paperboard.actions",
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

async function runStoredFlow(triggerBlock: CanvasBlock, payload: any) {
    const ctx = serviceCtx;
    if (!ctx) return;
    ctx.emitTrigger("flow-start", { triggerBlockId: triggerBlock.id });
    try {
        await executeFlow(
            triggerBlock,
            payload,
            undefined,
            (stepId, status) => {
                if (stepId) {
                    ctx.emitTrigger("flow-step", { blockId: stepId, status });
                }
            },
            (entry) => {
                ctx.emitTrigger("flow-log", entry);
            },
            serviceHooks(),
        );
    } catch (err) {
        const message = (err as any)?.message || String(err);
        console.error(
            `[ActionsService] Flow "${triggerBlock.action?.name || triggerBlock.id}" failed:`,
            message,
        );
        ctx.emitTrigger("flow-log", {
            time: new Date().toLocaleTimeString(),
            message: `Flow "${triggerBlock.action?.name || triggerBlock.id}" failed: ${message}`,
        });
    } finally {
        ctx.emitTrigger("flow-end", { triggerBlockId: triggerBlock.id });
    }
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
                flows = inputs.flows;
            }
            if (Array.isArray(inputs?.functions)) {
                functions = inputs.functions.filter(
                    (f: any) => f && typeof f.id === "string" && typeof f.name === "string",
                );
            }
            rev += 1;
            serviceCtx = ctx;
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
        run: async (ctx: Ctx, inputs: { triggerBlockId: string; payload?: any }) => {
            const triggerBlock = flows.find((b) => b.id === inputs?.triggerBlockId);
            if (!triggerBlock) {
                throw new Error(`Unknown trigger block "${inputs?.triggerBlockId}"`);
            }
            serviceCtx = ctx;
            ctx.emitTrigger("flow-start", { triggerBlockId: triggerBlock.id });
            try {
                const log = await executeFlow(
                    triggerBlock,
                    inputs?.payload || {},
                    undefined,
                    (stepId, status) => {
                        if (stepId) {
                            ctx.emitTrigger("flow-step", { blockId: stepId, status });
                        }
                    },
                    (entry) => {
                        ctx.emitTrigger("flow-log", entry);
                    },
                    serviceHooks(),
                );
                return log;
            } finally {
                ctx.emitTrigger("flow-end", { triggerBlockId: triggerBlock.id });
            }
        },
    }),
];

export const actionsService = definePanelService({
    id: "dev.paperboard.actions",
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

        actionsApi.onTrigger("*", (output: any, data: any) => {
            if (!data || INTERNAL_TRIGGER_IDS.includes(data.trigger)) return;

            for (const b of flows) {
                const actionId =
                    b.action?.id || (b.action as any)?.trigger || (b as any).trigger;
                const matchesTrigger = actionId === data.trigger;
                const matchesPanel =
                    !b.panelId || b.panelId === "*" || b.panelId === data.panelId;

                if (b.isTrigger && matchesTrigger && matchesPanel) {
                    runStoredFlow(b, output);
                }
            }
        });
    },
});

export default actionsService;
