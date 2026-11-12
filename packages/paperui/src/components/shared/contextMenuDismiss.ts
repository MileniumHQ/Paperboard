import { createSignal } from "solid-js";

// An item held until its context menu opened, then carried away, is being
// moved, not chosen from: the menu it opened goes. Internal to PaperUI.

const [dismissals, setDismissals] = createSignal(0);

/** bumps when every open context menu should close */
export const contextMenuDismissals = dismissals;

/** closes every open context menu */
export function dismissContextMenus(): void {
    setDismissals((n) => n + 1);
}
