// The agent's possible brains as the UI names them, shared by onboarding,
// the composer and settings. Models aren't named here: each harness lists
// its own (service/models.ts).

import { createResource, type Resource } from "solid-js";
import type { BrainModel, Harness } from "../contract";
import type { Agent } from "./agent";
import { AGENT_REGISTRY } from "../../legacy/src/core/agents";

export const harnessName = (id: string) => AGENT_REGISTRY.find((a) => a.id === id)?.name ?? id;
export const harnessDescription = (id: string) => AGENT_REGISTRY.find((a) => a.id === id)?.description;

/** The models a harness offers, fetched again whenever the harness changes. */
export function createModels(agent: Agent, harness: () => Harness | undefined): Resource<BrainModel[]> {
    const [models] = createResource(harness, (h) => agent.models(h));
    return models;
}

/** The list once it's in, else nothing (still loading, or it failed: models.error says why). */
export const loadedModels = (models: Resource<BrainModel[]>) => (models.error ? undefined : models.latest);

/** What the brain chip says: a listed model's name, an unlisted one as typed, or the harness. */
export function brainLabel(s: { harness: string; model: string | null }, models?: BrainModel[]): string {
    if (!s.model) return harnessName(s.harness);
    return models?.find((m) => m.id === s.model)?.name ?? s.model;
}
