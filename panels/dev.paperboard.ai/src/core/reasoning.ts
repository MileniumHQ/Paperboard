// The reasoning selector shown when a model can think. Ollama accepts a
// boolean (`think`) or a level; the level is what the dropdown speaks.

export type ReasoningLevel = "off" | "low" | "medium" | "high";

export const REASONING_LEVELS: readonly ReasoningLevel[] = [
    "off",
    "low",
    "medium",
    "high",
];

export const REASONING_LABELS: Record<ReasoningLevel, string> = {
    off: "Off",
    low: "Low",
    medium: "Medium",
    high: "High",
};

export function isReasoningLevel(value: unknown): value is ReasoningLevel {
    return typeof value === "string" && (REASONING_LEVELS as readonly string[]).includes(value);
}

/** Wire value: false disables thinking, a level asks for that much. */
export function reasoningToThink(level: ReasoningLevel): false | ReasoningLevel {
    return level === "off" ? false : level;
}

// ─── coding agents ───────────────────────────────────────────────────────────
// Claude Code and Codex name their own effort levels per model ("low" to
// "max", Codex also "ultra"); the panel shows and sends them as the agent
// lists them, never mapped onto Local AI's levels.

export const MAX_EFFORTS = 8;
const EFFORT_ID = /^[a-z]{1,16}$/;

export function isEffortId(value: unknown): value is string {
    return typeof value === "string" && EFFORT_ID.test(value);
}

/** An agent's listed effort levels, checked and bounded; none when it lists no valid one. */
export function effortsFrom(raw: unknown): string[] | undefined {
    if (!Array.isArray(raw)) return undefined;
    const levels = [...new Set(raw.filter(isEffortId))].slice(0, MAX_EFFORTS);
    return levels.length ? levels : undefined;
}

const EFFORT_LABELS: Record<string, string> = { xhigh: "Extra high" };

export function effortLabel(id: string): string {
    return EFFORT_LABELS[id] ?? id.charAt(0).toUpperCase() + id.slice(1);
}

/** The level a chat runs at: its pick when the model still offers it, else the model's default. */
export function chatEffort(model: { efforts?: string[]; defaultEffort?: string } | undefined, picked: string | undefined): string | undefined {
    if (!model?.efforts) return undefined;
    if (picked && model.efforts.includes(picked)) return picked;
    return model.defaultEffort && model.efforts.includes(model.defaultEffort) ? model.defaultEffort : undefined;
}

/** An agent model's effort fields, only when it lists levels (a default it doesn't list is dropped). */
export function withEfforts(efforts: string[] | undefined, defaultEffort?: unknown): { efforts?: string[]; defaultEffort?: string } {
    if (!efforts) return {};
    return { efforts, ...(isEffortId(defaultEffort) && efforts.includes(defaultEffort) ? { defaultEffort } : {}) };
}
