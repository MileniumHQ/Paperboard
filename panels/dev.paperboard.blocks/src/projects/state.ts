// The project list as every window sees it: the service's state, kept live
// through the panel bridge, and the changes a person makes to it. Every
// change goes through the service, which writes the list and announces it.
import { createSignal, onCleanup } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { bridge } from "../bridge";
import { SERVICE_ACTIONS, type PanelState } from "../panel";
import type { ProjectSummary } from "../lib/projects";

export type ProjectsState = ReturnType<typeof createProjects>;

export function createProjects() {
    // reconciled by id, so a project keeps its object across announcements and
    // its card stays mounted: a remounted switch would skip its slide
    const [state, setState] = createStore<PanelState>(structuredClone(bridge.getState()));
    const apply = (full: PanelState) => setState(reconcile(structuredClone(full), { key: "id" }));
    const [ready, setReady] = createSignal(false);
    const [loadError, setLoadError] = createSignal<string | null>(null);
    const off = bridge.onStateChange((_patch, full) => apply(full));
    onCleanup(off);

    const load = async () => {
        setLoadError(null);
        try {
            apply(await bridge.refreshState());
            setReady(true);
        } catch (err) {
            setLoadError(err instanceof Error ? err.message : String(err));
        }
    };
    void load();

    return {
        state: () => state,
        /** the service answered and has read its projects */
        ready: () => ready() && state.loaded,
        loadError,
        load,
        /** the projects Home shows: a draft is only seen in its editor */
        kept: () => state.projects.filter((p) => !p.draft),
        find: (id: string): ProjectSummary | undefined => state.projects.find((p) => p.id === id),
        create: (name?: string) => bridge.call<ProjectSummary>(SERVICE_ACTIONS.createProject, name ? { name } : {}),
        rename: (project: string, name: string) => bridge.call<ProjectSummary>(SERVICE_ACTIONS.updateProject, { project, name }),
        setEnabled: (project: string, enabled: boolean) => bridge.call<ProjectSummary>(SERVICE_ACTIONS.updateProject, { project, enabled }),
        duplicate: (project: string) => bridge.call<ProjectSummary>(SERVICE_ACTIONS.duplicateProject, { project }),
        remove: (project: string) => bridge.call<{ deleted: boolean }>(SERVICE_ACTIONS.deleteProject, { project }),
        /** a new project left without a block is not kept; the service checks it still is a draft */
        discardDraft: (project: string) => bridge.call<{ deleted: boolean }>(SERVICE_ACTIONS.deleteProject, { project, onlyDraft: true }),
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
