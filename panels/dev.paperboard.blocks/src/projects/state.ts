// The project list as every window sees it: the service's state, kept live
// through the panel bridge, and the changes a person makes to it. Every
// change goes through the service, which writes the list and announces it.
import { batch, createSignal, onCleanup } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { bridge } from "../bridge";
import { SERVICE_CALLS, type PanelState } from "../panel";
import type { ProjectSummary } from "../lib/projects";
import { errorMessage } from "@mileniumhq/paperapi";

export type ProjectsState = ReturnType<typeof createProjects>;

export function createProjects() {
    // reconciled by id, so a project keeps its object across announcements and
    // its card stays mounted: a remounted switch would skip its slide
    const [state, setState] = createStore<PanelState>(structuredClone(bridge.getState()));
    // only what the announcement carries: a log line is a patch of the log alone, so
    // the projects aren't cloned and compared again with it
    const apply = (patch: Partial<PanelState>) =>
        batch(() => {
            for (const [key, value] of Object.entries(patch) as [keyof PanelState, PanelState[keyof PanelState]][]) {
                setState(key, reconcile(structuredClone(value), { key: "id" }));
            }
        });
    const [ready, setReady] = createSignal(false);
    const [loadError, setLoadError] = createSignal<string | null>(null);
    const off = bridge.onStateChange((patch) => apply(patch));
    onCleanup(off);

    const load = async () => {
        setLoadError(null);
        try {
            apply(await bridge.refreshState());
            setReady(true);
        } catch (err) {
            setLoadError(errorMessage(err));
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
        create: (name?: string) => bridge.call<ProjectSummary>(SERVICE_CALLS.createProject, name ? { name } : {}),
        rename: (project: string, name: string) => bridge.call<ProjectSummary>(SERVICE_CALLS.updateProject, { project, name }),
        /** resolves once the list shows the switch where the service put it: a switch moves when its save is answered */
        setEnabled: async (project: string, enabled: boolean) => {
            const saved = await bridge.call<ProjectSummary>(SERVICE_CALLS.updateProject, { project, enabled });
            const at = state.projects.findIndex((p) => p.id === saved.id);
            if (at >= 0) setState("projects", at, reconcile(structuredClone(saved)));
            return saved;
        },
        duplicate: (project: string) => bridge.call<ProjectSummary>(SERVICE_CALLS.duplicateProject, { project }),
        remove: (project: string) => bridge.call<{ deleted: boolean }>(SERVICE_CALLS.deleteProject, { project }),
        /** a new project left without a block is not kept; the service checks it still is a draft */
        discardDraft: (project: string) => bridge.call<{ deleted: boolean }>(SERVICE_CALLS.deleteProject, { project, onlyDraft: true }),
    };
}

/** What a project's switch that didn't move says, by where it was going. */
export const switchFailed = (enabled: boolean) => (enabled ? "Flows not turned on" : "Flows not turned off");

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
