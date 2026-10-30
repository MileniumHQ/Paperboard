// The first thing Actions shows: every project as a card with its canvas in
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
    PaperQuote,
    PaperSeparator,
    PaperToggle,
    useContextMenuState,
} from "@mileniumhq/paperui";
import CanvasPreview from "./CanvasPreview";
import { DeleteProjectModal, RenameProjectModal } from "./ProjectDialogs";
import { editedText, type ProjectsState } from "./state";
import type { ProjectSummary } from "../service";

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export default function ProjectsHome(props: { projects: ProjectsState; onOpen: (project: ProjectSummary) => void }) {
    const projects = props.projects;
    const [failure, setFailure] = createSignal<{ title: string; text: string } | null>(null);
    const [working, setWorking] = createSignal(false);
    const change = async (failed: string, work: () => Promise<void>) => {
        if (working()) return;
        setWorking(true);
        setFailure(null);
        try {
            await work();
        } catch (err) {
            setFailure({ title: failed, text: message(err) });
        } finally {
            setWorking(false);
        }
    };

    const create = () => change("Project not made", async () => props.onOpen(await projects.create()));
    const duplicate = (id: string) => change("Project not copied", async () => { await projects.duplicate(id); });
    // a switch flips on its own, never waiting on another change
    const setEnabled = (id: string, enabled: boolean) =>
        projects.setEnabled(id, enabled).catch((err) =>
            setFailure({ title: enabled ? "Flows not turned on" : "Flows not turned off", text: message(err) }));

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

    return (
        <PaperFlex fullWidth fullHeight overflowY="auto">
            <PaperPage width="wide">
                <PaperPageHeader icon="account_tree" title="Projects">
                    <PaperEffect variant="success">
                        <PaperButton variant="success" disabled={working() || !projects.ready()} onClick={() => void create()}>
                            <PaperIcon>add</PaperIcon>
                            New project
                        </PaperButton>
                    </PaperEffect>
                </PaperPageHeader>
                <Show when={failure()}>
                    {(f) => (
                        <PaperQuote variant="danger" icon="warning" title={f().title} role="alert" onDismiss={() => setFailure(null)}>
                            {f().text}
                        </PaperQuote>
                    )}
                </Show>
                <Show when={projects.state().projectsError}>
                    {(text) => (
                        <PaperQuote variant="danger" icon="warning" title="Projects could not be read" role="alert">{text()}</PaperQuote>
                    )}
                </Show>
                <Show
                    when={projects.ready()}
                    fallback={
                        <Show when={projects.loadError()} fallback={<PaperLoader loaderStatus="indeterminate" label="Loading projects" />}>
                            {(reason) => (
                                <PaperEmptyState icon="error" title="Projects could not be loaded" description={reason()} role="alert">
                                    <PaperButton onClick={() => void projects.load()}>Try again</PaperButton>
                                </PaperEmptyState>
                            )}
                        </Show>
                    }
                >
                    <Show
                        when={projects.kept().length > 0}
                        fallback={
                            <PaperEmptyState icon="account_tree" title="No projects yet" description="A project holds flows that run when something happens, like a message or a button on Home.">
                                <PaperButton variant="primary" disabled={working()} onClick={() => void create()}>New project</PaperButton>
                            </PaperEmptyState>
                        }
                    >
                        <PaperMediaCardGroup minCardWidth="card-min">
                            <For each={projects.kept()}>
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
                                            <PaperToggle
                                                checked={project.enabled}
                                                disabled={Boolean(project.loadError)}
                                                aria-label={`${project.name}: flows start on their events`}
                                                title={project.enabled ? "Flows on" : "Flows off"}
                                                onChange={(enabled) => void setEnabled(project.id, enabled)}
                                            />
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
            <RenameProjectModal project={renaming()} onRename={projects.rename} onClose={() => setRenaming(null)} />
            <DeleteProjectModal project={deleting()} onDelete={projects.remove} onClose={() => setDeleting(null)} />
        </PaperFlex>
    );
}
