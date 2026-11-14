// Where focus goes back to when a PaperUI menu closes: the element focused
// before it opened. A dialog opened from one of its items returns focus
// there too, since the menu it was chosen from is gone by the time the
// dialog closes. Internal to PaperUI.

const focusedBefore = new Map<string, WeakRef<HTMLElement>>();

/** Records what had focus as the menu with this root id opened. */
export function rememberFocusBeforeMenu(rootId: string, el: HTMLElement): void {
    focusedBefore.set(rootId, new WeakRef(el));
}

export function forgetFocusBeforeMenu(rootId: string): void {
    focusedBefore.delete(rootId);
}

/** The element focused before the menu that `node` is in opened, if it is in an open one. */
export function focusBeforeMenu(node: Element): HTMLElement | null {
    const rootId = node.closest("[data-context-root]")?.getAttribute("data-context-root");
    return rootId ? (focusedBefore.get(rootId)?.deref() ?? null) : null;
}
