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
    PaperError,
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
    useContextMenuState,
} from "@mileniumhq/paperui";
import CanvasPreview from "./CanvasPreview";
import { DeleteProjectModal, RenameProjectModal } from "./ProjectDialogs";
import { NewProjectModal } from "./NewProjectModal";
import { AUTO_START, editedText, switchFailed, type ProjectsState } from "./state";
import type { ProjectSummary } from "../panel";


export default function ProjectsHome(props: { projects: ProjectsState; onOpen: (project: ProjectSummary) => void }) {
    // what fails is a toast, which closes once the same thing goes through; one change at a time
    const changes = createAction();
    const working = changes.busy;
    const change = async (failed: string, work: () => Promise<void>) => {
        if (!working()) await changes.run(failed, work);
    };

    // New project asks what to start with: an empty canvas or a template
    const [creating, setCreating] = createSignal(false);
    const duplicate = (id: string) => change("Couldn't copy the project", async () => { await props.projects.duplicate(id); });
    // a switch flips on its own, never waiting on another change, and moves once the service says so
    const switching = createAction();
    const setEnabled = (id: string, enabled: boolean) => switching.run(switchFailed(enabled), () => props.projects.setEnabled(id, enabled));
    // what the service can't do stands, said in place, until it says it is over.
    // The service reads its projects as it starts; after that failed, only when asked again,
    // and a read again that is refused says why in the same place
    const reading = createAction({ toast: false });
    // the service's word is what stands: a refused read again only says it newer
    const unreadable = () => props.projects.state().projectsError && (reading.error()?.message ?? props.projects.state().projectsError);
    const readAgain = () => void reading.run("Couldn't read the projects", props.projects.readAgain);
    const unreadableError = (fill: boolean) => (
        <PaperError
            fill={fill}
            title="Couldn't read the projects"
            error={unreadable()}
            action={{ label: "Try again", disabled: reading.busy(), onClick: readAgain }}
        />
    );
    const loadAgain = () => void props.projects.load();

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
            <PaperButton variant="success" disabled={working() || !props.projects.ready()} onClick={() => setCreating(true)}>
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
                <Show when={props.projects.state().blocksError}>
                    {(why) => <PaperError title="Flows can't drive projects" error={why()} />}
                </Show>
                {/* a list already on screen stays, under why it couldn't be read again */}
                <Show when={props.projects.ready() && props.projects.loadError()}>
                    {(err) => (
                        <PaperError
                            title="Couldn't load the projects"
                            error={err()}
                            action={{ label: "Try again", disabled: props.projects.loading(), onClick: loadAgain }}
                        />
                    )}
                </Show>
                <Show when={props.projects.kept().length > 0 && unreadable()}>{unreadableError(false)}</Show>
                <Show
                    when={props.projects.ready()}
                    fallback={
                        <Show when={props.projects.loadError()} fallback={<PaperLoader loaderStatus="indeterminate" label="Loading projects" />}>
                            {(err) => (
                                <PaperError
                                    fill
                                    title="Couldn't load the projects"
                                    error={err()}
                                    action={{ label: "Try again", disabled: props.projects.loading(), onClick: loadAgain }}
                                />
                            )}
                        </Show>
                    }
                >
                    <Show
                        when={props.projects.kept().length > 0}
                        fallback={
                            // unreadable is not empty: it says why, in place of the list
                            <Show when={!unreadable()} fallback={unreadableError(true)}>
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
            <NewProjectModal
                open={creating()}
                onCreate={async ({ name, flows }) => props.onOpen(await props.projects.create(name, flows))}
                onClose={() => setCreating(false)}
            />
            <RenameProjectModal project={renaming()} onRename={props.projects.rename} onClose={() => setRenaming(null)} />
            <DeleteProjectModal project={deleting()} onDelete={props.projects.remove} onClose={() => setDeleting(null)} />
        </PaperFlex>
    );
}
