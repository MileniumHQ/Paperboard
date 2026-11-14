// The Blocks editor for one project: a top bar with its name, menus, its
// switch, Stop and Run, then the Library (a rail of categories, and the
// chosen one's blocks in Blockly's flyout) and the canvas. Edits save as you
// make them; the service runs the flows.
import { createEffect, createMemo, createSignal, on, onCleanup, onMount, Show } from "solid-js";
import * as Blockly from "blockly";
import { blocksApi } from "@mileniumhq/paperapi";
import {
    PaperButton,
    PaperContextMenuItem,
    PaperEffect,
    PaperFlex,
    PaperIcon,
    PaperMenuBar,
    PaperMenuBarMenu,
    PaperQuote,
    PaperSeparator,
    PaperToggle,
} from "@mileniumhq/paperui";
import { BUILTIN_BLOCKS, builtinPlaceholder } from "./lib/blockDefs";
import { registerChoicesField, setChoicesProject } from "./lib/choicesField";
import { LIBRARY_FLYOUT, setLibraryTop, uiGap, type LibraryFlyout } from "./lib/libraryFlyout";
import { loadBlockFonts, PAPER_RENDERER, paperTheme } from "./lib/paperRenderer";
import { setPanelIcons } from "./lib/blockStyles";
import { HEADING_KIND, type HeadingInfo } from "./lib/libraryHeading";
import { setTextPlaceholders } from "./lib/textField";
import { addTrash, type TrashState } from "./lib/trashZone";
import { addResultsTray } from "./lib/results";
import { cullOffscreenStacks } from "./lib/culling";
import { nativeTooltips } from "./lib/nativeTooltips";
import "./lib/undrawnFields";
import { parseEntry, parseRegistryBlockType } from "./lib/names";
import { tokenPixels } from "./lib/tokens";
import { Console } from "./Console";
import { paperContextMenus } from "./lib/contextMenu";
import { paperDropdowns } from "./lib/dropdownPlacement";
import { errorMessage } from "./lib/failure";
import { SERVICE_CALLS, type PanelState } from "./panel";
import { bridge, type Notice } from "./bridge";
import type { ProjectSummary } from "./lib/projects";
import { switchFailed, type ProjectsState } from "./projects/state";
import { DeleteProjectModal, ProjectNameField, RenameProjectModal } from "./projects/ProjectDialogs";
import { createFileActions } from "./FileActions";
import { BlocklyDialogs } from "./BlocklyDialogs";
import { LibraryHeader, LibraryRail } from "./Library";
import { createLibraryModel } from "./libraryModel";
import { createEditorFlows, define, NOT_SAVED } from "./editorFlows";
import styles from "./Editor.module.css";

const RUN_FAILED = "Run didn't start";
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
    const [notice, setNotice] = createSignal<Notice | null>(null);
    const [collapsed, setCollapsed] = createSignal(false);
    const [ready, setReady] = createSignal(false);
    // the newest log line already pointed at on the canvas
    let shownLogId = 0;

    const fail = (title: string) => (err: unknown) => setNotice({ kind: "failed", title, text: errorMessage(err) });
    /** what failed has worked since: its notice goes, and any other stays */
    const worked = (...titles: string[]) => setNotice((shown) => (shown && titles.includes(shown.title) ? null : shown));
    // the bridge's state as the projects store keeps it (reconciled by id): a log line adds one row
    // to the console rather than handing it a whole new list of rows
    const running = () => props.projects.state().running[props.projectId] ?? 0;
    const log = createMemo(() => props.projects.state().log.filter((entry) => entry.project === props.projectId));

    const library = createLibraryModel({ workspace: () => workspace, ready, headingClasses: HEADING_CLASSES });
    const flows = createEditorFlows({
        project: () => props.projectId,
        workspace: () => workspace,
        onRegistry: library.setRegistry,
        onNotice: setNotice,
        onSaved: () => worked(NOT_SAVED),
        // the log lines from before the flows were shown are on the blocks they name
        onLoaded: () => showErrors(props.projects.state()),
    });

    function showErrors(next: PanelState): void {
        if (!workspace) return;
        for (const entry of next.log) {
            if (entry.id <= shownLogId) continue;
            if (entry.project === props.projectId && entry.level === "error" && entry.blockId) workspace.getBlockById(entry.blockId)?.setWarningText(entry.message, "run");
        }
        shownLogId = next.log.at(-1)?.id ?? shownLogId;
    }

    /** Scrolls the list to a section's heading. */
    function jump(section: string): void {
        const flyout = workspace?.getFlyout();
        if (!flyout) return;
        const heading = flyout.getContents().filter((item) => item.getType() === HEADING_KIND)[library.sectionNames().indexOf(section)];
        const list = flyout.getWorkspace();
        if (!heading || !list.scrollbar) throw new Error(`The Library has no section "${section}"`);
        list.scrollbar.setY(heading.getElement().getBoundingRectangle().top * list.scale);
    }

    onMount(() => {
        registerChoicesField({
            fetch: (s) => ("typeRef" in s ? blocksApi.typeChoices(s.typeRef, s.project ? { project: s.project } : {}) : blocksApi.choices(s.panelId, s.entry, s.input)),
            report: (text) => setNotice({ kind: "failed", title: "Choices didn't load", text }),
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
        let offRegistry: (() => void) | undefined;
        let offTooltips: (() => void) | undefined;
        let offCulling: (() => void) | undefined;
        // The canvas is laid out again when its size changes, but not under a
        // block being dragged: Blockly would scroll to fit the block where it
        // was picked up, and it would leave the pointer. That waits for the drop.
        let fitWaiting = false;
        const fit = () => {
            if (!workspace) return;
            fitWaiting = workspace.isDragging();
            if (!fitWaiting) Blockly.svgResize(workspace);
        };
        const resize = new ResizeObserver(fit);
        const offState = bridge.onStateChange((_patch, full) => {
            showErrors(full);
        });

        const start = () => {
            if (closed) return;
            paperContextMenus();
            paperDropdowns();
            workspace = Blockly.inject(host, {
                renderer: PAPER_RENDERER,
                theme: paperTheme(),
                toolbox: { kind: "flyoutToolbox", contents: [] },
                plugins: { flyoutsVerticalToolbox: LIBRARY_FLYOUT },
                media: "./blockly-media/",
                // the trash and zoom are PaperUI's, over the canvas (below)
                trashcan: false,
                zoom: { controls: false, wheel: true, startScale: 1 },
                // the canvas's dots: one at every double gap, drawn by Editor.module.css
                grid: { spacing: tokenPixels("--paper-uigap") * 2, length: 1, colour: "transparent", snap: false },
                move: { scrollbars: true, drag: true, wheel: false },
                // the app makes no sounds; neither do its blocks
                sounds: false,
            });
            offTooltips = nativeTooltips(host);
            offCulling = cullOffscreenStacks(workspace);
            resize.observe(host);
            addTrash(workspace, trashTile, setTrash);
            addResultsTray(workspace, styles.resultsTray!, uiGap());
            followTheme();

            workspace.addChangeListener((event: Blockly.Events.Abstract) => {
                if (fitWaiting) fit();
                if (event.type === Blockly.Events.VAR_CREATE || event.type === Blockly.Events.VAR_DELETE || event.type === Blockly.Events.VAR_RENAME) {
                    library.variablesChanged();
                }
                if (!event.isUiEvent) library.setFunctionsShape(JSON.stringify(Blockly.Procedures.allProcedures(workspace!)));
                if (!flows.loaded() || event.isUiEvent) return;
                if (event.type === Blockly.Events.BLOCK_CREATE || event.type === Blockly.Events.BLOCK_DELETE) flows.markResults();
                flows.edited();
            });
            offRegistry = blocksApi.onRegistryChange(flows.registryChanged);
            flows.load().catch(fail("Your flows couldn't be loaded"));
            setReady(true);
        };
        // Blockly measures text as it draws, so it waits for the font
        loadBlockFonts().then(start, fail("The blocks couldn't be drawn"));

        /** Light or dark, as the app switches: Blockly takes colours, not variables, so the theme is made again. */
        const themeChanges = new MutationObserver(() => retheme());
        const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
        const retheme = () => {
            if (!workspace) return;
            try {
                workspace.setTheme(paperTheme());
                // a collapsed Library stays hidden
                (workspace.getFlyout() as LibraryFlyout | null)?.redisplay();
            } catch (err) {
                fail("The blocks couldn't follow the theme")(err);
            }
        };
        const followTheme = () => {
            themeChanges.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-paperui-theme", "class"] });
            darkQuery.addEventListener("change", retheme);
        };

        onCleanup(() => {
            closed = true;
            themeChanges.disconnect();
            darkQuery.removeEventListener("change", retheme);
            flows.dispose();
            resize.disconnect();
            offState();
            offRegistry?.();
            offTooltips?.();
            offCulling?.();
            workspace?.dispose();
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
            if (list !== shownList) workspace.getFlyout()?.scrollToStart();
            shownList = list;
        }),
    );

    // the Library is hidden while it's collapsed, and while the flows couldn't be loaded
    const libraryShown = () => !collapsed() && !flows.loadError();
    createEffect(
        on([libraryShown, ready], ([shown, drawn]) => {
            if (!drawn || !workspace) return;
            workspace.getFlyout()?.setVisible(shown);
            Blockly.svgResize(workspace);
        }),
    );

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

    const run = () => {
        for (const block of workspace?.getAllBlocks(false) ?? []) block.setWarningText(null, "run");
        // Run starts what is saved, so the latest edits go first
        flows
            .saveNow()
            .then(() => bridge.call<number>(SERVICE_CALLS.run, { project: props.projectId }))
            .then(() => worked(RUN_FAILED), fail(RUN_FAILED));
    };

    // the project changes the menus make, each reporting what failed
    const [working, setWorking] = createSignal(false);
    const change = async (failed: string, work: () => Promise<void>) => {
        if (working()) return;
        setWorking(true);
        try {
            await work();
            worked(failed);
        } catch (err) {
            fail(failed)(err);
        } finally {
            setWorking(false);
        }
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
    const newProject = () =>
        change("Project not made", async () => {
            await saveFirst();
            const made = await props.projects.create();
            await leaveDraft();
            props.onOpen(made);
        });
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
    const setEnabled = (enabled: boolean) =>
        props.projects.setEnabled(props.projectId, enabled).then(() => worked(switchFailed(true), switchFailed(false)), fail(switchFailed(enabled)));
    const [renaming, setRenaming] = createSignal(false);
    const [deleting, setDeleting] = createSignal(false);

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
        onNotice: setNotice,
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
                            onFailed={(text) => setNotice({ kind: "failed", title: "Not renamed", text })}
                        />
                        <PaperMenuBar aria-label={props.project().name}>
                            <PaperMenuBarMenu label="Project" size="tiny">
                                <PaperContextMenuItem icon="add" disabled={working()} onClick={() => void newProject()}>
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
                        <PaperToggle
                            checked={props.project().enabled}
                            aria-label="Flows start on their events"
                            title="When off, this project's flows don't start on their events"
                            onChange={setEnabled}
                        />
                        <PaperFlex direction="row" align="center" gap="half">
                            <PaperEffect variant="danger">
                                <PaperButton
                                    variant="danger"
                                    icon
                                    disabled={running() === 0}
                                    onClick={() => bridge.call(SERVICE_CALLS.stop, { project: props.projectId }).catch(fail("Stop didn't work"))}
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
            <RenameProjectModal project={renaming() ? props.project() : null} onRename={props.projects.rename} onClose={() => setRenaming(false)} />
            <DeleteProjectModal
                project={deleting() ? props.project() : null}
                onDelete={async (id) => {
                    await props.projects.remove(id);
                    props.onHome();
                }}
                onClose={() => setDeleting(false)}
            />
            <div class={styles.body}>
                <Show when={libraryShown()}>
                    <LibraryRail builtins={library.builtins} panels={library.panels()} selected={library.selected()} onSelect={library.choose} />
                </Show>
                <div class={styles.stage}>
                    <div ref={host} class={styles.canvas} />
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
                                onJump={jump}
                                onCollapse={() => setCollapsed(true)}
                                onCreateVariable={library.showsVariables() && ready() ? () => Blockly.Variables.createVariableButtonHandler(workspace!) : undefined}
                                headerRef={headerRef}
                            />
                        </Show>
                    </Show>
                    <div class={styles.topRight}>
                        <Show when={flows.loadError()}>
                            {(why) => (
                                <PaperQuote variant="danger" icon="warning" title="Your flows couldn't be loaded" role="alert">
                                    <PaperFlex direction="column" align="flex-start" gap="half">
                                        <span>Nothing here can be changed until they load: {why()}</span>
                                        <PaperButton variant="danger" onClick={() => void flows.load()}>
                                            Try again
                                        </PaperButton>
                                    </PaperFlex>
                                </PaperQuote>
                            )}
                        </Show>
                        <Show when={notice()}>
                            {(shown) => (
                                <PaperQuote
                                    variant={shown().kind === "failed" ? "danger" : "success"}
                                    icon={shown().kind === "failed" ? "warning" : "check_circle"}
                                    title={shown().title}
                                    role={shown().kind === "failed" ? "alert" : "status"}
                                    onDismiss={() => setNotice(null)}
                                >
                                    {shown().text}
                                </PaperQuote>
                            )}
                        </Show>
                        <Console entries={log()} onClear={() => bridge.call(SERVICE_CALLS.clearLog, { project: props.projectId }).catch(fail("The log wasn't cleared"))} />
                    </div>
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
            </div>
            <BlocklyDialogs />
        </PaperFlex>
    );
}
