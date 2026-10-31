// Paperboard's actions as the agent's tools, without putting them all in its
// prompt: every installed panel registers dozens, so the agent gets two tools
// and a line naming the panels. `list_actions` lists what one panel offers,
// each action with its inputs, and its projects; a project's actions, or one
// action's whole description, on request. `run_action` runs one by panel and
// action id. Actions hidden from the Actions library (made for programs)
// are offered like any other. Flows are the user's to build in the Actions
// panel: its flow API is switched off.
//
// Authority: this is the panel service's own scoped credential calling the
// daemon's action registry, exactly as any panel's flows do. The daemon lists
// every registered action and refuses another panel's `internal` ones
// (papercrane/actions.ts, ActionsRegistry.call); this module hides the same
// set up front and refuses it again at run time, plus its own panel's actions
// (the agent has no business rewriting itself) and every action of the panels
// in WITHHELD_PANELS. Events are listed, with the fields they carry, because
// they're what a flow starts from, but never run: they aren't callable.

import { PANEL_ID } from "../contract";
import type { ToolResult } from "./computerMcp";
import type { ToolSpec } from "./computerTools";
import type { Toolset } from "./toolsets";

/**
 * Panels whose actions the agent never gets. Chippy lives in its own computer; the terminal panel
 * runs shell commands on this one as the user, which would step straight past that boundary.
 * A hard-coded panel id, which the repo rules discourage; the owner chose it.
 */
export const WITHHELD_PANELS: ReadonlySet<string> = new Set(["dev.paperboard.terminal"]);

/** the most actions, or projects, one list shows */
export const MAX_LISTED = 100;
// a list cuts descriptions short; one action asked for by name shows its
// whole description: a program-facing action spells out its input format there
const MAX_DESCRIPTION = 300;
const MAX_LONE_DESCRIPTION = 4000;
const MAX_PANEL_NAMES = 20;
const MAX_INPUT_BYTES = 64 * 1024;
const MAX_RESULT_CHARS = 16_000;
const LIST_TTL_MS = 10_000;
const DEFAULT_CALL_MS = 30_000;
const MAX_CALL_MS = 60_000; // the daemon refuses a longer deadline

/** what actionsApi gives back; the fields this module reads */
export interface ActionEntry {
    panelId: string;
    /** "project/action" for an action in one of its panel's projects */
    action: string;
    /** the project the action is in; absent for a panel's global actions */
    project?: string;
    schema?: {
        name?: string;
        description?: string;
        internal?: boolean;
        hidden?: boolean;
        deprecated?: string;
        eventOnly?: boolean;
        category?: string | { name?: string };
        outputFields?: Record<string, string | { type?: string; label?: string }>;
        inputs?: Record<string, { type?: string; label?: string; description?: string; required?: boolean; options?: { label: string; value: unknown }[]; default?: unknown }>;
        output?: string | { type?: string; description?: string };
    };
}

/** a panel's project: a server, a bot, ... each with its own actions */
export interface ProjectEntry {
    panelId: string;
    id: string;
    name: string;
}

export interface ActionsHost {
    list(): Promise<ActionEntry[]>;
    listProjects(): Promise<ProjectEntry[]>;
    call(panel: string, action: string, inputs: unknown, o: { timeoutMs: number }): Promise<unknown>;
}

export interface ActionsToolsetDeps {
    host: ActionsHost;
    enabled(): boolean;
    now?(): number;
}

export const ACTION_TOOLS: ToolSpec[] = [
    {
        name: "list_actions",
        description:
            "What one Paperboard panel can do (start a game server, post to Discord, ...): every action it offers, with the inputs each takes, " +
            "its events (`event: true`, with the `fields` a flow started by one reads), and its projects (a server, a bot, ...). " +
            "Name a `project` to list that project's actions (\"project/action\"), " +
            `or an \`action\` to see its whole description; a list cuts descriptions at ${MAX_DESCRIPTION} characters.`,
        inputSchema: {
            type: "object",
            properties: {
                panel: { type: "string", description: "A panel id." },
                project: { type: "string", description: "A project id the panel's list showed." },
                action: { type: "string", description: "An action id, for that one action in full." },
            },
            required: ["panel"],
        },
    },
    {
        name: "run_action",
        description: "Run one action listed by `list_actions`, with its inputs as an object. Events can't be run. Returns the action's output or its error.",
        inputSchema: {
            type: "object",
            properties: {
                panel: { type: "string" },
                action: { type: "string" },
                inputs: { type: "object", description: "Values by input name, as list_actions showed them." },
                timeout_seconds: { type: "integer", minimum: 1, maximum: 60 },
            },
            required: ["panel", "action"],
        },
    },
];

/** Is this one the agent may find? Events among them are listed but never run. */
export function offered(a: ActionEntry): boolean {
    const s = a.schema;
    if (a.panelId === PANEL_ID || WITHHELD_PANELS.has(a.panelId)) return false;
    // no schema: plumbing registered by name (state, reload), not something with a documented purpose
    if (!s) return false;
    if (s.internal === true || s.deprecated) return false;
    return true;
}

const isEvent = (a: ActionEntry) => a.schema?.eventOnly === true;

export function actionsToolset(deps: ActionsToolsetDeps): Toolset {
    const now = deps.now ?? Date.now;
    let cache: { at: number; list: ActionEntry[] } | null = null;
    const listed = async (fresh = false) => {
        if (!fresh && cache && now() - cache.at < LIST_TTL_MS) return cache.list;
        const list = (await deps.host.list()).filter(offered);
        cache = { at: now(), list };
        return list;
    };

    return {
        id: "actions",
        tools: () => (deps.enabled() ? ACTION_TOOLS : []),
        instructions: async () => {
            if (!deps.enabled()) return "";
            let panels: string[];
            try {
                panels = [...new Set((await listed()).map((a) => a.panelId))].sort();
            } catch (e) {
                console.error("[ai] couldn't list other panels' actions:", message(e));
                return "Other Paperboard panels' actions: the list isn't available right now (" + message(e) + ").";
            }
            const named = panels.slice(0, MAX_PANEL_NAMES).join(", ") + (panels.length > MAX_PANEL_NAMES ? `, and ${panels.length - MAX_PANEL_NAMES} more` : "");
            if (!panels.length) return "Other Paperboard panels offer no actions right now.";
            return (
                `**Other panels:** ${named} can do things for you. See what one offers with \`list_actions\`, then \`run_action\`. Never run one the user wouldn't expect, and say what you did. ` +
                "To make something happen on its own (when a message arrives, when someone joins), the user builds a flow in the Actions panel; you can't make or edit flows. Its trigger is an event from `list_actions`."
            );
        },
        call: async (name, args) => {
            if (!deps.enabled()) return fault("The user has switched Paperboard actions off for you.");
            try {
                return name === "list_actions" ? await list(args) : await run(args);
            } catch (e) {
                console.error(`[ai] ${name} failed:`, message(e));
                return fault(message(e));
            }
        },
    };

    async function list(args: Record<string, unknown>): Promise<ToolResult> {
        const panel = typeof args.panel === "string" ? args.panel.trim() : "";
        const project = typeof args.project === "string" ? args.project.trim() : "";
        const action = typeof args.action === "string" ? args.action.trim() : "";
        if (!panel) return fault("Say which panel.");
        const mine = (await listed(true)).filter((a) => a.panelId === panel);
        if (!mine.length) return fault(`${panel} offers no actions you can run.`);
        if (action) {
            const one = mine.find((a) => a.action === action);
            if (!one) return fault(`${panel} has no action "${action}" you can run. List its actions without one.`);
            return { text: JSON.stringify(describe(one, MAX_LONE_DESCRIPTION), null, 1) };
        }
        const shown = (list: ActionEntry[]) => ({
            actions: list.slice(0, MAX_LISTED).map((a) => describe(a, MAX_DESCRIPTION)),
            ...(list.length > MAX_LISTED ? { more: `${list.length - MAX_LISTED} more actions aren't shown` } : {}),
        });
        const projects = (await deps.host.listProjects()).filter((p) => p.panelId === panel);
        if (project) {
            const named = projects.find((p) => p.id === project);
            if (!named) return fault(`${panel} has no project "${project}". List the panel's actions to see its projects.`);
            return { text: JSON.stringify({ panel, project: { id: named.id, name: named.name }, ...shown(mine.filter((a) => a.project === project)) }, null, 1) };
        }
        return {
            text: JSON.stringify({
                panel,
                ...shown(mine.filter((a) => !a.project)),
                ...(projects.length
                    ? {
                          projects: projects.slice(0, MAX_LISTED).map((p) => ({ id: p.id, name: p.name, actions: mine.filter((a) => a.project === p.id).length })),
                          ...(projects.length > MAX_LISTED ? { moreProjects: `${projects.length - MAX_LISTED} more projects aren't shown` } : {}),
                      }
                    : {}),
            }, null, 1),
        };
    }

    async function run(args: Record<string, unknown>): Promise<ToolResult> {
        const panel = args.panel;
        const action = args.action;
        if (typeof panel !== "string" || typeof action !== "string" || !panel || !action) return fault("Say which panel and action.");
        if (args.inputs !== undefined && (typeof args.inputs !== "object" || args.inputs === null || Array.isArray(args.inputs))) {
            return fault("inputs is an object of values by input name.");
        }
        const inputs = (args.inputs ?? {}) as Record<string, unknown>;
        if (JSON.stringify(inputs).length > MAX_INPUT_BYTES) return fault(`inputs are limited to ${MAX_INPUT_BYTES / 1024} KB.`);
        // fresh: what may run is decided against the registry as it is now, not as it was found
        const target = (await listed(true)).find((a) => a.panelId === panel && a.action === action);
        if (!target) return fault(`${panel}:${action} isn't an action you can run. See list_actions.`);
        if (isEvent(target)) return fault(`${panel}:${action} is an event: it starts flows and can't be run. Use it as a flow's trigger.`);
        const seconds = Number(args.timeout_seconds);
        const timeoutMs = Number.isFinite(seconds) && seconds >= 1 ? Math.min(seconds * 1000, MAX_CALL_MS) : DEFAULT_CALL_MS;
        const result = await deps.host.call(panel, action, inputs, { timeoutMs });
        const out = result === undefined ? "Done (the action returned nothing)." : typeof result === "string" ? result : JSON.stringify(result, null, 1);
        return { text: out.length > MAX_RESULT_CHARS ? out.slice(0, MAX_RESULT_CHARS) + `\n… ${out.length - MAX_RESULT_CHARS} characters cut …` : out };
    }
}

function categoryOf(a: ActionEntry): string {
    const c = a.schema?.category;
    return typeof c === "string" ? c : c?.name ?? "";
}

function describe(a: ActionEntry, descriptionChars: number) {
    const s = a.schema!;
    const inputs: Record<string, unknown> = {};
    for (const [key, p] of Object.entries(s.inputs ?? {}).slice(0, 24)) {
        inputs[key] = {
            type: p.type,
            ...(p.label && p.label !== key ? { label: p.label } : {}),
            ...(p.description ? { description: cut(p.description, 200) } : {}),
            ...(p.required ? { required: true } : {}),
            ...(p.options?.length ? { options: p.options.slice(0, 12).map((o) => o.value) } : {}),
        };
    }
    const output = typeof s.output === "string" ? s.output : s.output?.type;
    const fields: Record<string, string> = {};
    for (const [key, f] of Object.entries(s.outputFields ?? {}).slice(0, 24)) {
        const type = typeof f === "string" ? f : f.type ?? "";
        const label = typeof f === "string" ? "" : f.label ?? "";
        fields[key] = label && label !== key ? `${type} (${label})` : type;
    }
    return {
        panel: a.panelId,
        action: a.action,
        ...(a.project ? { project: a.project } : {}),
        name: s.name,
        ...(categoryOf(a) ? { category: categoryOf(a) } : {}),
        ...(isEvent(a) ? { event: true } : {}),
        description: cut(s.description ?? "", descriptionChars),
        inputs,
        ...(output && !isEvent(a) ? { output } : {}),
        ...(Object.keys(fields).length ? { fields } : {}),
    };
}

const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const fault = (text: string): ToolResult => ({ isError: true, text });
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
