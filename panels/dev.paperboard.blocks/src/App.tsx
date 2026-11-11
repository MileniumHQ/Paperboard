// Blocks opens on its projects, like a documents app; opening one shows its
// editor. A project deleted or gone while it is open returns here.
import { createEffect, createSignal, Show } from "solid-js";
import "@mileniumhq/paperui/style.css";
import "@mileniumhq/paperui/panel.css";
import Editor from "./Editor";
import ProjectsHome from "./projects/ProjectsHome";
import { createProjects } from "./projects/state";
import type { ProjectSummary } from "./lib/projects";

export default function App() {
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

    createEffect(() => {
        const project = opened();
        if (!project) return;
        if (projects.find(project.id)) listed = true;
        else if (listed) setOpened(null);
    });

    return (
        <Show when={opened()?.id} keyed fallback={<ProjectsHome projects={projects} onOpen={open} />}>
            {(id) => <Editor projectId={id} project={() => projects.find(id) ?? opened()!} projects={projects} onHome={() => setOpened(null)} onOpen={open} />}
        </Show>
    );
}
