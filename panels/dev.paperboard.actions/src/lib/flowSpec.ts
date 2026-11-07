// Flows as a program writes and reads them: a trigger and its steps named
// by panel and action, with input values, instead of canvas blocks with
// positions and embedded schemas. The Agent panel builds flows this way.
// Building checks every step against the live registry and refuses with a
// reason the writer can fix; nothing half-built reaches a canvas.
import type { ActionSchema } from "@mileniumhq/paperapi";
import { blockVariableName, type CanvasBlock } from "./tree";
import { BUILTIN_CATEGORIES } from "./builtins";

export interface FlowStepSpec {
    panel: string;
    action: string;
    values?: Record<string, unknown>;
    /** a name later steps use to read this step's result, as {{ref}} */
    ref?: string;
    /** what the step's result is called on the canvas */
    name?: string;
    /** the steps inside a container (Repeat, If, If/Else) */
    steps?: FlowStepSpec[];
    /** If/Else only: the steps when the condition fails */
    else?: FlowStepSpec[];
}

export interface FlowSpec {
    trigger: { panel: string; action: string; values?: Record<string, unknown> };
    steps?: FlowStepSpec[];
}

/** What a written flow looks like read back: the spec, plus each block's id. */
export interface FlowView {
    id: string;
    panel: string;
    action: string;
    name: string;
    values: Record<string, unknown>;
    result?: string;
    steps?: FlowView[];
    else?: FlowView[];
}

export const MAX_FLOW_STEPS = 500;
const MAX_DEPTH = 16;

/** Steps that hold steps: the editor's containers. */
export function containerKind(panelId: string, actionId: string): "loop" | "if" | "if-else" | null {
    if (!panelId.startsWith("builtin.")) return null;
    if (actionId === "repeat") return "loop";
    if (actionId === "if") return "if";
    if (actionId === "if-else") return "if-else";
    return null;
}

export type SchemaLookup = (panel: string, action: string) => ActionSchema | undefined;

const isRecord = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);

/**
 * The flow as canvas blocks, at `pos`. `lookup` answers what the registry
 * (and the builtin steps) offer right now; `newId` makes a block id.
 */
export function buildFlow(spec: unknown, lookup: SchemaLookup, newId: () => string, pos: { x: number; y: number }): CanvasBlock {
    if (!isRecord(spec) || !isRecord(spec.trigger)) throw new Error("A flow needs a trigger: { panel, action, values? }");
    let count = 0;
    const refs = new Map<string, CanvasBlock>();

    const schemaOf = (where: string, step: Record<string, unknown>): ActionSchema => {
        if (typeof step.panel !== "string" || !step.panel || typeof step.action !== "string" || !step.action) {
            throw new Error(`${where} needs a panel and an action`);
        }
        const schema = lookup(step.panel, step.action);
        if (!schema) throw new Error(`${where}: ${step.panel} has no action "${step.action}" right now`);
        if (schema.internal) throw new Error(`${where}: "${step.action}" is internal to ${step.panel}`);
        if (schema.deprecated) throw new Error(`${where}: "${step.action}" is deprecated: ${schema.deprecated}`);
        return schema;
    };

    const valuesOf = (where: string, schema: ActionSchema, raw: unknown): Record<string, unknown> => {
        if (raw !== undefined && !isRecord(raw)) throw new Error(`${where}: values is an object of input values by name`);
        const values = { ...(raw ?? {}) } as Record<string, unknown>;
        const inputs = schema.inputs ?? {};
        const unknown = Object.keys(values).filter((k) => !(k in inputs));
        if (unknown.length) {
            const known = Object.keys(inputs);
            throw new Error(`${where}: "${schema.name}" has no input ${unknown.map((k) => `"${k}"`).join(", ")}${known.length ? `; its inputs are ${known.join(", ")}` : "; it takes no inputs"}`);
        }
        for (const [key, def] of Object.entries(inputs)) {
            if (def.required && (values[key] === undefined || values[key] === "")) {
                throw new Error(`${where}: "${schema.name}" needs a value for "${key}"`);
            }
        }
        return values;
    };

    const buildSteps = (list: unknown, where: string, depth: number): CanvasBlock[] => {
        if (list === undefined) return [];
        if (!Array.isArray(list)) throw new Error(`${where} is a list of steps`);
        if (depth > MAX_DEPTH) throw new Error(`${where} nests deeper than ${MAX_DEPTH} levels`);
        return list.map((raw, i) => {
            const label = `${where}[${i}]`;
            if (!isRecord(raw)) throw new Error(`${label} is not a step`);
            if (++count > MAX_FLOW_STEPS) throw new Error(`A flow may have at most ${MAX_FLOW_STEPS} steps`);
            const schema = schemaOf(label, raw);
            if (schema.eventOnly) throw new Error(`${label}: "${schema.name}" is an event that starts flows, not a step`);
            const kind = containerKind(raw.panel as string, raw.action as string);
            if (!kind && (raw.steps !== undefined || raw.else !== undefined)) throw new Error(`${label}: "${schema.name}" holds no steps`);
            if (kind !== "if-else" && raw.else !== undefined) throw new Error(`${label}: only If/Else has else steps`);
            const block: CanvasBlock = {
                id: newId(),
                panelId: raw.panel as string,
                pos: { x: 0, y: 0 },
                isTrigger: false,
                action: schema,
                values: valuesOf(label, schema, raw.values),
                ...(typeof raw.name === "string" && raw.name.trim() ? { variableName: raw.name.trim() } : {}),
            };
            if (typeof raw.ref === "string" && raw.ref) {
                if (refs.has(raw.ref)) throw new Error(`${label}: ref "${raw.ref}" is used twice`);
                refs.set(raw.ref, block);
            }
            if (kind) block.children = buildSteps(raw.steps, `${label}.steps`, depth + 1);
            if (kind === "if-else") block.elseChildren = buildSteps(raw.else, `${label}.else`, depth + 1);
            return block;
        });
    };

    const trigger = spec.trigger;
    const triggerSchema = schemaOf("trigger", trigger);
    if (!triggerSchema.eventOnly) throw new Error(`trigger: "${triggerSchema.name}" is a step, not an event that starts flows`);
    const root: CanvasBlock = {
        id: newId(),
        panelId: trigger.panel as string,
        pos,
        isTrigger: true,
        action: triggerSchema,
        values: valuesOf("trigger", triggerSchema, trigger.values),
        children: buildSteps(spec.steps, "steps", 1),
    };
    return linkRefs(root, refs);
}

// {{ref}} in a value becomes the chip the editor writes for that step's
// result; every other {{token}} (a trigger field, a variable) stays as written
function linkRefs(root: CanvasBlock, refs: Map<string, CanvasBlock>): CanvasBlock {
    if (refs.size === 0) return root;
    const rewrite = (value: unknown): unknown => {
        if (typeof value === "string") {
            return value.replace(/\{\{([^{}:]+)\}\}/g, (whole, token: string) => {
                const step = refs.get(token.trim());
                return step ? `{{${step.id}:${blockVariableName(step) ?? "Result"}}}` : whole;
            });
        }
        if (Array.isArray(value)) return value.map(rewrite);
        if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rewrite(v)]));
        return value;
    };
    const visit = (block: CanvasBlock): CanvasBlock => ({
        ...block,
        values: rewrite(block.values) as Record<string, any>,
        ...(block.children ? { children: block.children.map(visit) } : {}),
        ...(block.elseChildren ? { elseChildren: block.elseChildren.map(visit) } : {}),
    });
    return visit(root);
}

/** A flow on the canvas, read back the way it would be written. */
export function viewFlow(block: CanvasBlock): FlowView {
    const result = blockVariableName(block);
    return {
        id: block.id,
        panel: block.panelId,
        action: String(block.action?.id ?? ""),
        name: block.action?.name ?? String(block.action?.id ?? ""),
        values: block.values ?? {},
        ...(result && !block.isTrigger ? { result } : {}),
        ...(block.children ? { steps: block.children.map(viewFlow) } : {}),
        ...(block.elseChildren ? { else: block.elseChildren.map(viewFlow) } : {}),
    };
}

/** One built-in block as a program reads it, to place it with add-flow. */
export interface BuiltinBlockView {
    panel: string;
    action: string;
    name: string;
    category: string;
    description: string;
    inputs: Record<string, { type?: string; label?: string; required?: true; default?: unknown; options?: unknown[] }>;
    output?: string;
    /** an event a flow starts from, never a step */
    event?: true;
    /** Repeat, If and If/Else hold steps; If/Else also holds else steps */
    holds?: "steps" | "steps and else";
}

/** Every built-in block the library offers, for programs that write flows. */
export function builtinBlocks(): BuiltinBlockView[] {
    return BUILTIN_CATEGORIES.flatMap((category) =>
        category.items.flatMap((item) => {
            const s = item.schema;
            if (!s || !item.action) return [];
            const inputs: BuiltinBlockView["inputs"] = {};
            for (const [key, p] of Object.entries(s.inputs ?? {})) {
                inputs[key] = {
                    type: p.type,
                    ...(p.label && p.label !== key ? { label: p.label } : {}),
                    ...(p.required ? { required: true as const } : {}),
                    ...(p.default !== undefined ? { default: p.default } : {}),
                    ...(p.options?.length ? { options: p.options.map((o) => o.value) } : {}),
                };
            }
            const output = typeof s.output === "string" ? s.output : s.output?.type;
            const kind = containerKind(item.panelId, item.action);
            return [{
                panel: item.panelId,
                action: item.action,
                name: s.name,
                category: category.name,
                description: s.description,
                inputs,
                ...(output ? { output } : {}),
                ...(s.eventOnly ? { event: true as const } : {}),
                ...(kind ? { holds: kind === "if-else" ? "steps and else" as const : "steps" as const } : {}),
            }];
        }),
    );
}
