// Chat-list selection rule. The service emits a new conversation's summary
// just before the creating call answers, but the summary event and the call
// response travel on different wires, so the UI mirror can lag the call by a
// beat. A freshly created chat must never be swapped for the newest known
// chat during that gap: the highlight would point at another conversation
// while the reply streams into the new one, and re-clicking the highlighted
// item is a no-op (its selection never changed). Pure so the race is testable.

export interface SelectionState {
    /** the chat highlighted in the sidebar (null = nothing selected) */
    selected: string | null;
    /** a chat just created whose summary has not reached the mirror yet */
    pending: string | null;
}

/**
 * The selection to apply, or `null` to leave the current state untouched.
 * `listIds` is the mirrored summary order, newest first.
 */
export function nextSelection(
    state: SelectionState,
    listIds: readonly string[],
): SelectionState | null {
    const { selected, pending } = state;

    if (selected && listIds.includes(selected)) {
        // the summary caught up; the hold is done
        return pending === selected ? { selected, pending: null } : null;
    }

    // not mirrored yet, but it is the chat this UI just created: hold, the
    // summary is in flight and will arrive without any further action
    if (selected && pending === selected) return null;

    const fallback = listIds[0] ?? null;
    if (fallback === selected && pending === null) return null;
    return { selected: fallback, pending: null };
}
