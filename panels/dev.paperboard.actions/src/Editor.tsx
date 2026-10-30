// The Actions editor for one project: a top bar with its name, menus and
// Play, then the Library and the canvas of flows and notes. The document,
// runs, pickers and pointer work each live in src/canvas; this puts them on
// screen.
import { createMemo, createSignal, For, Show } from "solid-js";
import {
    PaperContextMenu,
    PaperContextMenuItem,
    useContextMenuState,
    PaperIcon,
    PaperButton,
    PaperEffect,
    PaperEmptyState,
    PaperFlex,
    PaperLoader,
    PaperMenuBar,
    PaperMenuBarMenu,
    PaperSeparator,
    PaperText,
    PaperToggle,
} from "@mileniumhq/paperui";
import ActionBlock from "./components/ActionBlock";
import NoteBlock from "./components/NoteBlock";
import ActionLibrary from "./components/ActionLibrary";
import VariableMenu from "./components/VariableMenu";
import ActionDropdownMenu from "./components/ActionDropdownMenu";
import { createCanvasFileActions, type CanvasNotice } from "./canvas/fileActions";
import { revealScroll, REVEAL_MARGIN } from "./lib/flowFile";
import type { CanvasDocument } from "./lib/canvasDoc";
import { blockVariableName, canvasWorldSize, findBlock } from "./lib/tree";
import { createCanvasDocument } from "./canvas/document";
import { blockIconSrc } from "./lib/blockIcon";
import { createFlowRuns } from "./canvas/runs";
import { createPickers } from "./canvas/pickers";
import { createCanvasInteraction } from "./canvas/interaction";
import ConsolePanel, { createConsoleLog } from "./canvas/Console";
import BlockMenu from "./canvas/BlockMenu";
import Notices from "./canvas/Notices";
import GhostBlock from "./canvas/GhostBlock";
import { DeleteProjectModal, RenameProjectModal } from "./projects/ProjectDialogs";
import type { ProjectsState } from "./projects/state";
import type { ProjectSummary } from "./service";

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export default function Editor(props: {
    projectId: string;
    project: () => ProjectSummary;
    projects: ProjectsState;
    onHome: () => void;
    onOpen: (project: ProjectSummary) => void;
}) {
    const doc = createCanvasDocument(props.projectId);
    const log = createConsoleLog();
    const runs = createFlowRuns(doc, log);
    const pickers = createPickers(doc, doc.setValue);
    const canvas = createCanvasInteraction(doc);

    const blockMenu = useContextMenuState("mouse");
    const [menuBlockId, setMenuBlockId] = createSignal<string | null>(null);
    const [fileNotice, setFileNotice] = createSignal<CanvasNotice | null>(null);

    const worldSize = createMemo(() => canvasWorldSize(doc.blocks, doc.notes));

    // an imported file lands below everything, often off screen: scroll to it
    const addFile = (file: CanvasDocument) => {
        const covered = canvas.libraryInset();
        const added = doc.addFile(file, covered ? covered + REVEAL_MARGIN : 0);
        const target = revealScroll(added, covered);
        if (target) canvas.scrollTo(target);
    };

    const runFromMenu = (blockId: string, payload: any) => {
        const block = findBlock(doc.blocks, blockId);
        if (block) void runs.testRun(block, payload);
    };

    const file = createCanvasFileActions({
        clientId: doc.clientId,
        name: () => props.project().name,
        loaded: doc.loaded,
        canvas: doc.snapshot,
        add: addFile,
        flush: doc.flush,
        reload: doc.reload,
        onNotice: setFileNotice,
    });

    // the project changes the menus make, each reporting what failed
    const [working, setWorking] = createSignal(false);
    const change = async (failed: string, work: () => Promise<void>) => {
        if (working()) return;
        setWorking(true);
        try {
            await work();
        } catch (err) {
            setFileNotice({ kind: "failed", title: failed, text: message(err) });
        } finally {
            setWorking(false);
        }
    };
    const newProject = () => change("Project not made", async () => props.onOpen(await props.projects.create()));
    const copyProject = () => change("Project not copied", async () => {
        // the copy is of what was saved, so the latest edits go first
        const saved = await doc.flush();
        if (!saved.ok) throw new Error(`Your latest changes are not saved, so the copy would miss them: ${saved.message}`);
        props.onOpen(await props.projects.duplicate(props.projectId));
    });
    const setEnabled = (enabled: boolean) => change(enabled ? "Flows not turned on" : "Flows not turned off", async () => {
        await props.projects.setEnabled(props.projectId, enabled);
    });
    const addNote = () => {
        try {
            canvas.addNoteInView();
        } catch (err) {
            setFileNotice({ kind: "failed", title: "Note not added", text: message(err) });
        }
    };

    const [renaming, setRenaming] = createSignal(false);
    const [deleting, setDeleting] = createSignal(false);

    return (
        <div class="paperui-root actions-editor">
        <div class="editor-topbar">
            <PaperFlex direction="row" align="center" gap="half" paddingX="half" background="surface" fullWidth fullHeight>
                <PaperButton icon variant="text" title="All projects" aria-label="All projects" onClick={props.onHome}>
                    <PaperIcon>arrow_back</PaperIcon>
                </PaperButton>
                <PaperFlex direction="column" align="flex-start" gap="none">
                    <PaperButton variant="text" size="small" title="Rename" onClick={() => setRenaming(true)}>
                        <PaperText preset="subheader">{props.project().name}</PaperText>
                    </PaperButton>
                    <PaperMenuBar aria-label={props.project().name}>
                        <PaperMenuBarMenu label="File">
                            <PaperContextMenuItem icon="add" disabled={working()} onClick={() => void newProject()}>New project</PaperContextMenuItem>
                            <PaperContextMenuItem icon="file_copy" disabled={working() || !doc.loaded()} onClick={() => void copyProject()}>Make a copy</PaperContextMenuItem>
                            <PaperContextMenuItem icon="edit" onClick={() => setRenaming(true)}>Rename</PaperContextMenuItem>
                            <PaperSeparator role="separator" />
                            <PaperContextMenuItem icon="file_export" disabled={file.busy() || !doc.loaded()} onClick={() => void file.exportFlows()}>Export</PaperContextMenuItem>
                            <PaperContextMenuItem icon="file_open" disabled={file.busy() || !doc.loaded()} onClick={() => void file.importFlows()}>Import</PaperContextMenuItem>
                            <PaperSeparator role="separator" />
                            <PaperContextMenuItem icon="backup" disabled={file.busy()} onClick={() => void file.createBackup()}>Create backup</PaperContextMenuItem>
                            <PaperContextMenuItem icon="settings_backup_restore" disabled={file.busy()} onClick={() => void file.openLoad()}>Load backup</PaperContextMenuItem>
                            <PaperSeparator role="separator" />
                            <PaperContextMenuItem icon="delete" danger onClick={() => setDeleting(true)}>Delete</PaperContextMenuItem>
                        </PaperMenuBarMenu>
                        <PaperMenuBarMenu label="Insert">
                            <PaperContextMenuItem icon="note_add" disabled={!doc.loaded()} onClick={addNote}>Note</PaperContextMenuItem>
                        </PaperMenuBarMenu>
                    </PaperMenuBar>
                </PaperFlex>
                <PaperFlex direction="row" align="center" justify="flex-end" gap="half" fullWidth>
                    <PaperText size={2} color="text-subtle">{props.project().enabled ? "Flows on" : "Flows off"}</PaperText>
                    <PaperToggle
                        checked={props.project().enabled}
                        disabled={working()}
                        aria-label="Flows start on their events"
                        title="When off, this project's flows don't start on their events"
                        onChange={(enabled) => void setEnabled(enabled)}
                    />
                    <PaperEffect variant="success">
                        <PaperButton
                            variant="success"
                            icon
                            disabled={!doc.loaded()}
                            onClick={runs.playAll}
                            title="Run On-Play Flows"
                            aria-label="Run On-Play Flows">
                            <PaperIcon>play_arrow</PaperIcon>
                        </PaperButton>
                    </PaperEffect>
                </PaperFlex>
            </PaperFlex>
        </div>
        <file.LoadBackupModal />
        <RenameProjectModal
            project={renaming() ? props.project() : null}
            onRename={props.projects.rename}
            onClose={() => setRenaming(false)}
        />
        <DeleteProjectModal
            project={deleting() ? props.project() : null}
            onDelete={async (id) => {
                await props.projects.remove(id);
                props.onHome();
            }}
            onClose={() => setDeleting(false)}
        />
        <Show when={doc.loaded()} fallback={
            <PaperFlex fullWidth fullHeight align="center" justify="center">
                <Show when={doc.loadError()} fallback={<PaperLoader loaderStatus="indeterminate" label="Loading canvas" />}>
                    {(reason) => (
                        <PaperEmptyState icon="error" title="Canvas could not be loaded" description={reason()} role="alert">
                            <PaperButton onClick={() => { void doc.load(); }}>Retry loading canvas</PaperButton>
                        </PaperEmptyState>
                    )}
                </Show>
            </PaperFlex>
        }>
        <div
            ref={canvas.setViewport}
            class={`unselectable canvas-viewport ${canvas.isPanning() ? "panning" : ""}`}
            onPointerDown={canvas.onPointerDown}
            onPointerMove={canvas.onPointerMove}
            onPointerUp={canvas.onPointerUp}
            onPointerCancel={canvas.onPointerUp}
            onContextMenu={canvas.onContextMenu}
            onScroll={(e) => canvas.onScroll(e.currentTarget)}
            style={{
                "background-position": `${-canvas.scroll().x}px ${-canvas.scroll().y}px`,
            }}
        >
            <ActionLibrary
                onStartDrag={canvas.startLibraryDrag}
                functions={doc.functions()}
                onCreateFunction={doc.createFunction}
                onRenameFunction={doc.renameFunction}
                onDeleteFunction={doc.deleteFunction}
            />

            <div class="canvas-top-right-controls">
                <Notices
                    doc={doc}
                    dropRefusal={canvas.dropRefusal()}
                    onDismissDrop={canvas.dismissDropRefusal}
                    fileNotice={fileNotice()}
                    onDismissFile={() => setFileNotice(null)}
                />
                <ConsolePanel log={log} />
            </div>

            <div
                class="canvas-world"
                style={{
                    width: `${worldSize().w}px`,
                    height: `${worldSize().h}px`,
                }}
            >
                <For each={doc.blocks}>
                    {(block) => (
                        <ActionBlock
                            id={block.id}
                            action={block.action}
                            isTrigger={block.isTrigger}
                            pos={block.pos}
                            zIndex={block.zIndex}
                            values={block.values}
                            children={block.children}
                            elseChildren={block.elseChildren}
                            activeDropTarget={canvas.hoverDropTarget()}
                            iconSrc={blockIconSrc(block)}
                            runningBlockIds={runs.runningBlockIds}
                            variableName={blockVariableName(block)}
                            onInteract={() => doc.bringToFront(block.id)}
                            onContextMenu={(bId, _cx, _cy, e) => {
                                setMenuBlockId(bId);
                                blockMenu.openAtCursor(e);
                            }}
                            onMove={(newPos, clientX, clientY) =>
                                canvas.moveTopBlock(block.id, newPos, clientX, clientY)
                            }
                            onDragEnd={() => canvas.endTopBlockDrag(block.id)}
                            onStartDragChild={canvas.startChildDrag}
                            onValueChange={doc.setValue}
                            onRequestVariablePicker={pickers.openVariablePicker}
                            onRequestOptionPicker={pickers.openOptionPicker}
                            highlightedSourceBlockId={pickers.hoveredSourceBlockId}
                        />
                    )}
                </For>

                <For each={doc.notes}>
                    {(note) => (
                        <NoteBlock
                            id={note.id}
                            pos={note.pos}
                            zIndex={note.zIndex}
                            text={note.text}
                            onInteract={() => doc.bringNoteToFront(note.id)}
                            onMove={(newPos, cx, cy) => canvas.moveNote(note.id, newPos, cx, cy)}
                            onDragEnd={() => canvas.endNoteDrag(note.id)}
                            onChangeText={(txt) => doc.setNoteText(note.id, txt)}
                            onDelete={() => doc.deleteNote(note.id)}
                        />
                    )}
                </For>
            </div>

            <Show when={canvas.ghostDrag()}>
                {(drag) => <GhostBlock drag={drag()} />}
            </Show>

            <div
                id="canvas-trash-zone"
                class={`trash-zone ${canvas.dragging() ? "is-dragging" : ""} ${canvas.isOverTrash() ? "active-hover" : ""}`}
                title="Drop block here to delete"
            >
                <PaperIcon>{canvas.isOverTrash() ? "delete_forever" : "delete"}</PaperIcon>
            </div>

            <VariableMenu
                open={pickers.variablePicker().open}
                x={pickers.variablePicker().x}
                y={pickers.variablePicker().y}
                items={pickers.variablePicker().availableVariables}
                anchor={pickers.variablePicker().anchor}
                onSelect={pickers.selectVariable}
                onClose={pickers.closeVariablePicker}
                onHoverItem={(sourceId) => pickers.setHoveredSourceBlockId(sourceId)}
            />

            <ActionDropdownMenu
                open={pickers.optionPicker().open}
                x={pickers.optionPicker().x}
                y={pickers.optionPicker().y}
                items={pickers.optionPicker().options}
                selectedValue={pickers.optionPicker().selectedValue}
                onSelect={pickers.selectOption}
                onClose={pickers.closeOptionPicker}
            />

            <BlockMenu doc={doc} menu={blockMenu} blockId={menuBlockId()} onRun={runFromMenu} />

            <PaperContextMenu
                open={canvas.canvasMenu.isOpen()}
                target={canvas.canvasMenu.target()}
                placement={canvas.canvasMenu.placement()}
                onClose={canvas.canvasMenu.close}
            >
                <PaperContextMenuItem
                    icon="note_add"
                    onClick={() => {
                        canvas.canvasMenu.close();
                        canvas.addNoteAtMenu();
                    }}
                >
                    Add Note
                </PaperContextMenuItem>
            </PaperContextMenu>
        </div>
        </Show>
        </div>
    );
}
