// The project list as every window sees it: the service's state, kept live
// through the panel bridge, and the changes a person makes to it. Every
// change goes through the service, which writes the list and announces it.
import { createRead } from "@mileniumhq/paperui";
import { service, serviceState } from "../bridge";
import type { ProjectSummary, SavedFlows } from "../panel";

export type ProjectsState = ReturnType<typeof createProjects>;

export function createProjects() {
    // what the service holds before it first answers
    const initial = structuredClone(serviceState.current());
    // reconciled by id, so a project keeps its object across announcements and
    // its card stays mounted: a remounted switch would skip its slide. An
    // announcement is only what it carries (a log line is a patch of the log
    // alone), and joins a read still out, being newer than it
    const read = createRead(() => serviceState.refresh().then((full) => structuredClone(full)), {
        follow: (land) => serviceState.subscribe((_state, patch) => land((prev) => prev && { ...prev, ...structuredClone(patch) })),
    });
    const state = () => read.value() ?? initial;

    return {
        state,
        /** the service answered and has read its projects */
        ready: () => Boolean(read.value()?.loaded),
        /** why the last read of the list failed, until one goes through */
        loadError: read.error,
        /** a read of the list is out: Try again waits on it */
        loading: read.loading,
        load: read.reload,
        /** the projects Home shows: a draft is only seen in its editor */
        kept: () => state().projects.filter((p) => !p.draft),
        find: (id: string): ProjectSummary | undefined => state().projects.find((p) => p.id === id),
        /** `flows`: what it starts with, as a template gives it */
        create: (name?: string, flows?: SavedFlows) => service.createProject({ name, flows }),
        rename: (project: string, name: string) => service.updateProject({ project, name }),
        /** resolves once the list shows the switch where the service put it: a switch moves when its save is answered */
        setEnabled: async (project: string, enabled: boolean) => {
            const saved = await service.updateProject({ project, enabled });
            read.set((prev) => prev && { ...prev, projects: prev.projects.map((p) => (p.id === saved.id ? structuredClone(saved) : p)) });
            return saved;
        },
        duplicate: (project: string) => service.duplicateProject({ project }),
        remove: (project: string) => service.deleteProject({ project }),
        /** asks the service to read its projects again, after they couldn't be read */
        readAgain: () => service.readProjects(),
        /** a new project left without a block is not kept; the service checks it still is a draft */
        discardDraft: (project: string) => service.deleteProject({ project, onlyDraft: true }),
    };
}

/** A project's switch, shown beside it: on, its flows start on their events. */
export const AUTO_START = "Auto-start";

/** What a project's switch that didn't move says, by where it was going. */
export const switchFailed = (enabled: boolean) => (enabled ? "Couldn't turn the flows on" : "Couldn't turn the flows off");

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
