export type PrimitiveType =
    | "string"
    | "number"
    | "boolean"
    | "object"
    | "file"
    | "void"
    | "any";

export type DataType = PrimitiveType | (string & {});

export interface CustomTypeDefinition {
    id: string;
    /** what the flow builder calls values of this type ("Channel") */
    name: string;
    description?: string;
    /** material icon shown with variables of this type */
    icon?: string;
    base: PrimitiveType;
    defaultField?: string;
    toString?: (value: any) => string;
    fields?: Record<
        string,
        {
            type: DataType;
            label?: string;
            description?: string;
            optional?: boolean;
        }
    >;
}

export interface ActionParamDefinition {
    type: DataType;
    label: string;
    description?: string;
    placeholder?: string;
    default?: any;
    required?: boolean;
    optional?: boolean;
    options?: { label: string; value: any }[];
    /**
     * The dropdown offers an unselected entry (an empty value). For a match
     * input an unselected entry means "any": the rule holds whatever the
     * payload carries. `emptyLabel` names it where "(any)" would be wrong
     * ("Default model", for example).
     */
    allowEmpty?: boolean;
    emptyLabel?: string;
    /** the editor renders a wrapping multi-line value field for this input */
    multiline?: boolean;
    /** display name for the type badge; defaults to the raw type id */
    typeName?: string;
    /**
     * Limits on the value (on each item of a list). The flow editor shows a
     * broken limit on the block before the flow runs, and the SDK refuses a
     * call that breaks one before `run` sees it; see `checkActionInput`.
     */
    min?: number;
    max?: number;
    /** a whole number */
    integer?: boolean;
    /** characters of text */
    maxLength?: number;
    /** items in a list */
    maxItems?: number;
}

export interface ActionOutputDefinition {
    type: DataType;
    label?: string;
    description?: string;
}

/**
 * A named field on a structured output (typically a trigger payload). The
 * flow builder offers these as typed variables, so an object output can be
 * wired into typed inputs field by field.
 */
export interface ActionOutputFieldDefinition {
    type: DataType;
    label?: string;
    description?: string;
    /** display name for the type badge; defaults to the registered type's name */
    typeName?: string;
    /** material icon shown with the field; defaults to the source's icon */
    icon?: string;
}

// panel-authored grouping for the Actions library; panels name their own
// sections ("Messages", "Players", ...) instead of the library splitting
// everything into one Triggers list and one Actions list
export interface ActionCategoryDefinition {
    name: string;
    /** material icon for the section */
    icon?: string;
    /** lower sorts first; unordered categories sort alphabetically after */
    order?: number;
}

export type ActionCategory = string | ActionCategoryDefinition;

/**
 * One routing rule for a parameterized event action: when the event fires,
 * a root block only accepts it if `payload[field]` equals the block's
 * literal `values[input]`. Fully declarative — the panel names the payload
 * field and the input; the flow owner applies one generic comparison, so
 * nothing here (or anywhere in the mechanism) knows what an "interaction"
 * or a "customId" is. Arrays of rules are ANDed.
 */
export interface ActionMatchDefinition {
    /**
     * Payload field to compare, dotted path allowed. `"$"` means the payload
     * itself, for events whose whole output is the value (a model name).
     */
    field: string;
    /** declared input whose literal value the payload field must equal */
    input: string;
}

export interface ActionSchema {
    id: string;
    name: string;
    description: string;
    /**
     * Hidden from the Actions library but still callable through the API:
     * control-plane RPCs a panel's own UI needs, never flow blocks.
     */
    internal?: boolean;
    /**
     * The action is on its way out: it still runs, but the Actions library
     * stops offering it and every block already placed shows this message,
     * which says what to do instead and when the action goes away.
     */
    deprecated?: string;
    template?: string;
    writtenOut?: string;
    category?: ActionCategory;
    inputs?: Record<string, ActionParamDefinition>;
    output?: ActionOutputDefinition | DataType;
    outputFields?: Record<string, ActionOutputFieldDefinition | DataType>;
    quick?: boolean;
    icon?: string;
    /**
     * Stamped by the SDK on listen-only actions: they fire as events and
     * start flows, but are not callable and cannot nest.
     */
    eventOnly?: boolean;
    /**
     * Parameterized event routing (event actions only): roots of this
     * action fire only when every rule holds. Without it, the event
     * fans out to every root, as before.
     */
    match?: ActionMatchDefinition | ActionMatchDefinition[];
    /**
     * Stamped by the SDK at registration: every custom type this action
     * names (inputs, output, output fields, and the fields of those types),
     * so the flow builder learns the panel's types from the registry.
     */
    types?: Record<string, ActionTypeInfo>;
}

/** What a schema carries about a custom type: its definition minus code. */
export type ActionTypeInfo = Omit<CustomTypeDefinition, "toString">;

export interface ActionDefinition<
    TInputs = any,
    TOutput = any,
> extends ActionSchema {
    /** Executes when a flow run reaches the block. Absent on event actions. */
    run?: (
        ctx: any,
        inputs: TInputs,
    ) => Promise<TOutput> | TOutput;
    /** Arms an event action: wires its source to `emit` until unsubscribed. */
    listen?: (
        ctx: any,
        emit: (output: TInputs) => void,
    ) => () => void;
}

/**
 * The single validator for a panel-authored action definition, applied at
 * registration (the boundary that owns the schema contract). Exported pure
 * so tests and callers share one implementation.
 */
export function validateActionDefinition(def: ActionDefinition): void {
    if (!def || typeof def !== "object" || typeof def.id !== "string" || !def.id) {
        throw new Error("An action definition requires an id");
    }
    const label = `Action "${def.id}"`;
    if (def.run && def.listen) {
        throw new Error(
            `${label} declares both run and listen; an action either executes or fires, never both`,
        );
    }
    const matches = normalizeMatchRules(def.match);
    if (matches.length > 0 && def.run) {
        throw new Error(
            `${label} declares match rules but is callable; matching routes events, and a callable action is not an event source`,
        );
    }
    for (const [key, input] of Object.entries(def.inputs || {})) {
        const problem = describeLimitProblem(input);
        if (problem) throw new Error(`${label} input "${key}" ${problem}`);
    }
    for (const rule of matches) {
        if (typeof rule.field !== "string" || !rule.field.trim()) {
            throw new Error(`${label} declares a match rule without a payload field`);
        }
        const input = rule.input;
        if (typeof input !== "string" || !(def.inputs as any)?.[input]) {
            throw new Error(
                `${label} declares a match on undeclared input "${String(input)}"`,
            );
        }
    }
}

function describeLimitProblem(input: ActionParamDefinition): string | undefined {
    for (const name of ["min", "max"] as const) {
        const v = input[name];
        if (v !== undefined && !Number.isFinite(v)) return `declares a ${name} that is not a number`;
    }
    for (const name of ["maxLength", "maxItems"] as const) {
        const v = input[name];
        if (v !== undefined && !(Number.isInteger(v) && v >= 0)) {
            return `declares a ${name} that is not a whole number`;
        }
    }
    if (input.min !== undefined && input.max !== undefined && input.min > input.max) {
        return "declares a min above its max";
    }
    return undefined;
}

export function normalizeMatchRules(
    match: ActionSchema["match"],
): ActionMatchDefinition[] {
    if (!match) return [];
    const list = Array.isArray(match) ? match : [match];
    return list.filter(
        (rule): rule is ActionMatchDefinition =>
            Boolean(rule) && typeof rule === "object",
    );
}

// in-memory type registry
const registeredTypes = new Map<string, CustomTypeDefinition>();

export function defineType(def: CustomTypeDefinition): CustomTypeDefinition {
    registeredTypes.set(def.id, def);
    return def;
}

export function getType(id: string): CustomTypeDefinition | undefined {
    return registeredTypes.get(id);
}

function unwrapListType(type: string): string {
    const match = type.match(/^(?:list|array)<(.+)>$/);
    return match ? unwrapListType(match[1]) : type;
}

function typeOf(spec: unknown): string | undefined {
    if (typeof spec === "string") return spec;
    if (spec && typeof spec === "object" && typeof (spec as any).type === "string") {
        return (spec as any).type;
    }
    return undefined;
}

/**
 * The registered custom types a schema names, closed over their fields, as
 * plain data. Types the panel never defined are not invented.
 */
export function referencedTypeInfo(
    schema: Pick<ActionSchema, "inputs" | "output" | "outputFields">,
): Record<string, ActionTypeInfo> | undefined {
    const pending: string[] = [];
    const name = (spec: unknown) => {
        const type = typeOf(spec);
        if (type) pending.push(unwrapListType(type));
    };
    for (const spec of Object.values(schema.inputs ?? {})) name(spec);
    name(schema.output);
    for (const spec of Object.values(schema.outputFields ?? {})) name(spec);

    const found: Record<string, ActionTypeInfo> = {};
    while (pending.length > 0) {
        const id = pending.pop()!;
        if (found[id]) continue;
        const def = registeredTypes.get(id);
        if (!def) continue;
        const { toString: _code, ...info } = def;
        found[id] = info;
        for (const field of Object.values(def.fields ?? {})) name(field);
    }
    return Object.keys(found).length > 0 ? found : undefined;
}

export function listTypes(): CustomTypeDefinition[] {
    return Array.from(registeredTypes.values());
}

/** true when output satisfies input, including custom base types */
export function isTypeCompatible(outputType: DataType, inputType: DataType): boolean {
    if (outputType === inputType) return true;
    if (inputType === "any" || outputType === "any") return true;

    const custom = registeredTypes.get(outputType);
    if (custom && custom.base === inputType) return true;

    // list<T> -> list<U>
    if (outputType.startsWith("list<") && inputType.startsWith("list<")) {
        const innerOut = outputType.slice(5, -1);
        const innerIn = inputType.slice(5, -1);
        return isTypeCompatible(innerOut, innerIn);
    }

    return false;
}

export function formatValueToString(val: any, typeName?: string): string {
    if (val === undefined || val === null) return "";
    if (typeof val === "string") return val;
    if (typeof val === "number" || typeof val === "boolean") return String(val);

    if (typeName) {
        const custom = getType(typeName);
        if (custom?.toString) {
            return custom.toString(val);
        }
        if (custom?.defaultField && typeof val === "object" && val[custom.defaultField] !== undefined) {
            return String(val[custom.defaultField]);
        }
    }

    if (typeof val === "object") {
        if (typeof val.content === "string") return val.content;
        if (typeof val.text === "string") return val.text;
        if (typeof val.message === "string") return val.message;
        if (typeof val.name === "string") return val.name;
        if (typeof val.value === "string") return val.value;
    }

    return String(val);
}

export function defineAction<TInputs = any, TOutput = any>(
    def: ActionDefinition<TInputs, TOutput>,
): ActionDefinition<TInputs, TOutput> {
    if (!def.template && def.writtenOut) {
        def.template = def.writtenOut;
    }
    return def;
}

type InputLimits = Pick<
    ActionParamDefinition,
    "type" | "label" | "min" | "max" | "integer" | "maxLength" | "maxItems"
>;

function isListType(type: unknown): boolean {
    return typeof type === "string" && /^(?:list|array)<.+>$/.test(type);
}

function isBlankValue(value: unknown): boolean {
    return value === undefined || value === null || value === "";
}

function checkOne(def: InputLimits, value: unknown, name: string): string | undefined {
    const numeric = def.min !== undefined || def.max !== undefined || def.integer;
    if (numeric) {
        const n = typeof value === "number" ? value : Number(value);
        if (typeof value === "boolean" || String(value).trim() === "" || !Number.isFinite(n)) {
            return `${name} must be a number`;
        }
        if (def.integer && !Number.isInteger(n)) return `${name} must be a whole number`;
        if (def.min !== undefined && n < def.min) return `${name} must be at least ${def.min}`;
        if (def.max !== undefined && n > def.max) return `${name} must be at most ${def.max}`;
    }
    if (def.maxLength !== undefined && typeof value === "string" && value.length > def.maxLength) {
        return `${name} holds at most ${def.maxLength} characters (it has ${value.length})`;
    }
    return undefined;
}

/**
 * The first limit this value breaks, as a sentence naming the input, or
 * undefined. An empty value breaks none (`required` is the editor's own
 * check). `isUnknown` marks values that are only known when the flow runs
 * (the editor's variable references): they are skipped, and a list counts
 * only its known items.
 */
export function checkActionInput(
    def: InputLimits,
    value: unknown,
    isUnknown: (value: unknown) => boolean = () => false,
): string | undefined {
    if (isBlankValue(value) || isUnknown(value)) return undefined;
    const name = `"${def.label || "This input"}"`;
    if (isListType(def.type) && Array.isArray(value)) {
        const known = value.filter((item) => !isBlankValue(item) && !isUnknown(item));
        if (def.maxItems !== undefined && known.length > def.maxItems) {
            return `${name} holds at most ${def.maxItems} items (it has ${known.length})`;
        }
        for (let i = 0; i < value.length; i++) {
            const item = value[i];
            if (isBlankValue(item) || isUnknown(item)) continue;
            const problem = checkOne(def, item, `Item ${i + 1} of ${name}`);
            if (problem) return problem;
        }
        return undefined;
    }
    return checkOne(def, value, name);
}

/** Refuses a call whose inputs break a declared limit. */
export function assertActionInputs(
    inputs: Record<string, ActionParamDefinition> | undefined,
    values: Record<string, unknown> | undefined,
): void {
    for (const [key, def] of Object.entries(inputs || {})) {
        const problem = checkActionInput(def, values?.[key]);
        if (problem) throw new Error(problem);
    }
}
