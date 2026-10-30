// What the block library reads from the computer: the installed panels (for
// names and icons), the actions they registered, and the projects some of
// them keep their actions in. A failed read is a
// failure the library shows with Retry, never an empty library.
import type { ActionInfo, PanelItem, ProjectInfo } from "@mileniumhq/paperapi";

export type LibraryLoad =
    | { kind: "ready"; panels: PanelItem[]; actions: ActionInfo[]; projects: ProjectInfo[] }
    | { kind: "failed"; message: string };

export async function loadLibraryLists(read: {
    panels: () => Promise<PanelItem[]>;
    actions: () => Promise<ActionInfo[]>;
    projects: () => Promise<ProjectInfo[]>;
}): Promise<LibraryLoad> {
    try {
        const [panels, actions, projects] = await Promise.all([read.panels(), read.actions(), read.projects()]);
        return { kind: "ready", panels, actions, projects };
    } catch (err) {
        return { kind: "failed", message: err instanceof Error ? err.message : String(err) };
    }
}
