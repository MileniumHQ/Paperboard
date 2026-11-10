// What the registry offers, as Blockly blocks and a toolbox. Types become
// Blockly connection checks, so a socket only takes a value that fits it.
// No styling yet: Blockly's own look, with a hue per kind.
import type { BlockInfo, BlockSchema } from "@mileniumhq/paperapi";
import { parseTypeRef } from "@mileniumhq/paperapi";
import { BUILTIN, parseEntry, propertyBlockType, registryBlockType } from "./names";

type Json = Record<string, unknown>;
type Schema<K extends BlockSchema["kind"]> = Extract<BlockSchema, { kind: K }>;
type Inputs = Record<string, { type: string; name: string; optional?: boolean; choices?: { label: string; value: unknown }[] }>;

/** A custom type's base, by "panel:type". */
export type TypeBases = Map<string, "text" | "number" | "boolean" | "object">;

const HUE = { event: 45, command: 210, value: 160, property: 290, builtin: 20 } as const;

/**
 * The Blockly checks a type allows: core types use Blockly's own names, so
 * its built-in blocks fit; a custom type is also its base, so text can be
 * typed into a Player socket and a Player reads as text. null takes anything.
 */
export function checksFor(typeRef: string, bases: TypeBases): string[] | null {
    const t = parseTypeRef(typeRef);
    if (t.kind === "list") return ["Array"];
    if (t.kind === "core") {
        if (t.name === "any") return null;
        if (t.name === "number" || t.name === "timestamp" || t.name === "duration") return ["Number"];
        if (t.name === "boolean") return ["Boolean"];
        return ["String"];
    }
    const base = bases.get(typeRef);
    if (base === "text") return [typeRef, "String"];
    if (base === "number") return [typeRef, "Number"];
    if (base === "boolean") return [typeRef, "Boolean"];
    return [typeRef];
}

/** The editable block an empty socket of this type holds, if any. */
function shadowFor(typeRef: string, bases: TypeBases): Json | undefined {
    const checks = checksFor(typeRef, bases);
    if (!checks) return undefined;
    if (checks.includes("Number")) return { shadow: { type: "math_number", fields: { NUM: 0 } } };
    if (checks.includes("Boolean")) return { shadow: { type: "logic_boolean", fields: { BOOL: "TRUE" } } };
    if (checks.includes("String")) return { shadow: { type: "text", fields: { TEXT: "" } } };
    return undefined;
}

/** A block's line: its text with each input's socket where its braces were. */
function message(name: string, text: string | undefined, inputs: Inputs, bases: TypeBases): { message0: string; args0: Json[] } {
    const args: Json[] = [];
    const arg = (key: string): Json => {
        const input = inputs[key]!;
        if (input.choices) {
            return { type: "field_dropdown", name: key, options: input.choices.map((c) => [c.label, JSON.stringify(c.value)]) };
        }
        return { type: "input_value", name: key, check: checksFor(input.type, bases) };
    };
    if (text) {
        const message0 = text.replace(/\{([^}]+)\}/g, (_m, key: string) => {
            args.push(arg(key));
            return `%${args.length}`;
        });
        return { message0, args0: args };
    }
    const keys = Object.keys(inputs);
    for (const key of keys) args.push(arg(key));
    return { message0: [name, ...keys.map((_k, i) => `%${i + 1}`)].join(" "), args0: args };
}

function hat(type: string, title: { message0: string; args0: Json[] }, tooltip: string): Json {
    return {
        type,
        message0: title.message0,
        args0: title.args0,
        message1: "%1",
        args1: [{ type: "input_statement", name: "DO" }],
        colour: HUE.event,
        tooltip,
    };
}

export interface Definitions {
    blocks: Json[];
    /** each block's schema, saved with the flows */
    schemas: Record<string, { panelId: string; entry: string; schema: BlockSchema }>;
    /** toolbox entries per section: panel or project */
    sections: { key: string; panelId: string; project?: string; contents: Json[] }[];
}

/** Blockly definitions and toolbox sections for every registry entry. */
export function registryDefinitions(entries: BlockInfo[]): Definitions {
    const bases: TypeBases = new Map();
    for (const e of entries) {
        if (e.schema.kind === "type") bases.set(`${e.panelId}:${e.schema.id}`, e.schema.base);
    }
    const out: Definitions = { blocks: [], schemas: {}, sections: [] };
    const section = (panelId: string, project?: string) => {
        const key = project ? `${panelId}/${project}` : panelId;
        let found = out.sections.find((s) => s.key === key);
        if (!found) {
            found = { key, panelId, ...(project ? { project } : {}), contents: [] };
            out.sections.push(found);
        }
        return found.contents;
    };
    const toolboxBlock = (type: string, inputs: Inputs | undefined): Json => {
        const shadows: Json = {};
        for (const [key, input] of Object.entries(inputs ?? {})) {
            if (input.choices) continue;
            const shadow = shadowFor(input.type, bases);
            if (shadow) shadows[key] = shadow;
        }
        return { kind: "block", type, ...(Object.keys(shadows).length ? { inputs: shadows } : {}) };
    };

    for (const { panelId, entry, schema } of entries) {
        const { project } = parseEntry(entry);
        const contents = section(panelId, project);
        const record = (type: string) => {
            out.schemas[type] = { panelId, entry, schema };
        };
        switch (schema.kind) {
            case "type": {
                const fields = Object.entries(schema.fields ?? {});
                if (!fields.length) break;
                const typeRef = `${panelId}:${schema.id}`;
                const type = propertyBlockType(typeRef);
                record(type);
                out.blocks.push({
                    type,
                    message0: `%1 of %2`,
                    args0: [
                        { type: "field_dropdown", name: "FIELD", options: fields.map(([key, f]) => [f.name, key]) },
                        { type: "input_value", name: "VALUE", check: checksFor(typeRef, bases) },
                    ],
                    output: null,
                    colour: HUE.property,
                    tooltip: `A field of a ${schema.name}`,
                });
                contents.push({ kind: "block", type });
                break;
            }
            case "command": {
                const s = schema as Schema<"command">;
                const type = registryBlockType({ kind: "command", panelId, entry });
                record(type);
                out.blocks.push({
                    type,
                    ...message(s.name, s.text, (s.inputs ?? {}) as Inputs, bases),
                    ...(s.output ? { output: checksFor(s.output, bases) } : { previousStatement: null, nextStatement: null }),
                    colour: HUE.command,
                    tooltip: s.description ?? s.name,
                });
                contents.push(toolboxBlock(type, s.inputs as Inputs));
                break;
            }
            case "value": {
                const s = schema as Schema<"value">;
                const type = registryBlockType({ kind: "value", panelId, entry });
                record(type);
                out.blocks.push({
                    type,
                    ...message(s.name, s.text, (s.inputs ?? {}) as Inputs, bases),
                    output: checksFor(s.type, bases),
                    colour: HUE.value,
                    tooltip: s.description ?? s.name,
                });
                contents.push(toolboxBlock(type, s.inputs as Inputs));
                if (s.changes) {
                    const changes = registryBlockType({ kind: "changes", panelId, entry });
                    record(changes);
                    out.blocks.push(hat(changes, { message0: `When ${s.name} changes`, args0: [] }, `Runs each time ${s.name} changes`));
                    contents.unshift({ kind: "block", type: changes });
                }
                break;
            }
            case "event": {
                const s = schema as Schema<"event">;
                const type = registryBlockType({ kind: "event", panelId, entry });
                record(type);
                out.blocks.push(hat(type, message(s.name, s.text, (s.inputs ?? {}) as Inputs, bases), s.description ?? s.name));
                const valueBlocks: Json[] = [];
                for (const [key, v] of Object.entries(s.values ?? {})) {
                    const valueType = registryBlockType({ kind: "event-value", panelId, entry, key });
                    record(valueType);
                    out.blocks.push({
                        type: valueType,
                        message0: v.name,
                        output: checksFor(v.type, bases),
                        colour: HUE.event,
                        tooltip: `${v.name}, inside "${s.name}"`,
                    });
                    valueBlocks.push({ kind: "block", type: valueType });
                }
                contents.unshift(toolboxBlock(type, s.inputs as Inputs), ...valueBlocks);
                break;
            }
        }
    }
    return out;
}

/** This panel's own blocks: the Run hat, Wait and Log. */
export const BUILTIN_BLOCKS: Json[] = [
    hat(BUILTIN.onRun, { message0: "When Run is clicked", args0: [] }, "Runs when you click Run"),
    {
        type: BUILTIN.wait,
        message0: "Wait %1 seconds",
        args0: [{ type: "input_value", name: "SECONDS", check: ["Number"] }],
        previousStatement: null,
        nextStatement: null,
        colour: HUE.builtin,
        tooltip: "Waits before the next step",
    },
    {
        type: BUILTIN.log,
        message0: "Log %1",
        args0: [{ type: "input_value", name: "TEXT" }],
        previousStatement: null,
        nextStatement: null,
        colour: HUE.builtin,
        tooltip: "Writes to the run log",
    },
];

const num = (n: number) => ({ shadow: { type: "math_number", fields: { NUM: n } } });
const txt = (t: string) => ({ shadow: { type: "text", fields: { TEXT: t } } });

/** Blockly's own blocks that the interpreter runs, by section. */
export const BUILTIN_SECTIONS: { name: string; contents: Json[]; custom?: string }[] = [
    {
        name: "Flow",
        contents: [
            { kind: "block", type: BUILTIN.onRun },
            { kind: "block", type: BUILTIN.wait, inputs: { SECONDS: num(1) } },
            { kind: "block", type: BUILTIN.log, inputs: { TEXT: txt("") } },
            { kind: "block", type: "controls_if" },
            { kind: "block", type: "controls_repeat_ext", inputs: { TIMES: num(10) } },
            { kind: "block", type: "controls_whileUntil" },
            { kind: "block", type: "controls_forEach" },
            { kind: "block", type: "controls_flow_statements" },
        ],
    },
    {
        name: "Logic",
        contents: ["logic_compare", "logic_operation", "logic_negate", "logic_boolean"].map((type) => ({ kind: "block", type })),
    },
    {
        name: "Math",
        contents: [
            { kind: "block", type: "math_number", fields: { NUM: 0 } },
            { kind: "block", type: "math_arithmetic", inputs: { A: num(1), B: num(1) } },
        ],
    },
    {
        name: "Text",
        contents: [
            { kind: "block", type: "text" },
            { kind: "block", type: "text_join" },
            { kind: "block", type: "text_length", inputs: { VALUE: txt("") } },
            { kind: "block", type: "text_isEmpty", inputs: { VALUE: txt("") } },
        ],
    },
    {
        name: "Lists",
        contents: ["lists_create_with", "lists_length", "lists_isEmpty"].map((type) => ({ kind: "block", type })),
    },
    { name: "Variables", contents: [], custom: "VARIABLE" },
];
