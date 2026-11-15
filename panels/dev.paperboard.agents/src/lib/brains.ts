// The agent's possible brains as the UI names them, shared by onboarding
// and settings. Models aren't named here: each harness lists
// its own (service/models.ts).

import { createRead, type Read } from "@mileniumhq/paperui/headless";
import type { BrainModel, Harness } from "../contract";
import type { Agent } from "./agent";

// "Claude", not "Claude Code": Anthropic's terms ask that products built on it don't carry its product's name
const BRAINS: Record<Harness, { name: string; description: string }> = {
    codex: { name: "Codex", description: "OpenAI's coding agent" },
    "claude-code": { name: "Claude", description: "Anthropic's coding agent" },
    opencode: { name: "OpenCode", description: "The open source coding agent, with any provider" },
};

export const harnessName = (id: string) => BRAINS[id as Harness]?.name ?? id;
export const harnessDescription = (id: string) => BRAINS[id as Harness]?.description;

/** The models a harness offers, fetched again whenever the harness changes, or its brain is installed, signed in or removed (what it lists, or can't, depends on that). */
export function createModels(agent: Agent, harness: () => Harness | undefined): Read<BrainModel[]> {
    return createRead((key: string) => agent.models(key.split("|")[0] as Harness), {
        source: () => {
            const h = harness();
            const b = h && agent.state.brains[h];
            // one string: the list is read again only when one of these changes
            return h && b ? `${h}|${b.phase}|${b.signedIn}` : undefined;
        },
    });
}

/** Past this many models a picker gets a search field (OpenCode can list hundreds). */
export const SEARCH_MODELS_FROM = 10;

/** The list once it's in, else nothing (not read yet, or it failed: models.error() says why). */
export const loadedModels = (models: Read<BrainModel[]>) => (models.error() ? undefined : models.value());
