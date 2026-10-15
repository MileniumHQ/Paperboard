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
