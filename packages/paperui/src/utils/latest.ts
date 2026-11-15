import { getOwner, onCleanup } from "solid-js";

/**
 * Late answers lose. Each call of the returned function starts a read and
 * hands back `current()`, true while no newer read has started and the
 * component that made it is still there. Check it after every await, before
 * the answer (or its failure) lands on screen: an older answer, or one that
 * arrives after the view went, is dropped.
 *
 * Made outside a component, only a newer read replaces one.
 */
export function createLatest(): () => () => boolean {
    let newest = 0;
    let gone = false;
    if (getOwner()) onCleanup(() => (gone = true));
    return () => {
        const mine = ++newest;
        return () => !gone && mine === newest;
    };
}
