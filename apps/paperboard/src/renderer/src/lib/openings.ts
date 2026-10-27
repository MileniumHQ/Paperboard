import { createMemo } from "solid-js";

// A window that stays mounted and opens once per request. Work it starts
// (a load, a save) belongs to the opening that started it: when that opening
// is over, the work's late result is dropped instead of landing on the next
// request. Each opening is answered at most once.
export function createOpenings() {
    let current = 0;
    let answered = 0;
    return {
        /** starts an opening; the token ties later work to it */
        open(): number {
            return ++current;
        },
        isCurrent(token: number): boolean {
            return token === current;
        },
        /** true the first time the current opening is answered; stale or repeat answers are refused */
        answer(token: number): boolean {
            if (token !== current || answered === token) return false;
            answered = token;
            return true;
        },
    };
}

/**
 * What a stay-mounted modal shows: the source's value while it's open, and
 * its last value while the modal fades out after closing, so the content
 * doesn't vanish mid-fade. Each opening is a fresh object: content keyed on
 * it (`<Show when={shown()} keyed>`) starts over when the modal reopens.
 */
export function createShownWhileClosing<T>(source: () => T | null | undefined | false): () => { value: T } | null {
    let wasOpen = false;
    return createMemo<{ value: T } | null>((prev) => {
        const value = source();
        const open = value !== null && value !== undefined && value !== false;
        const reopened = open && !wasOpen;
        wasOpen = open;
        if (!open) return prev;
        return reopened || prev?.value !== value ? { value } : prev;
    }, null);
}
