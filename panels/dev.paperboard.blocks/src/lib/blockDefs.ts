// What the registry offers, as Blockly blocks and a toolbox. Types become
// Blockly connection checks, so a socket only takes a value that fits it.
// No styling yet: Blockly's own look, with a hue per kind.
import type { BlockInfo, BlockInputSchema, BlockProjectInfo, BlockSchema } from "@mileniumhq/paperapi";
import { blockEntry, parseTypeRef } from "@mileniumhq/paperapi";
import { CHOICES_FIELD, choiceValue, type ChoicesSource } from "./choicesField";
import { BUILTIN, parseEntry, propertyBlockType, registryBlockType } from "./names";

type Json = Record<string, unknown>;
type Schema<K extends BlockSchema["kind"]> = Extract<BlockSchema, { kind: K }>;
type Inputs = Record<string, BlockInputSchema>;

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

/** The editable block an empty socket of this type holds, if any: the input's default, or an empty one. */
function shadowFor(input: BlockInputSchema, bases: TypeBases): Json | undefined {
    const checks = checksFor(input.type, bases);
    const given = input.default;
    if (!checks) {
        // "any": a default says which editable block fits it
        if (typeof given === "number") return { shadow: { type: "math_number", fields: { NUM: given } } };
        if (typeof given === "boolean") return { shadow: { type: "logic_boolean", fields: { BOOL: given ? "TRUE" : "FALSE" } } };
        if (typeof given === "string") return { shadow: { type: "text", fields: { TEXT: given } } };
        return undefined;
    }
    if (checks.includes("Number")) return { shadow: { type: "math_number", fields: { NUM: typeof given === "number" ? given : 0 } } };
    if (checks.includes("Boolean")) return { shadow: { type: "logic_boolean", fields: { BOOL: given === false ? "FALSE" : "TRUE" } } };
    if (checks.includes("String")) return { shadow: { type: "text", fields: { TEXT: given === undefined ? "" : String(given) } } };
    return undefined;
}

/** Every dropdown whose choices its panel works out, to ask for them up front. */
export function choicesSources(entries: BlockInfo[]): ChoicesSource[] {
    const out: ChoicesSource[] = [];
    for (const { panelId, entry, schema } of entries) {
        if (!("inputs" in schema)) continue;
        for (const [input, def] of Object.entries(schema.inputs ?? {})) if (def.dynamicChoices) out.push({ panelId, entry, input });
    }
    return out;
}

/** More sockets than this and a block lists them a row each, so it stays narrow enough to read. */
const MOST_INLINE_SOCKETS = 3;

/** A block's line: its text with each input's socket where its braces were. */
function message(
    name: string,
    text: string | undefined,
    inputs: Inputs,
    bases: TypeBases,
    owner: { panelId: string; entry: string },
): { message0: string; args0: Json[]; inputsInline?: false } {
    const args: Json[] = [];
    const arg = (key: string): Json => {
        const input = inputs[key]!;
        if (input.dynamicChoices) return { type: CHOICES_FIELD, name: key, panelId: owner.panelId, entry: owner.entry, input: key };
        if (input.choices) {
            // the default first, so a new block starts on it
            const choices = [...input.choices].sort((a, b) => Number(b.value === input.default) - Number(a.value === input.default));
            return { type: "field_dropdown", name: key, options: choices.map((c) => [c.label, choiceValue(c.value)]) };
        }
        return { type: "input_value", name: key, check: checksFor(input.type, bases) };
    };
    const keys = Object.keys(inputs);
    const message0 = text
        ? text.replace(/\{([^}]+)\}/g, (_m, key: string) => {
              args.push(arg(key));
              return `%${args.length}`;
          })
        : [name, ...keys.map((key) => (args.push(arg(key)), `%${args.length}`))].join(" ");
    const sockets = args.filter((a) => a.type === "input_value").length;
    return { message0, args0: args, ...(sockets > MOST_INLINE_SOCKETS ? { inputsInline: false as const } : {}) };
}

function hat(type: string, title: ReturnType<typeof message>, tooltip: string): Json {
    return {
        type,
        message0: title.message0,
        args0: title.args0,
        ...(title.inputsInline === false ? { inputsInline: false } : {}),
        message1: "%1",
        args1: [{ type: "input_statement", name: "DO" }],
        colour: HUE.event,
        tooltip,
    };
}

/** The heading over a panel's property blocks. */
export const PROPERTIES_CATEGORY = "Properties";

export interface Definitions {
    blocks: Json[];
    /** each block's schema, saved with the flows */
    schemas: Record<string, { panelId: string; entry: string; schema: BlockSchema }>;
    /** toolbox entries per section: a panel or project, and a block's category in it */
    sections: { key: string; panelId: string; project?: string; category?: string; contents: Json[] }[];
}

/**
 * Blockly definitions and toolbox sections for every registry entry. A
 * type with fields read per project gets a property block in each of its
 * panel's `projects` too.
 */
export function registryDefinitions(listed: BlockInfo[], projects: BlockProjectInfo[] = []): Definitions {
    const bases: TypeBases = new Map();
    const entries = [...listed];
    for (const e of listed) {
        if (e.schema.kind !== "type") continue;
        bases.set(`${e.panelId}:${e.schema.id}`, e.schema.base);
        if (parseEntry(e.entry).project || !Object.values(e.schema.fields ?? {}).some((f) => f.perProject)) continue;
        for (const p of projects.filter((p) => p.panelId === e.panelId)) entries.push({ ...e, entry: blockEntry("type", e.schema.id, p.id), project: p.id });
    }
    const out: Definitions = { blocks: [], schemas: {}, sections: [] };
    const section = (panelId: string, project?: string, category?: string) => {
        const key = [panelId, project ?? "", category ?? ""].join("\u0000");
        let found = out.sections.find((s) => s.key === key);
        if (!found) {
            found = { key, panelId, ...(project ? { project } : {}), ...(category ? { category } : {}), contents: [] };
            out.sections.push(found);
        }
        return found.contents;
    };
    const toolboxBlock = (type: string, inputs: Inputs | undefined): Json => {
        const shadows: Json = {};
        const fields: Json = {};
        for (const [key, input] of Object.entries(inputs ?? {})) {
            if (input.choices || input.dynamicChoices) {
                if (input.default !== undefined) fields[key] = choiceValue(input.default);
                continue;
            }
            const shadow = shadowFor(input, bases);
            if (shadow) shadows[key] = shadow;
        }
        return { kind: "block", type, ...(Object.keys(shadows).length ? { inputs: shadows } : {}), ...(Object.keys(fields).length ? { fields } : {}) };
    };

    for (const { panelId, entry, schema } of entries) {
        const { project } = parseEntry(entry);
        // a type's property block sits under Properties, after the panel's own categories
        const contents = section(panelId, project, schema.kind === "type" ? PROPERTIES_CATEGORY : "category" in schema ? schema.category : undefined);
        const record = (type: string) => {
            out.schemas[type] = { panelId, entry, schema };
        };
        switch (schema.kind) {
            case "type": {
                // the panel's block reads what needs no project; each project's, what does
                const fields = Object.entries(schema.fields ?? {}).filter(([, f]) => Boolean(f.perProject) === Boolean(project));
                if (!fields.length) break;
                const typeRef = `${panelId}:${schema.id}`;
                const type = propertyBlockType(typeRef, project);
                record(type);
                out.blocks.push({
                    type,
                    // the type named, so two types' "Name of" read apart
                    message0: `%1 of ${schema.name} %2`,
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
                    ...message(s.name, s.text, (s.inputs ?? {}) as Inputs, bases, { panelId, entry }),
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
                    ...message(s.name, s.text, (s.inputs ?? {}) as Inputs, bases, { panelId, entry }),
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
                out.blocks.push(hat(type, message(s.name, s.text, (s.inputs ?? {}) as Inputs, bases, { panelId, entry }), s.description ?? s.name));
                const valueBlocks: Json[] = [];
                for (const [key, v] of Object.entries(s.values ?? {})) {
                    const valueType = registryBlockType({ kind: "event-value", panelId, entry, key });
                    record(valueType);
                    out.blocks.push({
                        type: valueType,
                        message0: v.name,
                        output: checksFor(v.type, bases),
                        colour: HUE.event,
                        tooltip: v.optional ? `${v.name}, inside "${s.name}"; it may have none (check with "has a value")` : `${v.name}, inside "${s.name}"`,
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

const statement = (type: string, message0: string, args0: Json[], tooltip: string, colour: number = HUE.builtin): Json => ({
    type,
    message0,
    args0,
    previousStatement: null,
    nextStatement: null,
    colour,
    tooltip,
});
const reporter = (type: string, message0: string, args0: Json[], output: string | null, tooltip: string, colour: number): Json => ({
    type,
    message0,
    args0,
    output,
    colour,
    tooltip,
    inputsInline: true,
});
const socket = (name: string, check?: string): Json => ({ type: "input_value", name, ...(check ? { check } : {}) });
const dropdown = (name: string, options: [string, string][]): Json => ({ type: "field_dropdown", name, options });

/** Blockly's own category colours, so the built-ins read like Blockly's blocks. */
const HUES = { logic: 210, loops: 120, math: 230, text: 160, lists: 260, time: 330, web: 190, data: 290 } as const;

/** This panel's own blocks, beside Blockly's. */
export const BUILTIN_BLOCKS: Json[] = [
    hat(BUILTIN.onRun, { message0: "When Run is clicked", args0: [] }, "Runs when you click Run"),
    statement(BUILTIN.wait, "Wait %1 seconds", [socket("SECONDS", "Number")], "Waits before the next step"),
    statement(BUILTIN.waitUntil, "Wait until %1", [socket("BOOL", "Boolean")], "Waits until the condition is true, checking twice a second"),
    statement(BUILTIN.log, "Log %1", [socket("TEXT")], "Writes to the run log"),
    statement(BUILTIN.stop, "Stop this flow", [], "Ends this run here, without an error"),
    statement(BUILTIN.fail, "Fail with %1", [socket("MESSAGE", "String")], "Ends this run with an error, unless an \"if it fails\" catches it"),
    {
        type: BUILTIN.attempt,
        message0: "Try %1",
        args0: [{ type: "input_dummy" }],
        message1: "%1",
        args1: [{ type: "input_statement", name: "DO" }],
        message2: "If it fails %1",
        args2: [{ type: "input_dummy" }],
        message3: "%1",
        args3: [{ type: "input_statement", name: "CATCH" }],
        previousStatement: null,
        nextStatement: null,
        colour: HUE.builtin,
        tooltip: "Runs the first steps; if one fails, runs the second ones instead of ending the flow",
    },
    reporter(BUILTIN.errorMessage, "error message", [], "String", "What went wrong, inside \"If it fails\"", HUE.builtin),
    reporter(BUILTIN.hasValue, "%1 has a value", [socket("VALUE")], "Boolean", "False when a value is missing, like the reason of a ban nobody gave a reason for", HUES.logic),
    reporter(BUILTIN.textTest, "%1 %2 %3", [socket("TEXT", "String"), dropdown("OP", [["contains", "CONTAINS"], ["starts with", "STARTS"], ["ends with", "ENDS"]]), socket("PART", "String")], "Boolean", "Checks for a piece of text", HUES.text),
    reporter(BUILTIN.regexTest, "%1 matches pattern %2", [socket("TEXT", "String"), socket("PATTERN", "String")], "Boolean", "Checks text against a regular expression", HUES.text),
    reporter(BUILTIN.regexFind, "find pattern %1 in %2", [socket("PATTERN", "String"), socket("TEXT", "String")], "String", "The first match (or its first group); empty text when nothing matches", HUES.text),
    reporter(BUILTIN.toNumber, "number from %1", [socket("TEXT", "String")], "Number", "Reads text as a number", HUES.text),
    reporter(BUILTIN.base64, "%1 %2 as base64", [dropdown("MODE", [["encode", "ENCODE"], ["decode", "DECODE"]]), socket("TEXT", "String")], "String", "Base64 encoding", HUES.text),
    reporter(BUILTIN.randomId, "random ID", [], "String", "A new random unique ID", HUES.math),
    reporter(BUILTIN.jsonParse, "read JSON %1", [socket("TEXT", "String")], null, "Turns JSON text into a value", HUES.data),
    reporter(BUILTIN.jsonText, "%1 as JSON", [socket("VALUE")], "String", "Turns a value into JSON text", HUES.data),
    reporter(BUILTIN.getKey, "%1 of object %2", [socket("KEY", "String"), socket("OBJECT")], null, "One key of an object, like a web answer's", HUES.data),
    reporter(BUILTIN.now, "now", [], "Number", "This moment, as a timestamp", HUES.time),
    reporter(BUILTIN.timeFormat, "%1 as %2", [socket("TIME", "Number"), dropdown("FORMAT", [["date and time", "DATETIME"], ["date", "DATE"], ["time", "TIME"], ["weekday", "WEEKDAY"], ["ISO text", "ISO"]])], "String", "A timestamp as text, in this computer's time zone", HUES.time),
    reporter(BUILTIN.timePart, "%1 of %2", [dropdown("PART", [["year", "YEAR"], ["month", "MONTH"], ["day", "DAY"], ["hour", "HOUR"], ["minute", "MINUTE"], ["second", "SECOND"]]), socket("TIME", "Number")], "Number", "One part of a timestamp, in this computer's time zone", HUES.time),
    reporter(BUILTIN.timeAdd, "%1 %2 after %3", [socket("AMOUNT", "Number"), dropdown("UNIT", [["seconds", "SECONDS"], ["minutes", "MINUTES"], ["hours", "HOURS"], ["days", "DAYS"]]), socket("TIME", "Number")], "Number", "A later timestamp; a negative amount goes back", HUES.time),
    reporter(BUILTIN.webGet, "get %1 as %2", [socket("URL", "String"), dropdown("AS", [["text", "TEXT"], ["JSON", "JSON"]])], null, "Fetches a web address (https, or http on this computer)", HUES.web),
    reporter(BUILTIN.webPost, "post %1 to %2 and read %3", [socket("BODY"), socket("URL", "String"), dropdown("AS", [["JSON", "JSON"], ["text", "TEXT"]])], null, "Sends a value as JSON to a web address (https, or http on this computer)", HUES.web),
];

const num = (n: number) => ({ shadow: { type: "math_number", fields: { NUM: n } } });
const txt = (t: string) => ({ shadow: { type: "text", fields: { TEXT: t } } });
const b = (type: string, inputs?: Json, extra: Json = {}): Json => ({ kind: "block", type, ...(inputs ? { inputs } : {}), ...extra });

/** The built-in blocks the interpreter runs, by section. */
export const BUILTIN_SECTIONS: { name: string; icon: string; contents: Json[]; custom?: string }[] = [
    {
        name: "Flow",
        icon: "alt_route",
        contents: [
            b(BUILTIN.onRun),
            b(BUILTIN.wait, { SECONDS: num(1) }),
            b(BUILTIN.waitUntil),
            b(BUILTIN.log, { TEXT: txt("") }),
            b("controls_if"),
            b("controls_repeat_ext", { TIMES: num(10) }),
            b("controls_whileUntil"),
            b("controls_forEach"),
            b("controls_flow_statements"),
            b(BUILTIN.attempt),
            b(BUILTIN.errorMessage),
            b(BUILTIN.fail, { MESSAGE: txt("") }),
            b(BUILTIN.stop),
        ],
    },
    {
        name: "Logic",
        icon: "rule",
        contents: [...["logic_compare", "logic_operation", "logic_negate", "logic_boolean", "logic_ternary"].map((type) => b(type)), b(BUILTIN.hasValue)],
    },
    {
        name: "Math",
        icon: "calculate",
        contents: [
            b("math_number", undefined, { fields: { NUM: 0 } }),
            b("math_arithmetic", { A: num(1), B: num(1) }),
            b("math_single", { NUM: num(9) }),
            b("math_round", { NUM: num(3.1) }),
            b("math_modulo", { DIVIDEND: num(64), DIVISOR: num(10) }),
            b("math_constrain", { VALUE: num(50), LOW: num(1), HIGH: num(100) }),
            b("math_number_property", { NUMBER_TO_CHECK: num(0) }),
            b("math_on_list"),
            b("math_random_int", { FROM: num(1), TO: num(100) }),
            b("math_random_float"),
            b(BUILTIN.randomId),
        ],
    },
    {
        name: "Text",
        icon: "format_quote",
        contents: [
            b("text"),
            b("text_join"),
            b("text_length", { VALUE: txt("") }),
            b("text_isEmpty", { VALUE: txt("") }),
            b(BUILTIN.textTest, { TEXT: txt(""), PART: txt("") }),
            b("text_indexOf", { FIND: txt("") }),
            b("text_charAt"),
            b("text_getSubstring"),
            b("text_changeCase", { TEXT: txt("") }),
            b("text_trim", { TEXT: txt("") }),
            b("text_replace", { FROM: txt(""), TO: txt(""), TEXT: txt("") }),
            b("text_count", { SUB: txt(""), TEXT: txt("") }),
            b("text_reverse", { TEXT: txt("") }),
            b(BUILTIN.toNumber, { TEXT: txt("") }),
            b(BUILTIN.regexTest, { TEXT: txt(""), PATTERN: txt("") }),
            b(BUILTIN.regexFind, { PATTERN: txt(""), TEXT: txt("") }),
            b(BUILTIN.base64, { TEXT: txt("") }),
        ],
    },
    {
        name: "Lists",
        icon: "format_list_bulleted",
        contents: [
            b("lists_create_empty"),
            b("lists_create_with"),
            b("lists_repeat", { NUM: num(5) }),
            b("lists_length"),
            b("lists_isEmpty"),
            b("lists_indexOf"),
            b("lists_getIndex"),
            b("lists_setIndex"),
            b("lists_getSublist"),
            b("lists_split", { DELIM: txt(",") }),
            b("lists_sort"),
            b("lists_reverse"),
        ],
    },
    {
        name: "Time",
        icon: "schedule",
        contents: [
            b(BUILTIN.now),
            b(BUILTIN.timeFormat, { TIME: { block: { type: BUILTIN.now } } }),
            b(BUILTIN.timePart, { TIME: { block: { type: BUILTIN.now } } }),
            b(BUILTIN.timeAdd, { AMOUNT: num(1), TIME: { block: { type: BUILTIN.now } } }),
        ],
    },
    {
        name: "Web",
        icon: "language",
        contents: [
            b(BUILTIN.webGet, { URL: txt("") }),
            b(BUILTIN.webPost, { URL: txt("") }),
            b(BUILTIN.jsonParse, { TEXT: txt("") }),
            b(BUILTIN.jsonText),
            b(BUILTIN.getKey, { KEY: txt("") }),
        ],
    },
    { name: "Variables", icon: "data_object", contents: [], custom: "VARIABLE" },
];
