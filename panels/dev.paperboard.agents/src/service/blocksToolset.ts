// Paperboard's blocks as the agent's tools: every panel's commands, values,
// types and events, the same registry the Blocks panel builds flows from,
// served on the agent's own MCP endpoint. Every installed panel registers
// dozens, so the agent's instructions name the panels and `list_blocks`
// shows what one offers, or one of its projects (a server, a bot), or one
// block in full. `run_block` runs a command or reads a value, `block_field`
// reads a field of a typed value (a server's status), and `block_choices`
// gives what an input takes (which servers there are). Events are listed,
// with the values they carry, because they're what a flow starts from, but
// never run. Flows are the user's to build in the Blocks panel.
//
// Authority: this is the panel service's own scoped credential calling the
// daemon's Blocks registry, exactly as the Blocks panel's flows do. The
// daemon never lists another panel's `internal` blocks and refuses to call
// them (apps/daemon/src/rpc/blocks.ts). This module also withholds its own
// panel's blocks (the agent has its own tools for itself) and every block of
// the panels in WITHHELD_PANELS, both from the list and again at run time.

import { errorMessage, parseTypeRef, type BlockChoice, type BlockInfo, type BlockInputSchema, type BlockProjectInfo, type BlockSchema, type ParsedType } from "@mileniumhq/paperapi";
import { PANEL_ID } from "../contract";
import type { ToolResult } from "./computerMcp";
import type { ToolSpec } from "./computerTools";
import { fault, type Toolset } from "./toolsets";

/**
 * Panels whose blocks the agent never gets. Its computer is its own; the terminal panel runs shell commands on
 * this one as the user, which would step straight past that boundary.
 * A hard-coded panel id, which the repo rules discourage; the owner chose it.
 */
const WITHHELD_PANELS: ReadonlySet<string> = new Set(["dev.paperboard.terminal"]);

/** the most blocks, projects or choices one answer shows */
const MAX_LISTED = 100;
// a list cuts descriptions short; one block asked for by name shows its whole description
const MAX_DESCRIPTION = 300;
const MAX_LONE_DESCRIPTION = 4000;
const MAX_PANEL_NAMES = 20;
const MAX_INPUT_BYTES = 64 * 1024;
const MAX_RESULT_CHARS = 16_000;
const LIST_TTL_MS = 10_000;
const DEFAULT_CALL_MS = 30_000;
const MAX_CALL_MS = 60_000; // the daemon refuses a longer deadline

interface CallOptions {
    project?: string;
    timeoutMs: number;
}

/** What the toolset needs of the Blocks registry: blocksApi, or one in memory in a test. */
export interface BlocksRegistry {
    list(): Promise<BlockInfo[]>;
    projects(): Promise<BlockProjectInfo[]>;
    run(panel: string, command: string, inputs: Record<string, unknown>, o: CallOptions): Promise<unknown>;
    read(panel: string, value: string, inputs: Record<string, unknown>, o: CallOptions): Promise<unknown>;
    property(typeRef: string, field: string, value: unknown, o: CallOptions): Promise<unknown>;
    choices(panel: string, entry: string, input: string, o: CallOptions): Promise<BlockChoice[]>;
    typeChoices(typeRef: string, o: CallOptions): Promise<BlockChoice[]>;
}

export interface BlocksToolsetDeps {
    registry: BlocksRegistry;
    enabled(): boolean;
    now?(): number;
}

const projectArg = { type: "string", description: "A project id list_blocks showed, for a block in that project." };
const timeoutArg = { type: "integer", minimum: 1, maximum: MAX_CALL_MS / 1000 };

const BLOCK_TOOLS: ToolSpec[] = [
    {
        name: "list_blocks",
        description:
            "What one Paperboard panel can do, as blocks (start a game server, post to Discord, ...): its commands and values with the inputs each takes, " +
            "its types and their fields, its events (what a flow starts from, with the values each carries), and its projects (a server, a bot, ...). " +
            "Name a `project` for that project's blocks, or a `block` (\"command.start\", \"value.status\") to see it in full; " +
            `a list cuts descriptions at ${MAX_DESCRIPTION} characters.`,
        inputSchema: {
            type: "object",
            properties: {
                panel: { type: "string", description: "A panel id." },
                project: projectArg,
                block: { type: "string", description: 'A block as listed ("command.start"), for that one block in full.' },
            },
            required: ["panel"],
        },
    },
    {
        name: "run_block",
        description:
            "Run a command block, or read a value block, that list_blocks showed, with its inputs as an object. " +
            "An input of a panel's type takes one of that type's values (see block_choices). Events can't be run. Returns what the block gives back, or its error.",
        inputSchema: {
            type: "object",
            properties: {
                panel: { type: "string" },
                block: { type: "string", description: '"command.<id>" or "value.<id>", as listed.' },
                project: projectArg,
                inputs: { type: "object", description: "Values by input key, as list_blocks showed them." },
                timeout_seconds: timeoutArg,
            },
            required: ["panel", "block"],
        },
    },
    {
        name: "block_field",
        description: "Read one field of a value of a panel's type (a server's status, a member's name), as that type's panel answers it.",
        inputSchema: {
            type: "object",
            properties: {
                type: { type: "string", description: 'The type, as list_blocks named it ("panel.id:type").' },
                field: { type: "string", description: "A field key the type lists." },
                value: { description: "The value whose field to read, as a block gave it." },
                project: { type: "string", description: "The project to read it in: needed for a field marked perProject." },
                timeout_seconds: timeoutArg,
            },
            required: ["type", "field", "value"],
        },
    },
    {
        name: "block_choices",
        description:
            "The values an input takes now (which servers, which channels), as a list of { label, value }: name the `panel`, `block` and `input`, " +
            'or a `type` ("panel.id:type") for every value of that type there is.',
        inputSchema: {
            type: "object",
            properties: {
                panel: { type: "string" },
                block: { type: "string" },
                input: { type: "string", description: "An input key the block lists." },
                type: { type: "string", description: "A type, in place of panel, block and input." },
                project: projectArg,
                timeout_seconds: timeoutArg,
            },
        },
    },
];

/** Is this one the agent may find? Events among them are listed but never run. */
export function offered(b: Pick<BlockInfo, "panelId" | "schema">): boolean {
    if (b.panelId === PANEL_ID || WITHHELD_PANELS.has(b.panelId)) return false;
    return !("internal" in b.schema && b.schema.internal === true);
}

/** The block a registry entry is, without its project: "command.start". */
const blockOf = (b: BlockInfo) => (b.project ? b.entry.slice(b.project.length + 1) : b.entry);
const typeRefOf = (b: BlockInfo) => `${b.panelId}:${blockOf(b).slice("type.".length)}`;

export function blocksToolset(deps: BlocksToolsetDeps): Toolset {
    const now = deps.now ?? Date.now;
    let cache: { at: number; list: BlockInfo[] } | null = null;
    const listed = async (fresh = false) => {
        if (!fresh && cache && now() - cache.at < LIST_TTL_MS) return cache.list;
        const list = (await deps.registry.list()).filter(offered);
        cache = { at: now(), list };
        return list;
    };

    return {
        id: "blocks",
        tools: () => (deps.enabled() ? BLOCK_TOOLS : []),
        instructions: async () => {
            if (!deps.enabled()) return "";
            let panels: string[];
            try {
                panels = [...new Set((await listed()).map((b) => b.panelId))].sort();
            } catch (e) {
                console.error("[agents] couldn't list other panels' blocks:", errorMessage(e));
                return "Other Paperboard panels' blocks: the list isn't available right now (" + errorMessage(e) + ").";
            }
            if (!panels.length) return "Other Paperboard panels offer no blocks right now.";
            const named = panels.slice(0, MAX_PANEL_NAMES).join(", ") + (panels.length > MAX_PANEL_NAMES ? `, and ${panels.length - MAX_PANEL_NAMES} more` : "");
            return (
                `**Other panels:** ${named} can do things for you, as blocks. See what one offers with \`list_blocks\`, then \`run_block\`. Never run one the user wouldn't expect, and say what you did. ` +
                "To make something happen on its own (when a message arrives, when someone joins), the user builds a flow in the Blocks panel, starting from an event `list_blocks` shows; you can't make or edit flows."
            );
        },
        call: async (name, args) => {
            if (!deps.enabled()) return fault("The user has switched Paperboard's blocks off for you.");
            try {
                if (name === "list_blocks") return await list(args);
                if (name === "run_block") return await run(args);
                if (name === "block_field") return await field(args);
                return await choices(args);
            } catch (e) {
                console.error(`[agents] ${name} failed:`, errorMessage(e));
                return fault(errorMessage(e));
            }
        },
    };

    /** The block named, as the registry has it now: what may run is decided against it, not against an older list. */
    async function find(args: Record<string, unknown>): Promise<BlockInfo | ToolResult> {
        const panel = text(args.panel);
        const block = text(args.block);
        const project = text(args.project);
        if (!panel || !block) return fault("Say which panel and block.");
        const found = (await listed(true)).find((b) => b.panelId === panel && blockOf(b) === block && (b.project ?? "") === project);
        if (found) return found;
        const where = project ? `${panel}'s project "${project}"` : panel;
        return fault(`${where} has no block "${block}" you can use. See list_blocks${project ? "" : ", and name the project for a project's blocks"}.`);
    }

    async function list(args: Record<string, unknown>): Promise<ToolResult> {
        const panel = text(args.panel);
        const project = text(args.project);
        const block = text(args.block);
        if (!panel) return fault("Say which panel.");
        const mine = (await listed(true)).filter((b) => b.panelId === panel);
        if (!mine.length) return fault(`${panel} offers no blocks you can use.`);
        if (block) {
            const one = await find({ panel, block, project });
            return "text" in one ? one : json(describe(one, MAX_LONE_DESCRIPTION));
        }
        const shown = (list: BlockInfo[]) => {
            const blocks = list.filter((b) => b.schema.kind !== "type");
            const types = list.filter((b) => b.schema.kind === "type");
            return {
                ...(types.length ? { types: types.slice(0, MAX_LISTED).map((b) => describe(b, MAX_DESCRIPTION)) } : {}),
                blocks: blocks.slice(0, MAX_LISTED).map((b) => describe(b, MAX_DESCRIPTION)),
                ...(blocks.length > MAX_LISTED ? { more: `${blocks.length - MAX_LISTED} more blocks aren't shown` } : {}),
            };
        };
        const projects = (await deps.registry.projects()).filter((p) => p.panelId === panel);
        if (project) {
            const named = projects.find((p) => p.id === project);
            if (!named) return fault(`${panel} has no project "${project}". List the panel's blocks to see its projects.`);
            return json({ panel, project: { id: named.id, name: named.name }, ...shown(mine.filter((b) => b.project === project)) });
        }
        return json({
            panel,
            ...shown(mine.filter((b) => !b.project)),
            ...(projects.length
                ? {
                      projects: projects.slice(0, MAX_LISTED).map((p) => ({ id: p.id, name: p.name, blocks: mine.filter((b) => b.project === p.id).length })),
                      ...(projects.length > MAX_LISTED ? { moreProjects: `${projects.length - MAX_LISTED} more projects aren't shown` } : {}),
                  }
                : {}),
        });
    }

    async function run(args: Record<string, unknown>): Promise<ToolResult> {
        const target = await find(args);
        if ("text" in target) return target;
        const { kind } = target.schema;
        const name = `${target.panelId}:${blockOf(target)}`;
        if (kind === "event") return fault(`${name} is an event: it starts flows and can't be run. A flow in the Blocks panel starts from it.`);
        if (kind === "type") return fault(`${name} is a type: read a value's field with block_field, or its values with block_choices.`);
        if (args.inputs !== undefined && !isObject(args.inputs)) return fault("inputs is an object of values by input key.");
        const inputs = (args.inputs ?? {}) as Record<string, unknown>;
        if (JSON.stringify(inputs).length > MAX_INPUT_BYTES) return fault(`inputs are limited to ${MAX_INPUT_BYTES / 1024} KB.`);
        const id = blockOf(target).slice(kind.length + 1);
        const o = options(args, target.project);
        const result = kind === "command" ? await deps.registry.run(target.panelId, id, inputs, o) : await deps.registry.read(target.panelId, id, inputs, o);
        return answer(result, kind === "command" ? "Done (the block gives nothing back)." : "It reads as nothing.");
    }

    async function field(args: Record<string, unknown>): Promise<ToolResult> {
        const typeRef = text(args.type);
        const key = text(args.field);
        if (!typeRef || !key) return fault("Say which type and field.");
        const type = (await listed(true)).find((b) => b.schema.kind === "type" && typeRefOf(b) === typeRef);
        if (!type || type.schema.kind !== "type") return fault(`"${typeRef}" isn't a type you can use. list_blocks names a panel's types.`);
        const def = type.schema.fields?.[key];
        if (!def) return fault(`${typeRef} has no field "${key}". Its fields: ${Object.keys(type.schema.fields ?? {}).join(", ") || "none"}.`);
        const project = text(args.project);
        if (def.perProject && !project) return fault(`${typeRef}'s ${key} is read in one of ${type.panelId}'s projects: name it.`);
        if (JSON.stringify(args.value ?? null).length > MAX_INPUT_BYTES) return fault(`the value is limited to ${MAX_INPUT_BYTES / 1024} KB.`);
        return answer(await deps.registry.property(typeRef, key, args.value ?? null, options(args, project || undefined)), "It reads as nothing.");
    }

    async function choices(args: Record<string, unknown>): Promise<ToolResult> {
        const typeRef = text(args.type);
        if (typeRef) return typeValues(typeRef, args, text(args.project) || undefined);
        const input = text(args.input);
        if (!input) return fault("Name a type, or a panel, block and input.");
        const target = await find(args);
        if ("text" in target) return target;
        const schema = target.schema as BlockSchema & { inputs?: Record<string, BlockInputSchema> };
        const def = schema.inputs?.[input];
        if (!def) return fault(`${target.panelId}:${blockOf(target)} has no input "${input}". Its inputs: ${Object.keys(schema.inputs ?? {}).join(", ") || "none"}.`);
        if (def.choices) return choiceList(def.choices);
        if (def.dynamicChoices) return choiceList(await deps.registry.choices(target.panelId, target.entry, input, options(args, target.project)));
        const custom = customType(def.type);
        // a type's values are listed in a project of the type's own panel: another panel's type has none of this one's projects
        if (custom) return typeValues(custom, args, custom.startsWith(`${target.panelId}:`) ? target.project : undefined);
        return fault(`${input} takes any ${def.type}${def.default !== undefined ? ` (it's ${JSON.stringify(def.default)} when left out)` : ""}; there's no list of choices.`);
    }

    async function typeValues(typeRef: string, args: Record<string, unknown>, project: string | undefined): Promise<ToolResult> {
        const type = (await listed(true)).find((b) => b.schema.kind === "type" && typeRefOf(b) === typeRef);
        if (!type || type.schema.kind !== "type") return fault(`"${typeRef}" isn't a type you can use. list_blocks names a panel's types.`);
        if (!type.schema.dynamicChoices) return fault(`${typeRef} doesn't list its values: a block that gives one is how to get one.`);
        return choiceList(await deps.registry.typeChoices(typeRef, options(args, project)));
    }
}

/** The custom type an input of this type takes values of, list or not. */
function customType(ref: string): string | null {
    let t: ParsedType;
    try {
        t = parseTypeRef(ref);
    } catch {
        return null; // quiet: the registry qualified it; an unparseable one simply has no list of choices
    }
    while (t.kind === "list") t = t.item;
    return t.kind === "custom" && t.panelId ? `${t.panelId}:${t.id}` : null;
}

function options(args: Record<string, unknown>, project: string | undefined): CallOptions {
    const seconds = Number(args.timeout_seconds);
    const timeoutMs = Number.isFinite(seconds) && seconds >= 1 ? Math.min(seconds * 1000, MAX_CALL_MS) : DEFAULT_CALL_MS;
    return { timeoutMs, ...(project ? { project } : {}) };
}

function choiceList(list: BlockChoice[]): ToolResult {
    if (!list.length) return { text: "There are none right now." };
    return json({
        choices: list.slice(0, MAX_LISTED).map((c) => ({ label: c.label, value: c.value })),
        ...(list.length > MAX_LISTED ? { more: `${list.length - MAX_LISTED} more aren't shown` } : {}),
    });
}

function answer(result: unknown, nothing: string): ToolResult {
    const out = result === undefined || result === null ? nothing : typeof result === "string" ? result : JSON.stringify(result, null, 1);
    return { text: out.length > MAX_RESULT_CHARS ? out.slice(0, MAX_RESULT_CHARS) + `\n… ${out.length - MAX_RESULT_CHARS} characters cut …` : out };
}

function describe(b: BlockInfo, descriptionChars: number) {
    const s = b.schema;
    const base = {
        ...(s.kind === "type" ? { type: typeRefOf(b) } : { block: blockOf(b) }),
        name: s.name,
        ...(s.kind !== "type" && s.category ? { category: s.category } : {}),
        ...(s.description ? { description: cut(s.description, descriptionChars) } : {}),
    };
    if (s.kind === "type") {
        const fields: Record<string, unknown> = {};
        for (const [key, f] of Object.entries(s.fields ?? {}).slice(0, 32)) {
            fields[key] = { type: f.type, name: f.name, ...(f.description ? { description: cut(f.description, 200) } : {}), ...(f.optional ? { optional: true } : {}), ...(f.perProject ? { perProject: true } : {}) };
        }
        return { ...base, base: s.base, ...(Object.keys(fields).length ? { fields } : {}), ...(s.dynamicChoices ? { listsValues: true } : {}) };
    }
    const inputs: Record<string, unknown> = {};
    for (const [key, p] of Object.entries(s.inputs ?? {})) {
        inputs[key] = {
            type: p.type,
            ...(p.name && p.name !== key ? { name: p.name } : {}),
            ...(p.description ? { description: cut(p.description, 200) } : {}),
            ...(p.optional ? { optional: true } : {}),
            ...(p.default !== undefined ? { default: p.default } : {}),
            ...(p.choices?.length ? { choices: p.choices.slice(0, 12).map((c) => c.value) } : {}),
            ...(p.dynamicChoices ? { choices: "ask block_choices" } : {}),
            ...(p.min !== undefined ? { min: p.min } : {}),
            ...(p.max !== undefined ? { max: p.max } : {}),
            ...(p.integer ? { integer: true } : {}),
            ...(p.maxLength !== undefined ? { maxLength: p.maxLength } : {}),
        };
    }
    const withInputs = { ...base, ...(Object.keys(inputs).length ? { inputs } : {}) };
    if (s.kind === "command") return { ...withInputs, ...(s.output ? { output: s.output } : {}) };
    if (s.kind === "value") return { ...withInputs, type: s.type };
    const values: Record<string, string> = {};
    for (const [key, v] of Object.entries(s.values ?? {})) values[key] = `${v.type}${v.optional ? " (optional)" : ""}`;
    return { ...withInputs, event: true, ...(Object.keys(values).length ? { values } : {}) };
}

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const json = (v: unknown): ToolResult => ({ text: JSON.stringify(v, null, 1) });
const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
