// Paperboard's actions as the agent's tools, without listing them: every
// installed panel registers dozens, so the agent gets two tools and a line
// naming the panels. `find_actions` searches (at most MAX_FOUND answers, each
// with its inputs) and `run_action` runs one by panel and action id.
//
// Authority: this is the panel service's own scoped credential calling the
// daemon's action registry, exactly as any panel's flows do. The daemon lists
// every registered action and refuses another panel's `internal` ones
// (papercrane/actions.ts, ActionsRegistry.call); this module hides the same
// set up front and refuses it again at run time, plus its own panel's actions
// (the agent has no business rewriting itself) and event-only actions
// (they aren't callable).

import { PANEL_ID } from "../contract";
import type { ToolResult } from "./computerMcp";
import type { ToolSpec } from "./computerTools";
import type { Toolset } from "./toolsets";

export const MAX_FOUND = 10;
const MAX_PANEL_NAMES = 20;
const MAX_INPUT_BYTES = 64 * 1024;
const MAX_RESULT_CHARS = 16_000;
const MAX_QUERY = 200;
const LIST_TTL_MS = 10_000;
const DEFAULT_CALL_MS = 30_000;
const MAX_CALL_MS = 60_000; // the daemon refuses a longer deadline

/** what actionsApi gives back; the fields this module reads */
export interface ActionEntry {
    panelId: string;
    action: string;
    schema?: {
        name?: string;
        description?: string;
        internal?: boolean;
        deprecated?: string;
        eventOnly?: boolean;
        category?: string | { name?: string };
        inputs?: Record<string, { type?: string; label?: string; description?: string; required?: boolean; options?: { label: string; value: unknown }[]; default?: unknown }>;
        output?: string | { type?: string; description?: string };
    };
}

export interface ActionsHost {
    list(): Promise<ActionEntry[]>;
    call(panel: string, action: string, inputs: unknown, o: { timeoutMs: number }): Promise<unknown>;
}

export interface ActionsToolsetDeps {
    host: ActionsHost;
    enabled(): boolean;
    now?(): number;
}

export const ACTION_TOOLS: ToolSpec[] = [
    {
        name: "find_actions",
        description:
            "Search the actions other Paperboard panels offer (start a game server, post to Discord, ...). " +
            `Returns at most ${MAX_FOUND} matches with the inputs each takes. Give a search \`query\`, or just a \`panel\` to see what it offers.`,
        inputSchema: { type: "object", properties: { query: { type: "string" }, panel: { type: "string", description: "A panel id, to look only at its actions." } } },
    },
    {
        name: "run_action",
        description: "Run one action found with `find_actions`, with its inputs as an object. Returns the action's output or its error.",
        inputSchema: {
            type: "object",
            properties: {
                panel: { type: "string" },
                action: { type: "string" },
                inputs: { type: "object", description: "Values by input name, as find_actions showed them." },
                timeout_seconds: { type: "integer", minimum: 1, maximum: 60 },
            },
            required: ["panel", "action"],
        },
    },
];

/** Is this one the agent may find and run? */
export function offered(a: ActionEntry): boolean {
    const s = a.schema;
    if (a.panelId === PANEL_ID) return false;
    // no schema: plumbing registered by name (state, reload), not something with a documented purpose
    if (!s) return false;
    if (s.internal === true || s.eventOnly === true || s.deprecated) return false;
    return true;
}

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
            return `Other Paperboard panels can do things for you: ${named}. Use \`find_actions\` to search what they offer, then \`run_action\`. Never run an action the user wouldn't expect; say what you did.`;
        },
        call: async (name, args) => {
            if (!deps.enabled()) return fault("The user has switched Paperboard actions off for you.");
            try {
                return name === "find_actions" ? await find(args) : await run(args);
            } catch (e) {
                console.error(`[ai] ${name} failed:`, message(e));
                return fault(message(e));
            }
        },
    };

    async function find(args: Record<string, unknown>): Promise<ToolResult> {
        const query = typeof args.query === "string" ? args.query.trim().slice(0, MAX_QUERY).toLowerCase() : "";
        const panel = typeof args.panel === "string" ? args.panel.trim() : "";
        if (!query && !panel) return fault("Say what to look for (query) or which panel (panel).");
        const words = query.split(/[\s,._:/-]+/).filter(Boolean);
        const scored = (await listed(true))
            .filter((a) => !panel || a.panelId === panel)
            .map((a) => ({ a, score: score(a, words) }))
            .filter((x) => !words.length || x.score > 0)
            .sort((x, y) => y.score - x.score || x.a.panelId.localeCompare(y.a.panelId) || x.a.action.localeCompare(y.a.action));
        if (!scored.length) return { text: "No actions match." };
        const shown = scored.slice(0, MAX_FOUND).map(({ a }) => describe(a));
        const more = scored.length - shown.length;
        return { text: JSON.stringify({ actions: shown, ...(more > 0 ? { more: `${more} more match; narrow the query or name a panel` } : {}) }, null, 1) };
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
        if (!target) return fault(`${panel}:${action} isn't an action you can run. Use find_actions.`);
        const seconds = Number(args.timeout_seconds);
        const timeoutMs = Number.isFinite(seconds) && seconds >= 1 ? Math.min(seconds * 1000, MAX_CALL_MS) : DEFAULT_CALL_MS;
        const result = await deps.host.call(panel, action, inputs, { timeoutMs });
        const out = result === undefined ? "Done (the action returned nothing)." : typeof result === "string" ? result : JSON.stringify(result, null, 1);
        return { text: out.length > MAX_RESULT_CHARS ? out.slice(0, MAX_RESULT_CHARS) + `\n… ${out.length - MAX_RESULT_CHARS} characters cut …` : out };
    }
}

function score(a: ActionEntry, words: string[]): number {
    if (!words.length) return 1;
    const s = a.schema!;
    const category = typeof s.category === "string" ? s.category : s.category?.name ?? "";
    const fields: [string, number][] = [
        [a.action, 4],
        [s.name ?? "", 4],
        [a.panelId, 2],
        [category, 2],
        [s.description ?? "", 1],
    ];
    let total = 0;
    for (const w of words) {
        for (const [text, weight] of fields) if (text.toLowerCase().includes(w)) total += weight;
    }
    return total;
}

function describe(a: ActionEntry) {
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
    return {
        panel: a.panelId,
        action: a.action,
        name: s.name,
        description: cut(s.description ?? "", 300),
        inputs,
        ...(output ? { output } : {}),
    };
}

const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const fault = (text: string): ToolResult => ({ isError: true, text });
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
