// What the block library reads from the computer: the installed panels (for
// names and icons) and the actions they registered. A failed read is a
// failure the library shows with Retry, never an empty library.
import type { ActionInfo, PanelItem } from "@mileniumhq/paperapi";

export type LibraryLoad =
    | { kind: "ready"; panels: PanelItem[]; actions: ActionInfo[] }
    | { kind: "failed"; message: string };

export async function loadLibraryLists(read: {
    panels: () => Promise<PanelItem[]>;
    actions: () => Promise<ActionInfo[]>;
}): Promise<LibraryLoad> {
    try {
        const [panels, actions] = await Promise.all([read.panels(), read.actions()]);
        return { kind: "ready", panels, actions };
    } catch (err) {
        return { kind: "failed", message: err instanceof Error ? err.message : String(err) };
    }
}
