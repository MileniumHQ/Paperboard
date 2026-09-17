import type { ActionSchema } from "@paperboard-dev/paperapi";

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
