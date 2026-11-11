// Actions API v2: what a panel registers for the Blocks panel, and the one
// validator for it. Pure, so the SDK, the Blocks panel and tests share it.
//
// Four kinds of block, all drawn from definitions:
//   - event: a hat block. Fires with a payload; each payload value is a
//     typed reporter inside the flow it starts.
//   - command: a statement block that does something, and may give back a
//     typed value. What it gives back is in the block's gear: reporters for
//     the value and each of its type's fields, bound to that one block.
//   - value: a reporter for live state the panel keeps (player count). It
//     only reads. One that says when it changes also offers "when it changes".
//   - type: what a value is. A type's fields become properties: one
//     "[field] of [value]" reporter, read off the value itself or looked up
//     by the panel.
//
// Values travel as JSON. A type names its base (text, number, boolean or
// object), and a value of the type is that JSON.

/** The types every panel shares. A timestamp and a duration are milliseconds. */
export const CORE_TYPES = ["text", "number", "boolean", "timestamp", "duration", "color", "url", "any"] as const;
export type CoreType = (typeof CORE_TYPES)[number];

/** What a custom type's values are on the wire. */
export type TypeBase = "text" | "number" | "boolean" | "object";

/**
 * A type reference: a core type ("text"), a type this panel defines
 * ("player"), another panel's type ("dev.paperboard.botcreator:channel"),
 * or a list of any of these ("list<player>").
 */
export type TypeRef = string;

export type ParsedType =
    | { kind: "core"; name: CoreType }
    | { kind: "custom"; panelId: string | null; id: string }
    | { kind: "list"; item: ParsedType };

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const PANEL_ID = /^[a-z0-9][a-z0-9.-]{0,127}$/;
const MAX_LIST_DEPTH = 4;
const MAX_NAME = 64;
const MAX_DESCRIPTION = 512;
const MAX_TEXT = 160;
const MAX_INPUTS = 16;
const MAX_FIELDS = 32;
const MAX_CHOICES = 256;

export function parseTypeRef(ref: unknown, depth = 0): ParsedType {
    if (typeof ref !== "string" || !ref) throw new Error(`a type must be named, got ${JSON.stringify(ref)}`);
    const list = /^list<(.+)>$/.exec(ref);
    if (list) {
        if (depth >= MAX_LIST_DEPTH) throw new Error(`"${ref}" nests lists deeper than ${MAX_LIST_DEPTH}`);
        return { kind: "list", item: parseTypeRef(list[1], depth + 1) };
    }
    if ((CORE_TYPES as readonly string[]).includes(ref)) return { kind: "core", name: ref as CoreType };
    const colon = ref.indexOf(":");
    if (colon === -1) {
        if (!ID.test(ref)) throw new Error(`"${ref}" is not a type: use a core type (${CORE_TYPES.join(", ")}), a type id, "panel:type" or "list<type>"`);
        return { kind: "custom", panelId: null, id: ref };
    }
    const panelId = ref.slice(0, colon);
    const id = ref.slice(colon + 1);
    if (!PANEL_ID.test(panelId) || !ID.test(id)) throw new Error(`"${ref}" is not a type: another panel's type is "panel.id:type"`);
    return { kind: "custom", panelId, id };
}

/** The reference with every custom type named by its panel, as the registry stores it. */
export function qualifyTypeRef(ref: TypeRef, panelId: string): TypeRef {
    const write = (t: ParsedType): string =>
        t.kind === "list" ? `list<${write(t.item)}>` : t.kind === "core" ? t.name : `${t.panelId ?? panelId}:${t.id}`;
    return write(parseTypeRef(ref));
}

// ─── Definitions ────────────────────────────────────────────────────────────

/** What a block call knows about where it runs. */
export interface BlockContext {
    panelId: string;
    /** the project the block belongs to; absent on the panel's own blocks */
    project?: string;
}

export interface BlockChoice {
    label: string;
    value: string | number | boolean;
}

/** Choices the panel works out when they're asked for: the worlds a server has now. */
export type BlockChoicesFunction = (ctx: BlockContext) => BlockChoice[] | Promise<BlockChoice[]>;

export interface BlockInputDefinition {
    type: TypeRef;
    /** what the input is called where the block's text can't show it */
    name: string;
    description?: string;
    /** the block runs without it; the run sees it absent */
    optional?: boolean;
    /**
     * A dropdown of these instead of a socket. A function is asked each
     * time the dropdown opens and each time the block runs, so the list
     * follows what the panel has now.
     */
    choices?: BlockChoice[] | BlockChoicesFunction;
    /** what the input holds until someone changes it, and what it is when left out */
    default?: string | number | boolean;
    /** limits a number (min, max, integer) or text (maxLength) */
    min?: number;
    max?: number;
    integer?: boolean;
    maxLength?: number;
}

export interface BlockFieldDefinition<V = any> {
    type: TypeRef;
    name: string;
    description?: string;
    /** a value may not have it (a member without a nickname); it reads as nothing */
    optional?: boolean;
    /**
     * Resolve needs to know which project asks (is this player online on
     * this server?): the field is offered in each project's section, and
     * resolve's context names the project.
     */
    perProject?: boolean;
    /**
     * Looks the field up. Without it the field is read off the value
     * itself (an object value's own key), which costs nothing.
     */
    resolve?: (value: V, ctx: BlockContext) => unknown | Promise<unknown>;
}

export interface BlockTypeDefinition<V = any> {
    id: string;
    /** what a value of the type is called ("Player") */
    name: string;
    description?: string;
    /** a Material Symbols name */
    icon?: string;
    base: TypeBase;
    fields?: Record<string, BlockFieldDefinition<V>>;
    /**
     * The values of the type there are now (the servers, a server's online
     * players), so an input of the type starts as a dropdown of them; a
     * block can still be put in its place. Asked in a project when the
     * input's block is in one of this panel's projects.
     */
    choices?: BlockChoicesFunction;
}

/** A toolbox section a panel's blocks name in `category`, with the symbol its heading shows. */
export interface BlockCategoryDefinition {
    name: string;
    /** a Material Symbols name */
    icon: string;
}

/** A block's inputs, by key. */
export type BlockDefinitionBaseInputs = Record<string, BlockInputDefinition>;

interface BlockDefinitionBase {
    id: string;
    name: string;
    description?: string;
    /** the toolbox section the block sits in */
    category?: string;
    /** a Material Symbols name */
    icon?: string;
    /**
     * What the block says, with each input in braces where its socket sits:
     * "Kick {player} because {reason}". Defaults to the name, with any
     * inputs after it.
     */
    text?: string;
    inputs?: Record<string, BlockInputDefinition>;
}

export interface BlockCommandDefinition<I = any, O = any> extends BlockDefinitionBase {
    /** the type of what it returns; absent when it returns nothing */
    output?: TypeRef;
    /**
     * What it gives back is called, as its gear shows it ("Answer"). Needed
     * for a core type or a list; a custom type is called by its own name.
     */
    outputName?: string;
    run: (inputs: I, ctx: BlockContext) => O | Promise<O>;
}

export interface BlockValueDefinition<I = any, O = any> extends BlockDefinitionBase {
    type: TypeRef;
    /**
     * The panel says when the value changes (the handle's `changed`), so
     * the Blocks panel offers "when it changes". Leave it off for a value
     * that never says so.
     */
    changes?: boolean;
    read: (inputs: I, ctx: BlockContext) => O | Promise<O>;
}

export interface BlockEventValueDefinition {
    type: TypeRef;
    name: string;
    description?: string;
    /** a firing may leave it out (the channel someone left, when they only joined); it reads as nothing */
    optional?: boolean;
}

export interface BlockEventDefinition extends BlockDefinitionBase {
    /** the payload it fires with: each key a typed value inside the flow */
    values?: Record<string, BlockEventValueDefinition>;
    /**
     * Inputs that narrow which firings start the flow: the flow runs only
     * when payload[value] equals the input's literal. Unset means any.
     */
    filters?: Record<string, string>;
}

export type BlockKind = "type" | "command" | "value" | "event";

// ─── What reaches the registry ──────────────────────────────────────────────

/** An input as the registry lists it: choices worked out by a function are asked for when needed. */
export type BlockInputSchema = Omit<BlockInputDefinition, "choices"> & { choices?: BlockChoice[]; dynamicChoices?: true };

type WithInputSchemas<T> = Omit<T, "inputs"> & {
    inputs?: Record<string, BlockInputSchema>;
    /** the symbol of the block's category, when its panel declared that category */
    categoryIcon?: string;
};

/** A definition as the registry lists it: code removed, every type qualified. */
export type BlockSchema =
    | ({ kind: "type" } & Omit<BlockTypeDefinition, "fields" | "choices"> & {
          fields?: Record<string, Omit<BlockFieldDefinition, "resolve"> & { resolved?: true }>;
          /** the panel lists the type's values (blocksApi.typeChoices) */
          dynamicChoices?: true;
      })
    | ({ kind: "command" } & WithInputSchemas<Omit<BlockCommandDefinition, "run">>)
    | ({ kind: "value" } & WithInputSchemas<Omit<BlockValueDefinition, "read">>)
    | ({ kind: "event" } & WithInputSchemas<BlockEventDefinition>);

/** The registry entry a definition is registered under. */
export function blockEntry(kind: BlockKind, id: string, project?: string): string {
    return project ? `${project}/${kind}.${id}` : `${kind}.${id}`;
}

// ─── Validation ─────────────────────────────────────────────────────────────

const describe = (kind: BlockKind, id: unknown) => `${kind[0]!.toUpperCase()}${kind.slice(1)} "${String(id)}"`;

function assertLabel(value: unknown, what: string, max = MAX_NAME): void {
    if (typeof value !== "string" || !value.trim()) throw new Error(`${what} needs a name`);
    if (value.length > max) throw new Error(`${what} is longer than ${max} characters`);
}

function assertOptionalText(value: unknown, what: string, max: number): void {
    if (value === undefined) return;
    if (typeof value !== "string") throw new Error(`${what} must be text`);
    if (value.length > max) throw new Error(`${what} is longer than ${max} characters`);
}

function assertType(ref: unknown, what: string, known: (t: ParsedType) => string | null): void {
    let parsed: ParsedType;
    try {
        parsed = parseTypeRef(ref);
    } catch (err) {
        throw new Error(`${what}: ${(err as Error).message}`);
    }
    const walk = (t: ParsedType): void => {
        if (t.kind === "list") return walk(t.item);
        const problem = known(t);
        if (problem) throw new Error(`${what}: ${problem}`);
    };
    walk(parsed);
}

function assertInputs(def: BlockDefinitionBase, label: string, known: (t: ParsedType) => string | null, lookup: TypeLookup, panelId: string): void {
    const inputs = def.inputs ?? {};
    const keys = Object.keys(inputs);
    if (keys.length > MAX_INPUTS) throw new Error(`${label} has more than ${MAX_INPUTS} inputs`);
    for (const key of keys) {
        const input = inputs[key]!;
        const what = `${label} input "${key}"`;
        if (!ID.test(key)) throw new Error(`${what} must be named with lowercase letters, digits and dashes`);
        assertLabel(input.name, what);
        assertOptionalText(input.description, `${what} description`, MAX_DESCRIPTION);
        assertType(input.type, what, known);
        const parsed = parseTypeRef(input.type);
        for (const limit of ["min", "max"] as const) {
            const v = input[limit];
            if (v !== undefined && !Number.isFinite(v)) throw new Error(`${what} declares a ${limit} that is not a number`);
        }
        if (input.min !== undefined && input.max !== undefined && input.min > input.max) throw new Error(`${what} declares a min above its max`);
        if (input.maxLength !== undefined && !(Number.isInteger(input.maxLength) && input.maxLength >= 0)) {
            throw new Error(`${what} declares a maxLength that is not a whole number`);
        }
        const numeric = input.min !== undefined || input.max !== undefined || input.integer;
        if (numeric && !(parsed.kind === "core" && ["number", "timestamp", "duration"].includes(parsed.name))) {
            throw new Error(`${what} limits a number, but takes ${input.type}`);
        }
        if (typeof input.choices === "function") {
            // asked for when needed; checked then
        } else if (input.choices !== undefined) {
            if (!Array.isArray(input.choices) || input.choices.length === 0) throw new Error(`${what} declares choices, but none`);
            if (input.choices.length > MAX_CHOICES) throw new Error(`${what} has more than ${MAX_CHOICES} choices`);
            const seen = new Set<unknown>();
            for (const choice of input.choices) {
                assertLabel(choice?.label, `${what} choice`);
                if (!["string", "number", "boolean"].includes(typeof choice.value)) throw new Error(`${what} choice "${choice.label}" needs a text, number or boolean value`);
                if (seen.has(choice.value)) throw new Error(`${what} offers the value ${JSON.stringify(choice.value)} twice`);
                seen.add(choice.value);
            }
        }
        if (input.default !== undefined) {
            if (!["string", "number", "boolean"].includes(typeof input.default)) throw new Error(`${what} default must be text, a number or true/false`);
            const { choices, ...rest } = input;
            const problem = inputProblem({ ...rest, type: qualifyTypeRef(input.type, panelId), ...(Array.isArray(choices) ? { choices } : {}) }, input.default, lookup);
            if (problem) throw new Error(`${what} default: ${problem}`);
        }
    }
    if (def.text !== undefined) {
        assertLabel(def.text, `${label} text`, MAX_TEXT);
        const named = [...def.text.matchAll(/\{([^}]*)\}/g)].map((m) => m[1]!);
        for (const name of named) {
            if (!(name in inputs)) throw new Error(`${label} text names {${name}}, which is not one of its inputs`);
        }
        for (const key of keys) {
            const count = named.filter((n) => n === key).length;
            if (count !== 1) throw new Error(`${label} text must show {${key}} once, not ${count} times`);
        }
    }
}

function assertBase(def: BlockDefinitionBase, kind: BlockKind): string {
    if (!def || typeof def !== "object") throw new Error(`A ${kind} definition must be an object`);
    const label = describe(kind, def.id);
    if (typeof def.id !== "string" || !ID.test(def.id)) throw new Error(`${label} needs an id of lowercase letters, digits and dashes, at most 64`);
    assertLabel(def.name, label);
    assertOptionalText(def.description, `${label} description`, MAX_DESCRIPTION);
    assertOptionalText(def.category, `${label} category`, MAX_NAME);
    assertOptionalText(def.icon, `${label} icon`, MAX_NAME);
    return label;
}

/**
 * Checks a panel's definitions as one set: ids are unique per kind, and
 * every custom type a definition names is one of `types` or another
 * panel's ("panel:type"). Throws a message the panel's author can act on.
 */
export function validateBlockDefinitions(set: {
    categories?: BlockCategoryDefinition[];
    types?: BlockTypeDefinition[];
    commands?: BlockCommandDefinition[];
    values?: BlockValueDefinition[];
    events?: BlockEventDefinition[];
}, panelId: string, availableTypes: ReadonlySet<string> = new Set()): void {
    const own = new Set<string>(availableTypes);
    for (const type of set.types ?? []) own.add(type?.id);
    const known = (t: ParsedType): string | null => {
        if (t.kind !== "custom") return null;
        if (t.panelId !== null && t.panelId !== panelId) return null;
        return own.has(t.id) ? null : `the type "${t.id}" is not defined by this panel`;
    };
    // a default is checked against the types this set defines; others are checked when they run
    const defined = new Map((set.types ?? []).map((t) => [`${panelId}:${t?.id}`, t]));
    const lookup: TypeLookup = (qualified) => {
        const type = defined.get(qualified);
        return type ? { base: type.base } : null;
    };
    const assertInputsOf = (def: BlockDefinitionBase, label: string) => {
        assertInputs(def, label, known, lookup, panelId);
    };
    const unique = (kind: BlockKind, defs: { id: string }[]) => {
        const seen = new Set<string>();
        for (const def of defs) {
            if (seen.has(def.id)) throw new Error(`${describe(kind, def.id)} is defined twice`);
            seen.add(def.id);
        }
    };

    for (const type of set.types ?? []) {
        const label = assertBase(type as unknown as BlockDefinitionBase, "type");
        if (!["text", "number", "boolean", "object"].includes(type.base)) throw new Error(`${label} needs a base of text, number, boolean or object`);
        if (type.choices !== undefined && typeof type.choices !== "function") throw new Error(`${label} choices must be a function that lists the values there are now`);
        const fields = Object.entries(type.fields ?? {});
        if (fields.length > MAX_FIELDS) throw new Error(`${label} has more than ${MAX_FIELDS} fields`);
        for (const [key, field] of fields) {
            const what = `${label} field "${key}"`;
            if (!ID.test(key)) throw new Error(`${what} must be named with lowercase letters, digits and dashes`);
            assertLabel(field.name, what);
            assertOptionalText(field.description, `${what} description`, MAX_DESCRIPTION);
            assertType(field.type, what, known);
            if (field.resolve !== undefined && typeof field.resolve !== "function") throw new Error(`${what} resolve must be a function`);
            if (field.perProject && !field.resolve) throw new Error(`${what} is per project, so it needs resolve to look it up in the project`);
            if (!field.resolve && type.base !== "object") throw new Error(`${what} has nothing to read: a ${type.base} value has no keys, so the field needs resolve`);
        }
    }
    for (const command of set.commands ?? []) {
        const label = assertBase(command, "command");
        assertInputsOf(command, label);
        if (command.output !== undefined) {
            assertType(command.output, `${label} output`, known);
            if (command.outputName !== undefined) assertLabel(command.outputName, `${label} output`);
            else if (parseTypeRef(command.output).kind !== "custom") throw new Error(`${label} gives back ${command.output}, so it needs an outputName that says what that is`);
        } else if (command.outputName !== undefined) throw new Error(`${label} has an outputName but no output`);
        if (typeof command.run !== "function") throw new Error(`${label} needs run`);
    }
    for (const value of set.values ?? []) {
        const label = assertBase(value, "value");
        assertInputsOf(value, label);
        assertType(value.type, `${label} type`, known);
        if (typeof value.read !== "function") throw new Error(`${label} needs read`);
        if (value.changes !== undefined && typeof value.changes !== "boolean") throw new Error(`${label} changes must be true or false`);
    }
    for (const event of set.events ?? []) {
        const label = assertBase(event, "event");
        assertInputsOf(event, label);
        const values = event.values ?? {};
        if (Object.keys(values).length > MAX_FIELDS) throw new Error(`${label} fires more than ${MAX_FIELDS} values`);
        for (const [key, v] of Object.entries(values)) {
            const what = `${label} value "${key}"`;
            if (!ID.test(key)) throw new Error(`${what} must be named with lowercase letters, digits and dashes`);
            assertLabel(v.name, what);
            assertType(v.type, what, known);
            if (v.optional !== undefined && typeof v.optional !== "boolean") throw new Error(`${what} optional must be true or false`);
        }
        for (const [input, valueKey] of Object.entries(event.filters ?? {})) {
            if (!event.inputs?.[input]) throw new Error(`${label} filters on "${input}", which is not one of its inputs`);
            if (!values[valueKey]) throw new Error(`${label} filters "${input}" against "${valueKey}", which it does not fire`);
            if (qualifyTypeRef(event.inputs[input]!.type, panelId) !== qualifyTypeRef(values[valueKey]!.type, panelId)) {
                throw new Error(`${label} filters "${input}" (${event.inputs[input]!.type}) against "${valueKey}" (${values[valueKey]!.type}); they must be one type`);
            }
        }
    }
    const names = new Set<string>();
    for (const category of set.categories ?? []) {
        if (!category || typeof category !== "object") throw new Error("A category definition must be an object");
        assertLabel(category.name, "A category");
        assertLabel(category.icon, `Category "${category.name}" icon`);
        if (names.has(category.name)) throw new Error(`Category "${category.name}" is defined twice`);
        names.add(category.name);
    }
    unique("type", set.types ?? []);
    unique("command", set.commands ?? []);
    unique("value", set.values ?? []);
    unique("event", set.events ?? []);
}

// ─── Schemas ────────────────────────────────────────────────────────────────

function qualifyInputs(inputs: BlockDefinitionBase["inputs"], panelId: string): Record<string, BlockInputSchema> | undefined {
    if (!inputs) return undefined;
    return Object.fromEntries(
        Object.entries(inputs).map(([k, { choices, ...v }]) => [
            k,
            { ...v, type: qualifyTypeRef(v.type, panelId), ...(typeof choices === "function" ? { dynamicChoices: true as const } : choices ? { choices } : {}) },
        ]),
    );
}

function strip<T extends object>(def: T, drop: string[]): T {
    return Object.fromEntries(Object.entries(def).filter(([k, v]) => !drop.includes(k) && v !== undefined)) as T;
}

/** The registry's copy of a definition: no code, every type qualified by panel. */
export function blockSchema(kind: BlockKind, def: any, panelId: string): BlockSchema {
    switch (kind) {
        case "type":
            return {
                kind,
                ...strip(def, ["fields", "choices"]),
                ...(def.choices ? { dynamicChoices: true as const } : {}),
                ...(def.fields
                    ? {
                          fields: Object.fromEntries(
                              Object.entries(def.fields as Record<string, BlockFieldDefinition>).map(([k, f]) => [
                                  k,
                                  { ...strip(f, ["resolve"]), type: qualifyTypeRef(f.type, panelId), ...(f.resolve ? { resolved: true as const } : {}) },
                              ]),
                          ),
                      }
                    : {}),
            } as BlockSchema;
        case "command":
            return { kind, ...strip(def, ["run", "inputs", "output"]), ...(def.inputs ? { inputs: qualifyInputs(def.inputs, panelId) } : {}), ...(def.output ? { output: qualifyTypeRef(def.output, panelId) } : {}) } as BlockSchema;
        case "value":
            return { kind, ...strip(def, ["read", "inputs", "type"]), ...(def.inputs ? { inputs: qualifyInputs(def.inputs, panelId) } : {}), type: qualifyTypeRef(def.type, panelId) } as BlockSchema;
        case "event":
            return {
                kind,
                ...strip(def, ["inputs", "values"]),
                ...(def.inputs ? { inputs: qualifyInputs(def.inputs, panelId) } : {}),
                ...(def.values
                    ? { values: Object.fromEntries(Object.entries(def.values as Record<string, BlockEventValueDefinition>).map(([k, v]) => [k, { ...v, type: qualifyTypeRef(v.type, panelId) }])) }
                    : {}),
            } as BlockSchema;
    }
}

// ─── Values ─────────────────────────────────────────────────────────────────

/**
 * What a value is checked against: a type's base, and its readable fields.
 * undefined means no such type; null means it is not the checker's to
 * check (another panel's type, which that panel checks), so any value passes.
 */
export type TypeLookup = (qualified: string) => { base: TypeBase; fields?: Record<string, { type: TypeRef; resolved?: true; optional?: boolean }> } | null | undefined;

/**
 * Why `value` is not a `ref`, or null when it is. Lists check every item,
 * custom types their base and every field read off the value itself.
 * `ref` is qualified; `lookup` answers the custom types it names.
 */
export function valueProblem(ref: TypeRef, value: unknown, lookup: TypeLookup, depth = 0): string | null {
    const t = parseTypeRef(ref);
    if (t.kind === "list") {
        if (!Array.isArray(value)) return `expected a list, got ${describeValue(value)}`;
        for (let i = 0; i < value.length; i++) {
            const problem = valueProblem(`${listItemRef(ref)}`, value[i], lookup, depth);
            if (problem) return `item ${i + 1}: ${problem}`;
        }
        return null;
    }
    if (t.kind === "core") return coreProblem(t.name, value);
    const qualified = `${t.panelId}:${t.id}`;
    const type = lookup(qualified);
    if (type === null) return value === undefined ? "expected a value, got nothing" : null;
    if (!type) return `the type "${qualified}" is not registered`;
    const baseProblem = coreProblem(type.base === "object" ? "any" : type.base, value);
    if (baseProblem) return baseProblem;
    if (type.base === "object") {
        if (!value || typeof value !== "object" || Array.isArray(value)) return `expected an object, got ${describeValue(value)}`;
        if (depth >= 8) return null;
        for (const [key, field] of Object.entries(type.fields ?? {})) {
            if (field.resolved) continue;
            const v = (value as Record<string, unknown>)[key];
            if (field.optional && (v === undefined || v === null)) continue;
            if (!(key in value)) return `the field "${key}" is missing`;
            const problem = valueProblem(field.type, v, lookup, depth + 1);
            if (problem) return `the field "${key}": ${problem}`;
        }
    }
    return null;
}

function listItemRef(ref: TypeRef): TypeRef {
    return ref.slice("list<".length, -1);
}

function coreProblem(name: CoreType | "any", value: unknown): string | null {
    switch (name) {
        case "any":
            return value === undefined ? "expected a value, got nothing" : null;
        case "text":
            return typeof value === "string" ? null : `expected text, got ${describeValue(value)}`;
        case "number":
            return typeof value === "number" && Number.isFinite(value) ? null : `expected a number, got ${describeValue(value)}`;
        case "boolean":
            return typeof value === "boolean" ? null : `expected true or false, got ${describeValue(value)}`;
        case "timestamp":
        case "duration":
            return typeof value === "number" && Number.isFinite(value) ? null : `expected a ${name} in milliseconds, got ${describeValue(value)}`;
        case "color":
            return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value) ? null : `expected a color like #3366ff, got ${describeValue(value)}`;
        case "url":
            return typeof value === "string" && URL.canParse(value) ? null : `expected a web address, got ${describeValue(value)}`;
    }
}

function describeValue(value: unknown): string {
    if (value === null) return "nothing";
    if (value === undefined) return "nothing";
    if (Array.isArray(value)) return "a list";
    if (typeof value === "string") return `the text ${JSON.stringify(value.length > 40 ? `${value.slice(0, 40)}…` : value)}`;
    if (typeof value === "object") return "an object";
    return `${typeof value} ${String(value)}`;
}

/** Inputs with each one left out given its default. */
export function withDefaults(inputs: unknown, defs: Record<string, BlockInputSchema> | undefined): unknown {
    if (inputs !== undefined && inputs !== null && (typeof inputs !== "object" || Array.isArray(inputs))) return inputs;
    const given = { ...((inputs ?? {}) as Record<string, unknown>) };
    for (const [key, def] of Object.entries(defs ?? {})) {
        if (def.default !== undefined && (given[key] === undefined || given[key] === null || given[key] === "")) given[key] = def.default;
    }
    return given;
}

/** Why one input's value doesn't fit it, or null. The value is there: absence is inputsProblem's to judge. */
export function inputProblem(def: BlockInputSchema, value: unknown, lookup: TypeLookup): string | null {
    const problem = valueProblem(def.type, value, lookup);
    if (problem) return `"${def.name}": ${problem}`;
    if (def.choices && !def.choices.some((c) => c.value === value)) return `"${def.name}" must be one of ${def.choices.map((c) => c.label).join(", ")}`;
    if (typeof value === "number") {
        if (def.integer && !Number.isInteger(value)) return `"${def.name}" must be a whole number`;
        if (def.min !== undefined && value < def.min) return `"${def.name}" must be at least ${def.min}`;
        if (def.max !== undefined && value > def.max) return `"${def.name}" must be at most ${def.max}`;
    }
    if (typeof value === "string" && def.maxLength !== undefined && value.length > def.maxLength) {
        return `"${def.name}" must be at most ${def.maxLength} characters`;
    }
    return null;
}

/** Why `inputs` can't be passed to a block with these inputs, or null. */
export function inputsProblem(inputs: unknown, defs: Record<string, BlockInputSchema> | undefined, lookup: TypeLookup): string | null {
    if (inputs !== undefined && inputs !== null && (typeof inputs !== "object" || Array.isArray(inputs))) return "inputs must be an object of values by input";
    const given = (inputs ?? {}) as Record<string, unknown>;
    for (const key of Object.keys(given)) {
        if (!defs?.[key]) return `there is no input "${key}"`;
    }
    for (const [key, def] of Object.entries(defs ?? {})) {
        const value = given[key];
        if (value === undefined || value === null || value === "") {
            if (def.optional) continue;
            return `"${def.name}" is required`;
        }
        const problem = inputProblem(def, value, lookup);
        if (problem) return problem;
    }
    return null;
}
