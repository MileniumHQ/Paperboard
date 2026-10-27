import type { ActionSchema } from "@mileniumhq/paperapi";
import { type CanvasBlock, relabelVariableRefs } from "./tree";

export interface FunctionParam {
    name: string;
    type: string;
}

export interface FunctionDef {
    id: string;
    name: string;
    params: FunctionParam[];
}

export const FUNCTION_PARAM_TYPES = [
    { id: "string", label: "Text" },
    { id: "number", label: "Number" },
    { id: "boolean", label: "Boolean" },
    { id: "url", label: "URL" },
    { id: "color", label: "Color" },
    { id: "any", label: "Any" },
];

export const FUNCTION_CALL_PREFIX = "call-function-";
export const FUNCTION_TRIGGER_PREFIX = "function-trigger-";

export function createFunctionId(): string {
    return `fn_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
}

export function callActionId(fid: string): string {
    return `${FUNCTION_CALL_PREFIX}${fid}`;
}

export function triggerActionId(fid: string): string {
    return `${FUNCTION_TRIGGER_PREFIX}${fid}`;
}

export function functionIdFromCallAction(actionId: string): string | null {
    if (!actionId.startsWith(FUNCTION_CALL_PREFIX)) return null;
    return actionId.slice(FUNCTION_CALL_PREFIX.length);
}

export function functionIdFromTriggerAction(actionId: string): string | null {
    if (!actionId.startsWith(FUNCTION_TRIGGER_PREFIX)) return null;
    return actionId.slice(FUNCTION_TRIGGER_PREFIX.length);
}

export function buildCallSchema(def: FunctionDef): ActionSchema {
    const inputs: Record<string, any> = {};
    let template = def.name;
    for (const p of def.params) {
        const typeLabel =
            FUNCTION_PARAM_TYPES.find((t) => t.id === p.type)?.label || p.type;
        inputs[p.name] = {
            type: p.type,
            label: p.name,
            placeholder: typeLabel,
            required: true,
        };
        template += ` {${p.name}}`;
    }
    return {
        id: callActionId(def.id),
        name: def.name,
        description: `Calls the ${def.name} function`,
        template,
        icon: "functions",
        inputs,
        output: {
            type: "string",
            label: `${def.name} Result`,
        },
    } as ActionSchema;
}

export function buildTriggerSchema(def: FunctionDef): ActionSchema {
    return {
        id: triggerActionId(def.id),
        name: `Function ${def.name}`,
        description: `Body of the ${def.name} function. Parameters are passed in as variables.`,
        template: `Function ${def.name}`,
        icon: "functions",
        output: {
            type: "object",
            label: def.name,
        },
        eventOnly: true,
    } as ActionSchema;
}

/**
 * The flows after a function is renamed: its call and trigger blocks carry
 * the new schemas, and every chip naming a call's result is relabeled.
 */
export function renameFunctionInFlows(blocks: CanvasBlock[], renamed: FunctionDef): CanvasBlock[] {
    const callSchema = buildCallSchema(renamed);
    const trigSchema = buildTriggerSchema(renamed);
    const refresh = (list: CanvasBlock[]): CanvasBlock[] =>
        list.map((b) => {
            const callFid = functionIdFromCallAction(b.action?.id || "");
            const trigFid = functionIdFromTriggerAction(b.action?.id || "");
            let nb = b;
            if (callFid === renamed.id) {
                nb = { ...nb, action: { ...callSchema } };
            } else if (trigFid === renamed.id) {
                nb = { ...nb, action: { ...trigSchema } };
            }
            return {
                ...nb,
                children: nb.children ? refresh(nb.children) : nb.children,
                elseChildren: nb.elseChildren ? refresh(nb.elseChildren) : nb.elseChildren,
            };
        });
    const refreshed = refresh(blocks);
    let relabeled = refreshed;
    const walkRelabel = (list: CanvasBlock[]) => {
        for (const b of list) {
            if (functionIdFromCallAction(b.action?.id || "") === renamed.id && b.action?.output) {
                const outLabel =
                    typeof b.action.output === "string"
                        ? b.action.output
                        : (b.action.output as any).label || "Result";
                relabeled = relabelVariableRefs(relabeled, b.id, outLabel);
            }
            if (b.children) walkRelabel(b.children);
            if (b.elseChildren) walkRelabel(b.elseChildren);
        }
    };
    walkRelabel(refreshed);
    return relabeled;
}
