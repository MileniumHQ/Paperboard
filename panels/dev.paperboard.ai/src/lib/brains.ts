// The agent's possible brains as the UI names them, shared by onboarding,
// the composer and settings.

import { AGENT_REGISTRY } from "../../legacy/src/core/agents";

export const CLAUDE_MODELS = [
    { id: "claude-opus-5-5", name: "Opus 5.5", description: "Most capable. Best for long, careful work." },
    { id: "claude-sonnet-5-5", name: "Sonnet 5.5", description: "Fast and capable. A good default." },
    { id: "claude-haiku-5-5", name: "Haiku 5.5", description: "Quickest, for light tasks." },
];

export const harnessName = (id: string) => AGENT_REGISTRY.find((a) => a.id === id)?.name ?? id;
export const harnessDescription = (id: string) => AGENT_REGISTRY.find((a) => a.id === id)?.description;

/** What the brain chip says: a known model's short name, a custom model as typed, or the harness. */
export function brainLabel(s: { harness: string; model: string | null }): string {
    if (!s.model) return harnessName(s.harness);
    return CLAUDE_MODELS.find((m) => m.id === s.model)?.name ?? s.model;
}
