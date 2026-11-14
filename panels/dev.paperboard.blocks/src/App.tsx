// Blocks opens on its projects, like a documents app; opening one shows its
// editor. A project deleted or gone while it is open returns here.
//
// The workspace needs a computer's screen. On a phone the panel says so
// instead of drawing an editor that can't be used; the flows keep running
// in the service.
import { createEffect, createSignal, on, onCleanup, Show } from "solid-js";
import { PAPER_PANEL_COMPACT_WIDTH, PaperEmptyState, PaperFlex, PaperQuote } from "@mileniumhq/paperui";
import "@mileniumhq/paperui/style.css";
import "@mileniumhq/paperui/panel.css";
import Editor from "./Editor";
import ProjectsHome from "./projects/ProjectsHome";
import { createProjects } from "./projects/state";
import { closedUnsaved, NOT_SAVED, setClosedUnsaved } from "./editorFlows";
import type { ProjectSummary } from "./lib/projects";

export default function App() {
    const query = window.matchMedia(`(max-width: ${PAPER_PANEL_COMPACT_WIDTH - 1}px)`);
    const [narrow, setNarrow] = createSignal(query.matches);
    const change = () => setNarrow(query.matches);
    query.addEventListener("change", change);
    onCleanup(() => query.removeEventListener("change", change));
    return (
        <Show when={!narrow()} fallback={
            <PaperFlex direction="column" fullWidth fullHeight align="center" justify="center" gap="full" padding="double">
                {/* an editor closed as the window narrowed: an edit it sent that didn't save is said here */}
                <Show when={closedUnsaved()}>
                    {(text) => (
                        <PaperQuote variant="danger" icon="warning" title={NOT_SAVED} role="alert" onDismiss={() => setClosedUnsaved(null)}>{text()}</PaperQuote>
                    )}
                </Show>
                <PaperEmptyState
                    icon="phonelink_off"
                    title="Blocks isn't on phones yet"
                    description="Open Blocks on a computer to build and edit flows. Your flows keep running."
                />
            </PaperFlex>
        }>
            <Projects />
        </Show>
    );
}

function Projects() {
    const projects = createProjects();
    // the project as it was opened: one just made or copied is open before
    // the service's list, which arrives a moment later, shows it
    const [opened, setOpened] = createSignal<ProjectSummary | null>(null);
    // whether the open project has been in the list, so that leaving it
    // means it was deleted rather than not announced yet
    let listed = false;
    const open = (project: ProjectSummary) => {
        listed = false;
        setOpened(project);
    };

    // whether the open project is in the list: null while none is open
    const inList = () => {
        const project = opened();
        return project ? Boolean(projects.find(project.id)) : null;
    };
    createEffect(
        on([opened, inList], ([, present]) => {
            if (present) listed = true;
            else if (present === false && listed) setOpened(null);
        }),
    );

    return (
        <Show when={opened()?.id} keyed fallback={<ProjectsHome projects={projects} onOpen={open} />}>
            {(id) => <Editor projectId={id} project={() => projects.find(id) ?? opened()!} projects={projects} onHome={() => setOpened(null)} onOpen={open} />}
        </Show>
    );
}
