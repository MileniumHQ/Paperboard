// The first thing Blocks shows: every project as a card with its canvas in
// miniature, newest edit first, and a way to start a new one.
import { createSignal, For, onCleanup, Show } from "solid-js";
import {
    PaperBadge,
    PaperButton,
    PaperContextMenu,
    PaperContextMenuItem,
    PaperEffect,
    PaperEmptyState,
    PaperFlex,
    PaperIcon,
    PaperLoader,
    PaperMediaCard,
    PaperMediaCardGroup,
    PaperPage,
    PaperPageHeader,
    PaperSeparator,
    PaperText,
    PaperToggle,
    createAction,
    createFailureToast,
    useContextMenuState,
} from "@mileniumhq/paperui";
import CanvasPreview from "./CanvasPreview";
import { DeleteProjectModal, RenameProjectModal } from "./ProjectDialogs";
import { AUTO_START, editedText, switchFailed, type ProjectsState } from "./state";
import type { ProjectSummary } from "../panel";


export default function ProjectsHome(props: { projects: ProjectsState; onOpen: (project: ProjectSummary) => void }) {
    // what fails is a toast, which closes once the same thing goes through; one change at a time
    const changes = createAction();
    const working = changes.busy;
    const change = async (failed: string, work: () => Promise<void>) => {
        if (!working()) await changes.run(failed, work);
    };

    const create = () => change("Couldn't make a project", async () => props.onOpen(await props.projects.create()));
    const duplicate = (id: string) => change("Couldn't copy the project", async () => { await props.projects.duplicate(id); });
    // a switch flips on its own, never waiting on another change, and moves once the service says so
    const switching = createAction();
    const setEnabled = (id: string, enabled: boolean) => switching.run(switchFailed(enabled), () => props.projects.setEnabled(id, enabled));
    // what the service can't do stands until it says it is over
    // the service reads its projects as it starts; after that failed, only when asked again.
    // The toast goes while it reads again and comes back with why, if that failed too
    const reading = createAction({ toast: false });
    createFailureToast(() => (reading.busy() ? null : (reading.error()?.message ?? props.projects.state().projectsError)), { title: "Couldn't read the projects" });
    createFailureToast(() => props.projects.state().blocksError, { title: "Flows can't drive projects" });

    const menu = useContextMenuState("below-right");
    const [menuFor, setMenuFor] = createSignal<ProjectSummary | null>(null);
    const [renaming, setRenaming] = createSignal<ProjectSummary | null>(null);
    const [deleting, setDeleting] = createSignal<ProjectSummary | null>(null);
    const fromMenu = (act: (project: ProjectSummary) => void) => () => {
        const project = menuFor();
        menu.close();
        if (project) act(project);
    };

    // the time each card says it was edited is read again each minute
    const [now, setNow] = createSignal(Date.now());
    const clock = setInterval(() => setNow(Date.now()), 60_000);
    onCleanup(() => clearInterval(clock));

    const newProject = () => (
        <PaperEffect variant="success">
            <PaperButton variant="success" disabled={working() || !props.projects.ready()} onClick={() => void create()}>
                <PaperIcon>add</PaperIcon>
                New project
            </PaperButton>
        </PaperEffect>
    );

    return (
        <PaperFlex fullWidth fullHeight overflowY="auto">
            <PaperPage width="wide">
                <PaperPageHeader icon="extension" title="Projects">
                    {/* an empty page offers this in its empty state instead */}
                    <Show when={props.projects.kept().length > 0}>{newProject()}</Show>
                </PaperPageHeader>
                <Show
                    when={props.projects.ready()}
                    fallback={
                        <Show when={props.projects.loadError()} fallback={<PaperLoader loaderStatus="indeterminate" label="Loading projects" />}>
                            <PaperEmptyState icon="error" title="Couldn't load">
                                <PaperButton onClick={() => void props.projects.load()}>Try again</PaperButton>
                            </PaperEmptyState>
                        </Show>
                    }
                >
                    <Show
                        when={props.projects.kept().length > 0}
                        fallback={
                            // unreadable is not empty: the toast says why
                            <Show
                                when={!props.projects.state().projectsError}
                                fallback={
                                    <PaperEmptyState icon="error" title="Couldn't load">
                                        <PaperButton disabled={reading.busy()} onClick={() => void reading.run("Couldn't read the projects", props.projects.readAgain)}>
                                            Try again
                                        </PaperButton>
                                    </PaperEmptyState>
                                }
                            >
                                <PaperEmptyState icon="extension" title="No projects yet" description="A project holds flows built from blocks, which run when something happens in any panel, or when you click Run.">
                                    {newProject()}
                                </PaperEmptyState>
                            </Show>
                        }
                    >
                        <PaperMediaCardGroup minCardWidth="card-min">
                            <For each={props.projects.kept()}>
                                {(project) => (
                                    <PaperMediaCard
                                        effect={false}
                                        banner={<CanvasPreview preview={project.preview} />}
                                        title={project.name}
                                        subtitle={editedText(project.editedAt, now())}
                                        description={project.loadError ?? undefined}
                                        badge={
                                            project.loadError
                                                ? <PaperBadge variant="danger">Not loaded</PaperBadge>
                                                : !project.enabled ? <PaperBadge variant="monochrome">Off</PaperBadge> : undefined
                                        }
                                        onClick={() => props.onOpen(project)}
                                        footerLeft={
                                            <label>
                                                <PaperFlex direction="row" align="center" gap="half">
                                                    <PaperToggle
                                                        checked={project.enabled}
                                                        disabled={Boolean(project.loadError)}
                                                        aria-label={`${project.name}: ${AUTO_START}`}
                                                        title={project.enabled ? "Flows start on their events" : "Flows don't start on their events"}
                                                        onChange={(enabled) => setEnabled(project.id, enabled)}
                                                    />
                                                    <PaperText preset="hint">{AUTO_START}</PaperText>
                                                </PaperFlex>
                                            </label>
                                        }
                                        footerRight={
                                            <PaperButton
                                                icon
                                                variant="text"
                                                title="More"
                                                aria-label={`More for ${project.name}`}
                                                onClick={(e) => {
                                                    setMenuFor(project);
                                                    menu.openBelow(e, { align: "right" });
                                                }}
                                            >
                                                <PaperIcon>more_vert</PaperIcon>
                                            </PaperButton>
                                        }
                                    />
                                )}
                            </For>
                        </PaperMediaCardGroup>
                    </Show>
                </Show>
            </PaperPage>
            <PaperContextMenu open={menu.isOpen()} target={menu.target()} placement={menu.placement()} onClose={menu.close}>
                <PaperContextMenuItem icon="open_in_new" onClick={fromMenu(props.onOpen)}>Open</PaperContextMenuItem>
                <PaperContextMenuItem icon="edit" onClick={fromMenu(setRenaming)}>Rename</PaperContextMenuItem>
                <PaperContextMenuItem icon="file_copy" disabled={working() || Boolean(menuFor()?.loadError)} onClick={fromMenu((p) => void duplicate(p.id))}>
                    Make a copy
                </PaperContextMenuItem>
                <PaperSeparator role="separator" />
                <PaperContextMenuItem icon="delete" danger onClick={fromMenu(setDeleting)}>Delete</PaperContextMenuItem>
            </PaperContextMenu>
            <RenameProjectModal project={renaming()} onRename={props.projects.rename} onClose={() => setRenaming(null)} />
            <DeleteProjectModal project={deleting()} onDelete={props.projects.remove} onClose={() => setDeleting(null)} />
        </PaperFlex>
    );
}
