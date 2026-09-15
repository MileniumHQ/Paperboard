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

export interface ActionSchema {
    id: string;
    name: string;
    description: string;
    template?: string;
    writtenOut?: string;
    category?: ActionCategory;
    inputs?: Record<string, ActionParamDefinition>;
    output?: ActionOutputDefinition | DataType;
    outputFields?: Record<string, ActionOutputFieldDefinition | DataType>;
    quick?: boolean;
    icon?: string;
}

export interface ActionDefinition<
    TInputs = any,
    TOutput = any,
> extends ActionSchema {
    run: (
        ctx: any,
        inputs: TInputs,
    ) => Promise<TOutput> | TOutput;
}

export interface TriggerSchema {
    id: string;
    name: string;
    description: string;
    template?: string;
    writtenOut?: string;
    category?: ActionCategory;
    output?: ActionOutputDefinition | DataType;
    outputFields?: Record<string, ActionOutputFieldDefinition | DataType>;
    icon?: string;
}

export interface TriggerDefinition<TOutput = any> extends TriggerSchema {
    listen?: (ctx: any, emit: (output: TOutput) => void) => () => void;
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

export function defineTrigger<TOutput = any>(
    def: TriggerDefinition<TOutput>,
): TriggerDefinition<TOutput> {
    if (!def.template && def.writtenOut) {
        def.template = def.writtenOut;
    }
    return def;
}
