// The chat sidebar's selection state machine, with the summary-lag hold from
// core/selection.ts wired in. Kept out of the component so the exact ordering
// (create answers → summary in flight → summary arrives) is testable without
// a browser.

import { createEffect, createSignal } from "solid-js";
import { nextSelection } from "../core/selection";

export interface ChatSelection {
    /** the chat highlighted in the sidebar (null = nothing) */
    selected: () => string | null;
    /** the just-created chat whose summary has not reached the mirror */
    pending: () => string | null;
    /** the empty "New chat" draft is selected instead of a chat */
    draft: () => boolean;
    /** user opened an empty draft */
    newChat: () => void;
    /** user clicked a mirrored chat */
    select: (id: string) => void;
    /** a new chat was created; its summary may still be in flight */
    created: (id: string) => void;
}

export function createChatSelection(
    listIds: () => readonly string[],
): ChatSelection {
    const [selected, setSelected] = createSignal<string | null>(null);
    const [pending, setPending] = createSignal<string | null>(null);
    const [draft, setDraft] = createSignal(false);

    createEffect(() => {
        if (draft()) return;
        const next = nextSelection(
            { selected: selected(), pending: pending() },
            listIds(),
        );
        if (!next) return;
        setSelected(next.selected);
        if (pending() !== next.pending) setPending(next.pending);
    });

    return {
        selected,
        pending,
        draft,
        newChat: () => {
            setDraft(true);
            setPending(null);
            setSelected(null);
        },
        select: (id: string) => {
            setDraft(false);
            setPending(null);
            setSelected(id);
        },
        created: (id: string) => {
            setPending(id);
            setSelected(id);
            setDraft(false);
        },
    };
}
