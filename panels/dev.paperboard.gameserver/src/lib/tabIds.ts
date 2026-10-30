import { createMemo, type Accessor } from "solid-js";

// A game's describe() builds fresh tab objects on every call, and it reruns
// whenever the server's settings change. Rendering tabs from those objects
// remounts every tab each time; a tab that loads config on mount then loops.
// Tabs keyed by id stay mounted until the list of ids itself changes.
export function tabIds(tabs: Accessor<readonly { id: string }[]>): Accessor<string[]> {
    return createMemo(() => tabs().map((tab) => tab.id), undefined, {
        equals: (prev, next) => prev.length === next.length && prev.every((id, i) => id === next[i]),
    });
}
