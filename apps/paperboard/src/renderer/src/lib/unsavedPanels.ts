import { createSignal } from "solid-js";

// Panel pages that hold unsaved work (setUnsavedChanges in PaperAPI), by
// panel key. Each one's frame registers how to ask its page whether it may
// go; the page asks the person.

export interface LeaveAnswer {
    leave: boolean;
    /** why the page couldn't ask */
    error?: string;
}

const askers = new Map<string, () => Promise<LeaveAnswer>>();
const [unsaved, setUnsaved] = createSignal<ReadonlySet<string>>(new Set(), {
    equals: (a, b) => a.size === b.size && [...a].every((key) => b.has(key)),
});

/** the keys of the panels whose page holds unsaved work */
export const unsavedPanels = unsaved;

/** a frame's page said it holds unsaved work (`ask` asks it) or no longer does (null) */
export function setPanelUnsaved(key: string, ask: (() => Promise<LeaveAnswer>) | null): void {
    if (ask) askers.set(key, ask);
    else askers.delete(key);
    setUnsaved(new Set(askers.keys()));
}

/** asks the page of `key` whether it may go; a page with nothing unsaved may */
export function askPanelToLeave(key: string): Promise<LeaveAnswer> {
    return askers.get(key)?.() ?? Promise.resolve({ leave: true });
}
