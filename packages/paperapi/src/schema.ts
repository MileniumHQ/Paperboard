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
    name: string;
    description?: string;
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
    /** payload field to compare, dotted path allowed */
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
}

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
