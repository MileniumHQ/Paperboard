// Other panels' actions, offered to the model without describing them all.
//
// Injecting one tool per action grows the prompt with every installed panel
// and makes small models pick the wrong tool long before the context fills.
// Instead the model gets two fixed tools, the pattern of Anthropic's tool
// search tool and OpenAI's tool_search: `find_app_actions` returns a few
// matches for a keyword query, and `call_app_action` runs one by its exact
// `panelId:action` id after the user approves it. The offered tools and each
// search result have a fixed size no matter how many panels are installed.

import {
    isCallableAction,
    permissionKey,
    ToolArgumentError,
    type OllamaTool,
    type RegistryAction,
    type RegistryInput,
    type ToolTarget,
} from "./tools";

export const FIND_APP_ACTIONS = "find_app_actions";
export const CALL_APP_ACTION = "call_app_action";

/** matches one search returns */
export const MAX_FOUND_ACTIONS = 8;
/** actions one round indexes; past this the rest are reported as unsearched */
export const MAX_INDEXED_ACTIONS = 20_000;
export const MAX_ACTION_QUERY_CHARS = 200;
export const MAX_ACTION_ID_CHARS = 300;
const MAX_QUERY_TERMS = 12;
const MAX_DESCRIPTION_CHARS = 200;
const MAX_INPUT_DESCRIPTION_CHARS = 80;
const MAX_LISTED_INPUTS = 12;
const MAX_LISTED_OPTIONS = 8;
/** one listed action, all of its lines */
export const MAX_FOUND_ENTRY_CHARS = 850;
/** a whole search result: header plus every entry, under the tool-result cap */
export const MAX_FIND_RESULT_CHARS = 400 + MAX_FOUND_ACTIONS * (MAX_FOUND_ENTRY_CHARS + 1);

export const APP_ACTION_TOOLS: readonly OllamaTool[] = [
    {
        type: "function",
        function: {
            name: FIND_APP_ACTIONS,
            description:
                "Search the user's other apps for actions you can run (for example: start a game server, post a message). Returns up to 8 matches, each with its exact id and arguments. Search before calling call_app_action.",
            parameters: {
                type: "object",
                properties: { query: { type: "string", description: "Keywords for the app or what the action does" } },
                required: ["query"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: CALL_APP_ACTION,
            description:
                "Run one app action found with find_app_actions. The user approves it before it runs.",
            parameters: {
                type: "object",
                properties: {
                    id: { type: "string", description: 'The exact id find_app_actions returned, "panelId:action"' },
                    arguments: { type: "object", description: "The action's arguments, as find_app_actions listed them" },
                },
                required: ["id"],
            },
        },
    },
];

export interface IndexedAction extends ToolTarget {
    /** `panelId:action`, the id the model calls it by */
    id: string;
    /** the panel's display name */
    app: string;
    description: string;
    /** words of the id, app and label: a hit here outranks the description */
    titleWords: string[];
    /** words of the description and input names */
    bodyWords: string[];
}

export interface ActionIndex {
    entries: IndexedAction[];
    byId: Map<string, IndexedAction>;
    /** callable actions left out past MAX_INDEXED_ACTIONS */
    omitted: number;
}

function clip(text: string, max: number): string {
    const flat = text.replace(/\s+/g, " ").trim();
    return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** Every callable action of every other panel, by its exact id. */
export function buildActionIndex(
    registry: readonly RegistryAction[],
    ownPanelId: string,
    panelNames: Record<string, string> = {},
): ActionIndex {
    const callable = registry
        .filter((e) => isCallableAction(e, ownPanelId))
        .sort((a, b) => permissionKey(a.panelId, a.action).localeCompare(permissionKey(b.panelId, b.action)));
    const kept = callable.slice(0, MAX_INDEXED_ACTIONS);
    const byId = new Map<string, IndexedAction>();
    for (const entry of kept) {
        const schema = entry.schema!;
        const id = permissionKey(entry.panelId, entry.action);
        if (byId.has(id)) continue; // one registration per id
        const inputs = schema.inputs ?? {};
        const label = schema.name || entry.action;
        const app = panelNames[entry.panelId] ?? entry.panelId;
        const description = schema.description ?? "";
        const inputText = Object.entries(inputs)
            .map(([key, i]) => `${key} ${i.label ?? ""}`)
            .join(" ");
        byId.set(id, {
            id,
            panelId: entry.panelId,
            action: entry.action,
            label,
            inputs,
            app,
            description,
            titleWords: words(`${id} ${app} ${label}`),
            bodyWords: words(`${description} ${inputText}`.slice(0, 2000)),
        });
    }
    return { entries: [...byId.values()], byId, omitted: callable.length - kept.length };
}

/** distinct lowercase words; "start-server" is "start" and "server" */
function words(text: string): string[] {
    return [...new Set(text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean))];
}

/** a query word matches a word it starts: "kick" finds "kicks", "the" does not find "other" */
function hits(list: readonly string[], term: string): boolean {
    return list.some((w) => w.startsWith(term));
}

/**
 * The best matches for a keyword query, ranked: a word in the id, app name
 * or label counts three times a word in the description. An exact id ranks
 * first. A query with no words lists actions in id order.
 */
export function searchActions(
    index: ActionIndex,
    query: string,
    limit = MAX_FOUND_ACTIONS,
): { matches: IndexedAction[]; total: number } {
    const terms = words(query).slice(0, MAX_QUERY_TERMS);
    const exact = query.trim();
    if (terms.length === 0) return { matches: index.entries.slice(0, limit), total: index.entries.length };
    const scored: { entry: IndexedAction; score: number }[] = [];
    for (const entry of index.entries) {
        let score = entry.id === exact ? 1000 : 0;
        for (const term of terms) {
            if (hits(entry.titleWords, term)) score += 3;
            else if (hits(entry.bodyWords, term)) score += 1;
        }
        if (score > 0) scored.push({ entry, score });
    }
    scored.sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id));
    return { matches: scored.slice(0, limit).map((s) => s.entry), total: scored.length };
}

function describeInput(key: string, input: RegistryInput): string {
    const facts = [input.type || "string"];
    if (input.required === true) facts.push("required");
    const values = (input.options ?? []).map((o) => o.value).filter((v) => ["string", "number", "boolean"].includes(typeof v));
    if (values.length > 0) {
        const shown = values.slice(0, MAX_LISTED_OPTIONS).map((v) => JSON.stringify(v)).join(", ");
        facts.push(`one of ${shown}${values.length > MAX_LISTED_OPTIONS ? ", ..." : ""}`);
    }
    const about = [input.label, input.description].filter((p): p is string => Boolean(p?.trim())).join(". ");
    return `${clip(key, 60)} (${facts.join(", ")})${about ? `: ${clip(about, MAX_INPUT_DESCRIPTION_CHARS)}` : ""}`;
}

function describeEntry(entry: IndexedAction): string {
    // required inputs first: they are the ones a call cannot do without
    const inputs = Object.entries(entry.inputs).sort(([, a], [, b]) => Number(b.required === true) - Number(a.required === true));
    const listed = inputs.slice(0, MAX_LISTED_INPUTS).map(([key, input]) => describeInput(key, input));
    if (inputs.length > MAX_LISTED_INPUTS) listed.push(`and ${inputs.length - MAX_LISTED_INPUTS} more`);
    const lines = [
        `- id: ${entry.id}`,
        `  ${clip(`${entry.app}: ${entry.label}.${entry.description ? ` ${clip(entry.description, MAX_DESCRIPTION_CHARS)}` : ""}`, 400)}`,
        `  arguments: ${listed.length > 0 ? listed.join("; ") : "none"}`,
    ];
    const text = lines.join("\n");
    return text.length > MAX_FOUND_ENTRY_CHARS ? `${text.slice(0, MAX_FOUND_ENTRY_CHARS - 1)}…` : text;
}

/** What the model reads back from a search. Bounded by MAX_FIND_RESULT_CHARS. */
export function formatFoundActions(index: ActionIndex, query: string): string {
    const { matches, total } = searchActions(index, query);
    const head: string[] = [];
    if (index.entries.length === 0) head.push("No other app offers actions right now.");
    else if (matches.length === 0) head.push(`No app action matches "${clip(query, 80)}". Try other keywords.`);
    else {
        head.push(
            `${total} app action${total === 1 ? "" : "s"} match "${clip(query, 80)}"${total > matches.length ? `; the best ${matches.length} are listed, use more specific keywords to see others` : ""}. Call one with call_app_action and its exact id.`,
        );
    }
    if (index.omitted > 0) head.push(`${index.omitted} actions were not searched (too many installed).`);
    return [...head, ...matches.map(describeEntry)].join("\n");
}

function asObject(raw: unknown, what: string): Record<string, unknown> {
    let value = raw;
    if (typeof value === "string") {
        try {
            value = value.trim() ? JSON.parse(value) : {};
        } catch {
            throw new ToolArgumentError(`${what} must be a JSON object`);
        }
    }
    if (value === undefined || value === null) return {};
    if (typeof value !== "object" || Array.isArray(value)) throw new ToolArgumentError(`${what} must be a JSON object`);
    return value as Record<string, unknown>;
}

/**
 * The action a call_app_action call names and the arguments it passes. The
 * id must be an indexed `panelId:action` exactly: it is never guessed from
 * a partial name. Arguments sent beside `id` instead of inside `arguments`
 * are read too; the action's declared inputs decide what is kept.
 */
export function resolveActionCall(index: ActionIndex, raw: unknown): { target: IndexedAction; rawArguments: unknown } {
    const args = asObject(raw, "arguments");
    const id = args.id;
    if (typeof id !== "string" || !id.trim()) throw new ToolArgumentError('missing required argument "id"');
    if (id.length > MAX_ACTION_ID_CHARS) throw new ToolArgumentError(`"id" is limited to ${MAX_ACTION_ID_CHARS} characters`);
    const target = index.byId.get(id.trim());
    if (!target) throw new ToolArgumentError(`there is no app action with the id "${clip(id, 120)}"; look it up with ${FIND_APP_ACTIONS} first`);
    if (args.arguments !== undefined) return { target, rawArguments: asObject(args.arguments, '"arguments"') };
    const { id: _id, ...rest } = args;
    return { target, rawArguments: rest };
}

/** How a recorded call_app_action is replayed to the model: as it was asked. */
export function replayedArguments(call: { tool: string; panelId: string; action: string; arguments: Record<string, unknown> }): Record<string, unknown> {
    if (call.tool !== CALL_APP_ACTION || !call.panelId) return call.arguments;
    return { id: permissionKey(call.panelId, call.action), arguments: call.arguments };
}
