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
