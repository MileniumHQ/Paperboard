// The Blocks editor for one project: a top bar with its name, menus, its
// switch, Stop and Run, then the Library (a rail of categories, and the
// chosen one's blocks in Blockly's flyout) and the canvas, with a dock under
// it for the run log. A one-off failure is a toast; flows that can't load
// say why over the canvas. Edits save as you make them; the service runs
// the flows.
import { createEffect, createMemo, createSignal, on, onCleanup, onMount, Show, untrack } from "solid-js";
import * as Blockly from "blockly";
import { blocksApi, setUnsavedChanges } from "@mileniumhq/paperapi";
import {
    PaperButton,
    PaperContextMenuItem,
    PaperEffect,
    PaperError,
    PaperFlex,
    PaperIcon,
    PaperMenuBar,
    PaperMenuBarMenu,
    PaperModal,
    PaperSeparator,
    PaperText,
    PaperToggle,
    createAction,
    showError,
    showToast,
} from "@mileniumhq/paperui";
import { BUILTIN_BLOCKS, builtinPlaceholder } from "./lib/blockDefs";
import { registerChoicesField, setChoicesProject } from "./lib/choicesField";
import { setLibraryTop, type LibraryFlyout } from "./lib/libraryFlyout";
import { tokenPixels } from "./lib/tokens";
import { loadBlockFonts } from "./lib/paperRenderer";
import { setPanelIcons } from "./lib/blockStyles";
import { HEADING_KIND, type HeadingInfo } from "./lib/libraryHeading";
import { setTextPlaceholders } from "./lib/textField";
import type { TrashState } from "./lib/trashZone";
import { createCanvas, type Canvas } from "./lib/canvas";
import "./lib/undrawnFields";
import { parseEntry, parseRegistryBlockType } from "./lib/names";
import { isScheduleHat } from "./lib/schedule";
import { SCHEDULE_OFF, nextRunText, showNextRun } from "./lib/scheduleFields";
import { Console } from "./Console";
import { service, serviceState, type Notice } from "./bridge";
import type { PanelState, ProjectSummary, SavedFlows } from "./panel";
import { AUTO_START, switchFailed, type ProjectsState } from "./projects/state";
import { DeleteProjectModal, ProjectNameField, RenameProjectModal } from "./projects/ProjectDialogs";
import { NewProjectModal } from "./projects/NewProjectModal";
import { createFileActions } from "./FileActions";
import { BlocklyDialogs } from "./BlocklyDialogs";
import { LibraryHeader, LibraryRail } from "./Library";
import { createLibraryModel } from "./libraryModel";
import { createEditorFlows, define } from "./editorFlows";
import styles from "./Editor.module.css";

const RUN_FAILED = "Couldn't run the flows";
const LOAD_FAILED = "Couldn't load your flows";
const HEADING_CLASSES: HeadingInfo["classes"] = { heading: styles.heading!, icon: styles.headingIcon!, badge: styles.headingBadge!, badgeText: styles.headingBadgeText! };

export default function Editor(props: {
    projectId: string;
    project: () => ProjectSummary;
    projects: ProjectsState;
    onHome: () => void;
    onOpen: (project: ProjectSummary) => void;
}) {
    let host!: HTMLDivElement;
    let trashTile!: HTMLDivElement;
    const [trash, setTrash] = createSignal<TrashState>({ dragging: false, over: false });
    let workspace: Blockly.WorkspaceSvg | undefined;
    // the Library is collapsed as the person chose, or else while the editor is too narrow
    // for it to leave the canvas the larger share
    const [collapseChoice, setCollapsed] = createSignal<boolean | null>(null);
    const [narrow, setNarrow] = createSignal(false);
    const collapsed = () => collapseChoice() ?? narrow();
    const [ready, setReady] = createSignal(false);
    // the newest log line already pointed at on the canvas
    let shownLogId = 0;

    const notify = (notice: Notice) =>
        void (notice.kind === "failed" ? showError(notice.title, notice.text) : showToast({ variant: "success", title: notice.title, message: notice.text }));
    // the bridge's state as the projects store keeps it (reconciled by id): a log line adds one row
    // to the console rather than handing it a whole new list of rows
    const running = () => props.projects.state().running[props.projectId] ?? 0;
    const log = createMemo(() => props.projects.state().log.filter((entry) => entry.project === props.projectId));

    const library = createLibraryModel({ workspace: () => workspace, ready, headingClasses: HEADING_CLASSES });
    const flows = createEditorFlows({
        project: () => props.projectId,
        workspace: () => workspace,
        onRegistry: library.setRegistry,
        onNotice: notify,
        // the log lines from before the flows were shown are on the blocks they name
        onLoaded: () => showErrors(props.projects.state()),
        needsPreview: () => {
            const project = props.project();
            return project.preview === null && project.editedAt === project.createdAt;
        },
    });
    // Try again waits on the load it started; a load that fails says why over the canvas
    const [loadingAgain, setLoadingAgain] = createSignal(false);
    const loadAgain = () => {
        setLoadingAgain(true);
        void flows.load().finally(() => setLoadingAgain(false));
    };

    // each schedule hat says when it next runs, as the service worked it out, read again each half minute
    const [clock, setClock] = createSignal(Date.now());
    const ticking = setInterval(() => setClock(Date.now()), 30_000);
    onCleanup(() => clearInterval(ticking));
    function showNextRuns(): void {
        if (!workspace || !flows.loaded()) return;
        const enabled = props.project().enabled;
        const next = props.projects.state().nextRuns[props.projectId] ?? {};
        const now = clock();
        for (const block of workspace.getTopBlocks(false)) {
            if (!isScheduleHat(block.type)) continue;
            const at = next[block.id];
            showNextRun(block, !block.isEnabled() ? null : !enabled ? SCHEDULE_OFF : at === undefined ? null : nextRunText(at, now));
        }
    }
    createEffect(on([() => props.projects.state().nextRuns[props.projectId], () => props.project().enabled, flows.loaded, clock], () => showNextRuns()));

    function showErrors(next: PanelState): void {
        if (!workspace) return;
        for (const entry of next.log) {
            if (entry.id <= shownLogId) continue;
            if (entry.project === props.projectId && entry.level === "error" && entry.blockId) workspace.getBlockById(entry.blockId)?.setWarningText(entry.message, "run");
        }
        shownLogId = next.log.at(-1)?.id ?? shownLogId;
    }

    // the section last jumped to in the list shown, which the Section menu says
    const [jumpedTo, setJumpedTo] = createSignal("");
    /** Scrolls the list to a section's heading. */
    function jump(section: string): void {
        const before = untrack(jumpedTo);
        setJumpedTo(section);
        try {
            const flyout = workspace?.getFlyout();
            const list = flyout?.getWorkspace();
            if (!flyout || !list?.scrollbar) throw new Error("The Library's list isn't drawn yet");
            const heading = flyout.getContents().filter((item) => item.getType() === HEADING_KIND)[library.sectionNames().indexOf(section)];
            if (!heading) throw new Error(`The Library has no section "${section}"`);
            list.scrollbar.setY(heading.getElement().getBoundingRectangle().top * list.scale);
        } catch (err) {
            setJumpedTo(before);
            showError("Couldn't jump to that section", err);
        }
    }

    onMount(() => {
        registerChoicesField({
            fetch: (s) => ("typeRef" in s ? blocksApi.typeChoices(s.typeRef, s.project ? { project: s.project } : {}) : blocksApi.choices(s.panelId, s.entry, s.input)),
            report: (text) => showError("Couldn't load the choices", text),
        });
        // a type's values are listed in the project of the block they're in, when it's one of the type's own panel's
        setChoicesProject((holder, typeRef) => {
            const name = holder ? parseRegistryBlockType(holder.type) : null;
            if (!name || name.panelId !== typeRef.slice(0, typeRef.indexOf(":"))) return undefined;
            return parseEntry(name.entry).project;
        });
        define(BUILTIN_BLOCKS);
        setPanelIcons(library.panelIcon);
        // an empty socket says what goes in it: the panel's name for the input, or a built-in's
        setTextPlaceholders((parent, input) => {
            if (!parent || !input) return builtinPlaceholder(null);
            const schema = flows.schemaOf(parent.type);
            if (!schema) return builtinPlaceholder(input);
            if (schema.kind === "type") return schema.name;
            const named = "inputs" in schema ? schema.inputs?.[input]?.name : undefined;
            if (!named) throw new Error(`${schema.name} has no input ${input}`);
            return named;
        });
        let closed = false;
        let canvas: Canvas | undefined;
        let offRegistry: (() => void) | undefined;
        const offState = serviceState.subscribe((full) => showErrors(full));

        const start = () => {
            if (closed) return;
            canvas = createCanvas(host, {
                trash: trashTile,
                onTrash: setTrash,
                resultsTrayClass: styles.resultsTray!,
                onThemeFailed: (err) => showError("The blocks couldn't follow the theme", err),
                onChange: (event) => {
                    if (event.type === Blockly.Events.VAR_CREATE || event.type === Blockly.Events.VAR_DELETE || event.type === Blockly.Events.VAR_RENAME) {
                        library.variablesChanged();
                    }
                    if (!event.isUiEvent) library.setFunctionsShape(JSON.stringify(Blockly.Procedures.allProcedures(workspace!)));
                    // a schedule hat dropped on or switched off says so before the service answers
                    if (!event.isUiEvent) untrack(showNextRuns);
                    if (!flows.loaded() || event.isUiEvent) return;
                    if (event.type === Blockly.Events.BLOCK_CREATE || event.type === Blockly.Events.BLOCK_DELETE) flows.markResults();
                    flows.edited();
                },
            });
            workspace = canvas.workspace;
            offRegistry = blocksApi.onRegistryChange(flows.registryChanged);
            flows.load().catch((err) => showError(LOAD_FAILED, err));
            setReady(true);
        };
        // Blockly measures text as it draws, so it waits for the font
        loadBlockFonts().then(start, (err) => showError("The blocks couldn't be drawn", err));

        onCleanup(() => {
            closed = true;
            flows.dispose();
            offState();
            offRegistry?.();
            canvas?.dispose();
        });
    });

    // the list follows the chosen category, project and search
    // and starts at the top only for a different list: a variable, a function or a block
    // refresh redraws the list where the person is reading it
    let shownList = "";
    createEffect(
        on([library.flyout, library.definitions, library.selected, library.shownProject, library.query, ready], ([contents, , selected, project, query, drawn]) => {
            if (!drawn || !workspace) return;
            const list = JSON.stringify([selected, project, query]);
            workspace.updateToolbox({ kind: "flyoutToolbox", contents } as unknown as Blockly.utils.toolbox.ToolboxDefinition);
            if (list !== shownList) {
                workspace.getFlyout()?.scrollToStart();
                setJumpedTo("");
            }
            shownList = list;
        }),
    );

    // the Library is hidden while it's collapsed, and while the flows couldn't be loaded
    const libraryShown = () => !collapsed() && !flows.loadError();
    createEffect(
        on([libraryShown, ready], ([shown, drawn]) => {
            if (!drawn || !workspace) return;
            (workspace.getFlyout() as LibraryFlyout | null)?.setShown(shown);
            Blockly.svgResize(workspace);
        }),
    );

    /** Narrow: the editor is less wide than the room the Library and the canvas need side by side. */
    const bodyRef = (el: HTMLDivElement) => {
        const observer = new ResizeObserver(() => setNarrow(el.clientWidth < tokenPixels("--paper-size-panel-wide")));
        observer.observe(el);
        onCleanup(() => observer.disconnect());
    };

    /** The list starts where the header ends. */
    const headerRef = (el: HTMLDivElement) => {
        const observer = new ResizeObserver(() => {
            setLibraryTop(el.offsetHeight);
            workspace?.getFlyout()?.position();
        });
        observer.observe(el);
        onCleanup(() => observer.disconnect());
    };

    const zoom = (by: number) => workspace?.zoomCenter(by);
    const resetView = () => {
        if (!workspace) return;
        workspace.setScale(workspace.options.zoomOptions.startScale);
        workspace.scrollCenter();
    };

    // a failure is a toast, which closes once the same thing goes through
    const runs = createAction();
    const run = () => {
        for (const block of workspace?.getAllBlocks(false) ?? []) block.setWarningText(null, "run");
        // Run starts what is saved, so the latest edits go first
        void runs.run(RUN_FAILED, async () => {
            await flows.saveNow();
            await service.runFlows({ project: props.projectId });
        });
    };

    // the project changes the menus make, one at a time
    const changes = createAction();
    const working = changes.busy;
    const change = async (failed: string, work: () => Promise<void>) => {
        if (!working()) await changes.run(failed, work);
    };
    // the latest edits are saved before the canvas goes, before a copy is made
    // of what was saved, and before anything new is made, so a save that fails
    // leaves nothing made behind
    const saveFirst = async (missing = "") => {
        const saved = await flows.flush();
        if (!saved.ok) throw new Error(`Your latest changes are not saved${missing}: ${saved.message}`);
    };
    // a new project left without a block is not kept: it is saved by now, so
    // the service sees whether it has one
    const leaveDraft = async () => {
        if (props.project().draft) await props.projects.discardDraft(props.projectId);
    };
    // New project asks what to start with; this one's edits are saved first, so a save that fails leaves nothing made
    const [creating, setCreating] = createSignal(false);
    const newProject = async (start: { name?: string; flows?: SavedFlows }) => {
        await saveFirst();
        const made = await props.projects.create(start.name, start.flows);
        await leaveDraft();
        props.onOpen(made);
    };
    const copyProject = () =>
        change("Project not copied", async () => {
            await saveFirst(", so the copy would miss them");
            const copy = await props.projects.duplicate(props.projectId);
            await leaveDraft();
            props.onOpen(copy);
        });
    const goHome = () =>
        change("Project not closed", async () => {
            await saveFirst();
            await leaveDraft();
            props.onHome();
        });
    // the switch flips on its own, never waiting on another change; it moves once the service says so
    const switching = createAction();
    const setEnabled = (enabled: boolean) => switching.run(switchFailed(enabled), () => props.projects.setEnabled(props.projectId, enabled));
    const [renaming, setRenaming] = createSignal(false);
    const [deleting, setDeleting] = createSignal(false);

    // Paperboard asks before it restarts or uninstalls the panel while an edit isn't saved: it is
    // saved then, and a save that fails asks whether to go without it
    const [leaving, setLeaving] = createSignal<{ why: string; answer: (leave: boolean) => void } | null>(null);
    const answerLeave = (leave: boolean) => {
        leaving()?.answer(leave);
        setLeaving(null);
    };
    const confirmLeave = async () => {
        const saved = await flows.flush();
        if (saved.ok) return true;
        answerLeave(false);
        return new Promise<boolean>((answer) => setLeaving({ why: saved.message, answer }));
    };
    createEffect(on(flows.unsaved, (unsaved) => setUnsavedChanges(unsaved ? confirmLeave : null)));
    onCleanup(() => {
        answerLeave(false);
        setUnsavedChanges(null);
    });

    const file = createFileActions({
        name: () => props.project().name,
        loaded: flows.loaded,
        snapshot: flows.snapshot,
        add: flows.addFlows,
        flush: flows.flush,
        reload: async () => {
            await flows.load();
            const failed = flows.loadError();
            if (failed) throw new Error(failed);
        },
        onNotice: notify,
    });

    return (
        <PaperFlex direction="column" fullWidth fullHeight>
            <div class={styles.topbar}>
                <PaperFlex direction="row" align="center" gap="half" padding="half" background="surface" fullWidth>
                    <PaperButton icon variant="text" title="All projects" aria-label="All projects" disabled={working()} onClick={() => void goHome()}>
                        <PaperIcon>arrow_back</PaperIcon>
                    </PaperButton>
                    <PaperFlex direction="column" align="flex-start" gap="onefourth">
                        <ProjectNameField
                            name={props.project().name}
                            onRename={(name) => props.projects.rename(props.projectId, name)}
                            onFailed={(err) => showError("Couldn't rename the project", err)}
                        />
                        <PaperMenuBar aria-label={props.project().name}>
                            <PaperMenuBarMenu label="Project" size="tiny">
                                <PaperContextMenuItem icon="add" disabled={working()} onClick={() => setCreating(true)}>
                                    New project
                                </PaperContextMenuItem>
                                <PaperContextMenuItem icon="file_copy" disabled={working() || !ready()} onClick={() => void copyProject()}>
                                    Make a copy
                                </PaperContextMenuItem>
                                <PaperContextMenuItem icon="edit" onClick={() => setRenaming(true)}>
                                    Rename
                                </PaperContextMenuItem>
                                <PaperSeparator role="separator" />
                                <PaperContextMenuItem icon="delete" danger onClick={() => setDeleting(true)}>
                                    Delete
                                </PaperContextMenuItem>
                            </PaperMenuBarMenu>
                            <PaperMenuBarMenu label="File" size="tiny">
                                <PaperContextMenuItem icon="file_export" disabled={file.busy() || !flows.loaded()} onClick={() => void file.exportFlows()}>
                                    Export
                                </PaperContextMenuItem>
                                <PaperContextMenuItem icon="file_open" disabled={file.busy() || !flows.loaded()} onClick={() => void file.importFlows()}>
                                    Import
                                </PaperContextMenuItem>
                            </PaperMenuBarMenu>
                            <PaperMenuBarMenu label="Backup" size="tiny">
                                <PaperContextMenuItem icon="backup" disabled={file.busy()} onClick={() => void file.createBackup()}>
                                    Create backup
                                </PaperContextMenuItem>
                                <PaperContextMenuItem icon="settings_backup_restore" disabled={file.busy()} onClick={() => void file.openLoad()}>
                                    Load backup
                                </PaperContextMenuItem>
                            </PaperMenuBarMenu>
                        </PaperMenuBar>
                    </PaperFlex>
                    <PaperFlex direction="row" align="center" justify="flex-end" gap="full" paddingX="half" fullWidth>
                        <label>
                            <PaperFlex direction="row" align="center" gap="half">
                                <PaperToggle
                                    checked={props.project().enabled}
                                    aria-label={AUTO_START}
                                    title="When off, this project's flows don't start on their events"
                                    onChange={setEnabled}
                                />
                                <PaperText preset="hint">{AUTO_START}</PaperText>
                            </PaperFlex>
                        </label>
                        <PaperFlex direction="row" align="center" gap="half">
                            <PaperEffect variant="danger">
                                <PaperButton
                                    variant="danger"
                                    icon
                                    disabled={running() === 0}
                                    onClick={() => service.stopFlows({ project: props.projectId }).catch((err) => showError("Couldn't stop the flows", err))}
                                    title={running() === 1 ? "Stop the flow running now" : `Stop the ${running()} flows running now`}
                                    aria-label="Stop"
                                >
                                    <PaperIcon>stop</PaperIcon>
                                </PaperButton>
                            </PaperEffect>
                            <PaperEffect variant="success">
                                <PaperButton variant="success" icon disabled={!ready()} onClick={run} title="Run the flows that start when Run is clicked" aria-label="Run">
                                    <PaperIcon>play_arrow</PaperIcon>
                                </PaperButton>
                            </PaperEffect>
                        </PaperFlex>
                    </PaperFlex>
                </PaperFlex>
            </div>
            <file.LoadBackupModal />
            <PaperModal
                open={leaving() !== null}
                title="Your latest changes aren't saved"
                size="small"
                onClose={() => answerLeave(false)}
                footer={
                    <>
                        <PaperButton variant="text" onClick={() => answerLeave(false)}>Stay</PaperButton>
                        <PaperButton variant="danger" onClick={() => answerLeave(true)}>Leave without them</PaperButton>
                    </>
                }
            >
                <PaperFlex direction="column" gap="half">
                    <PaperText preset="text">{leaving()?.why}</PaperText>
                    <PaperText preset="hint">Stay to keep them on the canvas, or leave without them.</PaperText>
                </PaperFlex>
            </PaperModal>
            <NewProjectModal open={creating()} onCreate={newProject} onClose={() => setCreating(false)} />
            <RenameProjectModal project={renaming() ? props.project() : null} onRename={props.projects.rename} onClose={() => setRenaming(false)} />
            <DeleteProjectModal
                project={deleting() ? props.project() : null}
                onDelete={async (id) => {
                    // the project goes with its edits, so none is sent after it is gone
                    flows.discard();
                    try {
                        await props.projects.remove(id);
                    } catch (err) {
                        flows.edited();
                        throw err;
                    }
                    props.onHome();
                }}
                onClose={() => setDeleting(false)}
            />
            <div class={styles.body} ref={bodyRef}>
                <Show when={libraryShown()}>
                    <LibraryRail builtins={library.builtins} panels={library.panels()} selected={library.selected()} onSelect={library.choose} />
                </Show>
                <div class={styles.main}>
                    <div class={styles.stage}>
                        <div ref={host} class={styles.canvas} />
                        {/* the canvas holds none of the flows: it says why over them, until they load */}
                        <Show when={flows.loadError()}>
                            {(why) => (
                                <div class={styles.cover}>
                                    <PaperError
                                        fill
                                        title={LOAD_FAILED}
                                        error={why()}
                                        action={{ label: "Try again", disabled: loadingAgain(), onClick: loadAgain }}
                                    />
                                </div>
                            )}
                        </Show>
                        <Show when={!flows.loadError()}>
                            <Show
                                when={!collapsed()}
                                fallback={
                                    <div class={styles.expand}>
                                        <PaperButton onClick={() => setCollapsed(false)} title="Open the Library">
                                            <PaperIcon>menu_open</PaperIcon>
                                            Library
                                        </PaperButton>
                                    </div>
                                }
                            >
                                <LibraryHeader
                                    category={library.category()}
                                    selected={library.selected()}
                                    search={library.search()}
                                    onSearch={library.typeSearch}
                                    count={library.count()}
                                    projects={library.projects()}
                                    project={library.shownProject()}
                                    onProject={library.chooseProject}
                                    sections={library.sectionNames()}
                                    section={jumpedTo()}
                                    onJump={jump}
                                    onCollapse={() => setCollapsed(true)}
                                    onCreateVariable={library.showsVariables() && ready() ? () => Blockly.Variables.createVariableButtonHandler(workspace!) : undefined}
                                    headerRef={headerRef}
                                />
                            </Show>
                        </Show>
                        <div class={styles.bottomRight}>
                            <PaperFlex direction="column" gap="half">
                                <PaperButton variant="primary" icon onClick={() => zoom(1)} title="Zoom in" aria-label="Zoom in">
                                    <PaperIcon>add</PaperIcon>
                                </PaperButton>
                                <PaperButton variant="primary" icon onClick={() => zoom(-1)} title="Zoom out" aria-label="Zoom out">
                                    <PaperIcon>remove</PaperIcon>
                                </PaperButton>
                                <PaperButton variant="primary" icon onClick={resetView} title="Reset the view" aria-label="Reset the view">
                                    <PaperIcon>center_focus_strong</PaperIcon>
                                </PaperButton>
                            </PaperFlex>
                            <div
                                ref={trashTile}
                                class={styles.trash}
                                classList={{ [styles.trashDragging!]: trash().dragging, [styles.trashOver!]: trash().over }}
                                title="Drop a block here to delete it"
                            >
                                <PaperIcon>{trash().over ? "delete_forever" : "delete"}</PaperIcon>
                            </div>
                        </div>
                    </div>
                    <Show when={log().length > 0}>
                        <div class={styles.dock}>
                            <Console entries={log()} onClear={() => service.clearLog({ project: props.projectId }).catch((err) => showError("Couldn't clear the log", err))} />
                        </div>
                    </Show>
                </div>
            </div>
            <BlocklyDialogs />
        </PaperFlex>
    );
}
