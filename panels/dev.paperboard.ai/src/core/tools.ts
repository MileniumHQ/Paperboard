// The Paperboard block registry as the model sees it: which commands and
// values of other panels are callable, how a call's arguments are checked,
// and how results come back. appActions.ts offers them through two fixed
// search and call tools.

import type { BlockInfo } from "@mileniumhq/paperapi";

/**
 * A command or value of another panel, as the model's tools use it. `action`
 * is the block's registry entry ("command.kick", or "project/command.kick"
 * in a project of the panel), the part of a call's id after the panel.
 */
export interface RegistryAction {
    panelId: string;
    action: string;
    schema: {
        name?: string;
        description?: string;
        inputs?: Record<string, RegistryInput>;
    };
}

export interface RegistryInput {
    /** the block input's type: "text", "number", "boolean", "list<player>", ... */
    type: string;
    label?: string;
    description?: string;
    required?: boolean;
    options?: { label: string; value: unknown }[];
}

const NUMBER_TYPES: ReadonlySet<string> = new Set(["number", "duration", "timestamp"]);

/**
 * The commands and values every panel lists (blocksApi.list), in the shape
 * the tools use. Events and types are not callable and are left out. An
 * input is required unless it is optional or has a default.
 */
export function blocksToRegistry(infos: readonly BlockInfo[]): RegistryAction[] {
    const out: RegistryAction[] = [];
    for (const info of infos) {
        const schema = info.schema;
        if (schema.kind !== "command" && schema.kind !== "value") continue;
        const inputs: Record<string, RegistryInput> = {};
        for (const [key, input] of Object.entries(schema.inputs ?? {})) {
            inputs[key] = {
                type: input.type,
                label: input.name,
                ...(input.description ? { description: input.description } : {}),
                required: input.optional !== true && input.default === undefined,
                ...(input.choices && input.choices.length > 0 ? { options: input.choices } : {}),
            };
        }
        out.push({
            panelId: info.panelId,
            action: info.entry,
            schema: { name: schema.name, ...(schema.description ? { description: schema.description } : {}), inputs },
        });
    }
    return out;
}

/** A registry entry ("command.kick", "world/value.players") as the block it names. */
export function parseBlockEntry(entry: string): { kind: "command" | "value"; id: string; project?: string } {
    const match = /^(?:(.+)\/)?(command|value)\.(.+)$/.exec(entry);
    if (!match) throw new Error(`"${entry}" is not a command or value`);
    return { kind: match[2] as "command" | "value", id: match[3]!, ...(match[1] ? { project: match[1] } : {}) };
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

/** the tools offered to the model in one round */
export interface ToolSet {
    tools: OllamaTool[];
}

export interface ToolTarget {
    panelId: string;
    action: string;
    label: string;
    inputs: Record<string, RegistryInput>;
}

// Panels whose blocks are never offered as tools. The terminal's commands
// would be an unapproved-per-command shell; the built-in shell tool asks
// before every command instead.
const EXCLUDED_PANELS: ReadonlySet<string> = new Set(["dev.paperboard.terminal"]);

export function isCallableAction(entry: RegistryAction, ownPanelId: string): boolean {
    if (entry.panelId === ownPanelId) return false; // no self-recursion
    if (EXCLUDED_PANELS.has(entry.panelId)) return false;
    return true;
}

export class ToolArgumentError extends Error {}

/**
 * Checks a model's arguments against the block's declared inputs before
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
        const numeric = NUMBER_TYPES.has(input.type);
        if (numeric && typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
            value = Number(value);
        } else if (input.type === "boolean" && (value === "true" || value === "false")) {
            value = value === "true";
        }
        if (numeric && typeof value !== "number") {
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
