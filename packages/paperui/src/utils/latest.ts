import { getOwner, onCleanup } from "solid-js";

/** Starts a read; see createLatest. */
export interface Latest {
    /** Starts a read and hands back `current()`, true while no newer read has started, none was cancelled, and the view is still there. */
    (): () => boolean;
    /** Drops the read in flight without starting a new one: its answer, whenever it comes, is not shown. */
    cancel(): void;
}

/**
 * Late answers lose. Each call of the returned function starts a read and
 * hands back `current()`, true while no newer read has started and the
 * component that made it is still there. Check it after every await, before
 * the answer (or its failure) lands on screen: an older answer, or one that
 * arrives after the view went, is dropped. `cancel()` drops the read in
 * flight when nothing replaces it (the person closed the dialog, or went
 * back a step).
 *
 * Made outside a component, only a newer read or cancel() replaces one.
 */
export function createLatest(): Latest {
    let newest = 0;
    let gone = false;
    if (getOwner()) onCleanup(() => (gone = true));
    const latest = () => {
        const mine = ++newest;
        return () => !gone && mine === newest;
    };
    return Object.assign(latest, {
        cancel: () => {
            newest++;
        },
    });
}
