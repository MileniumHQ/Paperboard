// Turns the Paperboard action registry into Ollama tool definitions, and a
// model's tool call back into the panel action it names.

/** The slice of actionsApi.list() entries this module reads. */
export interface RegistryAction {
    panelId: string;
    action: string;
    schema?: {
        name?: string;
        description?: string;
        internal?: boolean;
        eventOnly?: boolean;
        inputs?: Record<string, RegistryInput>;
    };
}

export interface RegistryInput {
    type: string;
    label?: string;
    description?: string;
    placeholder?: string;
    required?: boolean;
    optional?: boolean;
    default?: unknown;
    options?: { label: string; value: unknown }[];
    typeName?: string;
}

export interface OllamaTool {
    type: "function";
    function: {
        name: string;
        description: string;
        parameters: {
            type: "object";
            properties: Record<string, JsonSchemaProperty>;
            required: string[];
        };
    };
}

interface JsonSchemaProperty {
    type: "string" | "number" | "boolean" | "object";
    description?: string;
    enum?: unknown[];
}

export interface ToolTarget {
    panelId: string;
    action: string;
    label: string;
    inputs: Record<string, RegistryInput>;
}

export interface ToolSet {
    tools: OllamaTool[];
    /** tool function name → the action it calls */
    targets: Map<string, ToolTarget>;
}

const MAX_NAME = 64;

function slug(value: string): string {
    return value.replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "x";
}

/** "dev.paperboard.gameserver" + "start-server" → "gameserver__start-server" */
export function toolName(panelId: string, action: string): string {
    const panel = slug(panelId.split(".").pop() ?? panelId);
    return `${panel}__${slug(action)}`.slice(0, MAX_NAME);
}

function jsonType(type: string): JsonSchemaProperty["type"] {
    if (type === "number") return "number";
    if (type === "boolean") return "boolean";
    if (type === "object") return "object";
    // string, file (a path), any, and panel-defined types travel as text
    return "string";
}

function describeInput(input: RegistryInput): string {
    const parts = [input.label, input.description].filter((p): p is string => Boolean(p && p.trim()));
    if (input.placeholder) parts.push(`e.g. ${input.placeholder}`);
    if (input.typeName && !["string", "number", "boolean"].includes(input.type)) parts.push(`(${input.typeName})`);
    return parts.join(". ");
}

// Panels whose actions are never offered as tools. The terminal's actions
// would be an unapproved-per-command shell; the built-in shell tool asks
// before every command instead.
const EXCLUDED_PANELS: ReadonlySet<string> = new Set(["dev.paperboard.terminal"]);

export function isCallableAction(entry: RegistryAction, ownPanelId: string): boolean {
    if (entry.panelId === ownPanelId) return false; // no self-recursion
    if (EXCLUDED_PANELS.has(entry.panelId)) return false;
    const s = entry.schema;
    if (!s) return false; // bare handlers have no contract to describe
    return !s.internal && !s.eventOnly;
}

/**
 * Every callable action of every other panel, as tools. Names are stable
 * for a given registry (sorted, collisions suffixed).
 */
export function buildToolSet(
    registry: RegistryAction[],
    ownPanelId: string,
    panelNames: Record<string, string> = {},
): ToolSet {
    const callable = registry
        .filter((e) => isCallableAction(e, ownPanelId))
        .sort((a, b) => `${a.panelId}:${a.action}`.localeCompare(`${b.panelId}:${b.action}`));
    const tools: OllamaTool[] = [];
    const targets = new Map<string, ToolTarget>();
    for (const entry of callable) {
        const schema = entry.schema!;
        let name = toolName(entry.panelId, entry.action);
        for (let n = 2; targets.has(name); n++) {
            const suffix = `_${n}`;
            name = `${toolName(entry.panelId, entry.action).slice(0, MAX_NAME - suffix.length)}${suffix}`;
        }
        const inputs = schema.inputs ?? {};
        const properties: Record<string, JsonSchemaProperty> = {};
        const required: string[] = [];
        for (const [key, input] of Object.entries(inputs)) {
            const prop: JsonSchemaProperty = { type: jsonType(input.type) };
            const description = describeInput(input);
            if (description) prop.description = description;
            const values = input.options?.map((o) => o.value).filter((v) => ["string", "number", "boolean"].includes(typeof v));
            if (values && values.length > 0) prop.enum = values;
            properties[key] = prop;
            if (input.required === true) required.push(key);
        }
        const label = schema.name || entry.action;
        const app = panelNames[entry.panelId] ?? entry.panelId;
        tools.push({
            type: "function",
            function: {
                name,
                description: [`${app}: ${label}.`, schema.description].filter(Boolean).join(" "),
                parameters: { type: "object", properties, required },
            },
        });
        targets.set(name, { panelId: entry.panelId, action: entry.action, label, inputs });
    }
    return { tools, targets };
}

export class ToolArgumentError extends Error {}

/**
 * Checks a model's arguments against the action's declared inputs before
 * anything runs: unknown keys dropped, required keys present, scalars
 * coerced where the model sent "5" for a number. The target panel still
 * validates at its own boundary; this keeps garbage out of the approval
 * card and gives the model a precise error to correct.
 */
export function prepareArguments(target: ToolTarget, raw: unknown): Record<string, unknown> {
    let args: unknown = raw;
    if (typeof args === "string") {
        try {
            args = args.trim() ? JSON.parse(args) : {};
        } catch {
            throw new ToolArgumentError("arguments must be a JSON object");
        }
    }
    if (args === null || args === undefined) args = {};
    if (typeof args !== "object" || Array.isArray(args)) {
        throw new ToolArgumentError("arguments must be a JSON object");
    }
    const given = args as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [key, input] of Object.entries(target.inputs)) {
        let value = given[key];
        if (value === undefined || value === null || value === "") {
            if (input.required === true) throw new ToolArgumentError(`missing required argument "${key}"`);
            continue;
        }
        if (input.type === "number" && typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
            value = Number(value);
        } else if (input.type === "boolean" && (value === "true" || value === "false")) {
            value = value === "true";
        }
        if (input.type === "number" && typeof value !== "number") {
            throw new ToolArgumentError(`argument "${key}" must be a number`);
        }
        if (input.type === "boolean" && typeof value !== "boolean") {
            throw new ToolArgumentError(`argument "${key}" must be true or false`);
        }
        if (input.options && input.options.length > 0 && !input.options.some((o) => o.value === value)) {
            const allowed = input.options.map((o) => JSON.stringify(o.value)).join(", ");
            throw new ToolArgumentError(`argument "${key}" must be one of ${allowed}`);
        }
        out[key] = value;
    }
    return out;
}

export const MAX_TOOL_RESULT_CHARS = 8000;

/** What the model reads back after a call. Bounded. */
export function formatToolResult(value: unknown): string {
    let text: string;
    if (value === undefined) text = "Done (the action returned no value).";
    else if (typeof value === "string") text = value;
    else {
        try {
            text = JSON.stringify(value, null, 2) ?? String(value);
        } catch {
            // circular or BigInt values: the string form is still a result
            text = String(value);
        }
    }
    if (text.length > MAX_TOOL_RESULT_CHARS) {
        text = `${text.slice(0, MAX_TOOL_RESULT_CHARS)}\n[truncated: ${text.length - MAX_TOOL_RESULT_CHARS} more characters]`;
    }
    return text;
}

/** Key for remembered approvals: identity-scoped, never a bare action name. */
export function permissionKey(panelId: string, action: string): string {
    return `${panelId}:${action}`;
}
