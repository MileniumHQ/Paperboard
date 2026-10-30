// The custom system prompt editor's state: what the textarea shows, re-synced
// from the stored prompt, and persisted after a debounce. DOM-free so the
// seed/sync contract is testable without a browser.

import { createEffect, createSignal, onCleanup } from "solid-js";

export const PROMPT_SAVE_DEBOUNCE_MS = 500;

export interface PromptEditor {
    /** the text the editor shows */
    value: () => string;
    /** a user edit; persisted after the debounce settles */
    update: (next: string) => void;
}

/**
 * `settings` is read live (it is a Solid store slice in the panel). The signal
 * is seeded from the stored prompt, not "": a mount must show what was saved.
 */
export function createPromptEditor(
    settings: () => { customSystemPrompt: string | null },
    save: (value: string) => Promise<boolean>,
    debounceMs = PROMPT_SAVE_DEBOUNCE_MS,
): PromptEditor {
    const [value, setValue] = createSignal(settings().customSystemPrompt ?? "");
    let saved = settings().customSystemPrompt ?? "";
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pending: string | undefined;

    createEffect(() => {
        const stored = settings().customSystemPrompt ?? "";
        if (stored !== saved) {
            saved = stored;
            setValue(stored);
        }
    });

    const persist = async (next: string): Promise<void> => {
        if (next === saved) return;
        const previous = saved;
        saved = next;
        const applied = await save(next);
        if (!applied && saved === next) {
            saved = previous;
            setValue(previous);
        }
    };

    const update = (next: string): void => {
        pending = next;
        clearTimeout(timer);
        timer = setTimeout(() => {
            pending = undefined;
            void persist(next);
        }, debounceMs);
    };

    onCleanup(() => {
        clearTimeout(timer);
        if (pending !== undefined) void persist(pending);
    });

    return { value, update };
}
