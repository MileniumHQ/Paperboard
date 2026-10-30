// The project list as every window sees it: the service's state, kept live
// through the panel bridge, and the changes a person makes to it. Every
// change goes through the service, which writes the list and announces it.
import { createSignal, onCleanup } from "solid-js";
import { actions as actionsApi, createPanelBridge } from "@mileniumhq/paperapi";
import { ACTIONS_PANEL_ID } from "../panelId";
import type { ActionsServiceState, ProjectSummary } from "../service";

const DEFAULT_STATE: ActionsServiceState = { rev: 0, projects: [], projectsError: null, runs: [], running: [] };

export type ProjectsState = ReturnType<typeof createProjects>;

export function createProjects() {
    const bridge = createPanelBridge<ActionsServiceState>({ panelId: ACTIONS_PANEL_ID, defaultState: DEFAULT_STATE });
    const [state, setState] = createSignal<ActionsServiceState>(bridge.getState());
    const [ready, setReady] = createSignal(false);
    const [loadError, setLoadError] = createSignal<string | null>(null);
    const off = bridge.onStateChange((_patch, full) => setState({ ...full }));
    onCleanup(() => {
        off();
        bridge.dispose();
    });

    const load = async () => {
        setLoadError(null);
        try {
            setState({ ...(await bridge.refreshState()) });
            setReady(true);
        } catch (err) {
            setLoadError(err instanceof Error ? err.message : String(err));
        }
    };
    void load();

    const call = <T>(action: string, inputs: Record<string, unknown>) => actionsApi.call<T>(ACTIONS_PANEL_ID, action, inputs);

    return {
        state,
        ready,
        loadError,
        load,
        list: () => state().projects,
        find: (id: string): ProjectSummary | undefined => state().projects.find((p) => p.id === id),
        create: (name?: string) => call<ProjectSummary>("create-project", name ? { name } : {}),
        rename: (project: string, name: string) => call<ProjectSummary>("update-project", { project, name }),
        setEnabled: (project: string, enabled: boolean) => call<ProjectSummary>("update-project", { project, enabled }),
        duplicate: (project: string) => call<ProjectSummary>("duplicate-project", { project }),
        remove: (project: string) => call<{ deleted: string }>("delete-project", { project }),
    };
}

/** "Edited 5 minutes ago", as the home screen says it. */
export function editedText(at: number, now = Date.now()): string {
    if (!at) return "Never edited";
    const minutes = Math.round((now - at) / 60_000);
    if (minutes < 1) return "Edited just now";
    if (minutes < 60) return `Edited ${minutes} minute${minutes === 1 ? "" : "s"} ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `Edited ${hours} hour${hours === 1 ? "" : "s"} ago`;
    const date = new Date(at);
    const sameYear = date.getFullYear() === new Date(now).getFullYear();
    return `Edited ${date.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) })}`;
}
