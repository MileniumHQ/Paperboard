// What the Home widgets show, decided from the mirrored service state.
// Pure so every branch is testable without a browser.

import { MAX_WIDGET_CHOICES, type WidgetChoice } from "@mileniumhq/paperapi";
import { formatBytes } from "./fit";
import { OLLAMA_PROVIDER_ID } from "./providers";
import type { AiState, LoadedModel, RuntimeStatus } from "./types";

/** The recovery a blocked widget offers. */
export type WidgetRecovery = "open" | "start" | null;

export interface Blocker {
    /** a few words: fits a widget title */
    text: string;
    /** the reason in full, when there is more to say */
    detail?: string;
    /** a failure, not a wait or a missing setup step */
    failed?: boolean;
    recovery: WidgetRecovery;
}

/** Why the runtime cannot serve right now, with the way back. */
export function runtimeBlocker(status: RuntimeStatus, error?: string): Blocker | null {
    switch (status) {
        case "ready":
            return null;
        case "starting":
            return { text: "Ollama is starting…", recovery: null };
        case "checking":
            return { text: "Checking Ollama…", recovery: null };
        case "installing":
            return { text: "Ollama is installing…", recovery: null };
        case "missing":
            return { text: "Ollama is not installed", recovery: "open" };
        case "stopped":
            return { text: "Ollama is not running", recovery: "start" };
        case "error":
            return { text: "Ollama stopped", ...(error ? { detail: error } : {}), failed: true, recovery: "start" };
    }
}

/** The Quick ask "Model" choice that follows AI's default model. */
export const QUICK_ASK_DEFAULT_MODEL = "@default";

/**
 * The model a Quick ask uses: the one its "Model" option names, or for the
 * default (and widgets placed before the option) the one a new chat in the
 * panel would.
 */
export function quickAskModel(state: Pick<AiState, "settings" | "models">, chosen?: string): string {
    if (chosen && chosen !== QUICK_ASK_DEFAULT_MODEL) return chosen;
    return state.settings.defaultModel || state.models[0]?.name || "";
}

/** What the "Model" option offers in Home's gallery: the default, then each downloaded model. */
export function quickAskModelChoices(state: Pick<AiState, "models">): WidgetChoice[] {
    return [
        { value: QUICK_ASK_DEFAULT_MODEL, label: "Default model" },
        ...state.models.slice(0, MAX_WIDGET_CHOICES - 1).map((m) => ({ value: m.name, label: m.name })),
    ];
}

/** Why Quick ask cannot send now, or null when it can. */
export function quickAskBlocker(state: Pick<AiState, "connections" | "runtime" | "settings" | "models">, chosen?: string): Blocker | null {
    if (state.connections.length === 0) return { text: "Set up AI to ask from here", recovery: "open" };
    const model = quickAskModel(state, chosen);
    const listed = model ? state.models.find((m) => m.name === model) : undefined;
    // an endpoint's model needs no local runtime; anything else waits on Ollama
    if (listed && listed.provider !== OLLAMA_PROVIDER_ID) return null;
    if (state.connections.some((c) => c.kind === "ollama")) {
        const runtime = runtimeBlocker(state.runtime.status, state.runtime.error);
        if (runtime) return runtime;
    }
    if (!model) return { text: "Download a model in AI first", recovery: "open" };
    if (!listed) return { text: `${model} is not downloaded`, recovery: "open" };
    return null;
}

/** The loaded model to feature (the largest), and how many others share memory. */
export function featuredLoaded(models: readonly LoadedModel[]): { model: LoadedModel; others: number } | null {
    if (models.length === 0) return null;
    const model = models.reduce((a, b) => (b.sizeBytes > a.sizeBytes ? b : a));
    return { model, others: models.length - 1 };
}

/** "5.2 GB on GPU", "5.2 GB, 40% GPU", "5.2 GB on CPU": short enough for a 2x1 widget. */
export function loadedDetail(model: LoadedModel): string {
    const size = formatBytes(model.sizeBytes);
    if (model.sizeBytes <= 0) return size;
    const share = Math.round((model.vramBytes / model.sizeBytes) * 100);
    if (share >= 100) return `${size} on GPU`;
    if (share <= 0) return `${size} on CPU`;
    return `${size}, ${share}% GPU`;
}

