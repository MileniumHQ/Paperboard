// The Actions editor: the Library, the canvas of flows and notes, and the
// controls over it. The document, runs, pickers and pointer work each live
// in src/canvas; this puts them on screen.
// PaperUI's rules load before every panel stylesheet the components below
// import, so the panel's own rules win where they meet
import "@mileniumhq/paperui/style.css";
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
} from "@mileniumhq/paperui";
import ActionBlock from "./components/ActionBlock";
import NoteBlock from "./components/NoteBlock";
import ActionLibrary from "./components/ActionLibrary";
import VariableMenu from "./components/VariableMenu";
import ActionDropdownMenu from "./components/ActionDropdownMenu";
import CanvasFileMenu, { type CanvasNotice } from "./components/CanvasFileMenu";
import { revealScroll, REVEAL_MARGIN } from "./lib/flowFile";
import type { CanvasDocument } from "./lib/canvasDoc";
import { blockVariableName, canvasWorldSize, findBlock } from "./lib/tree";
import { createCanvasDocument } from "./canvas/document";
import { createFlowRuns } from "./canvas/runs";
import { createPickers } from "./canvas/pickers";
import { createCanvasInteraction } from "./canvas/interaction";
import ConsolePanel, { createConsoleLog } from "./canvas/Console";
import BlockMenu from "./canvas/BlockMenu";
import Notices from "./canvas/Notices";
import GhostBlock from "./canvas/GhostBlock";
// the canvas shell loads last: the dragged ghost's rules beat the block's
import "./style.css";

export default function App() {
    const doc = createCanvasDocument();
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

    return (
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
            class={`paperui-root unselectable canvas-viewport ${canvas.isPanning() ? "panning" : ""}`}
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
                <Notices doc={doc} fileNotice={fileNotice()} onDismissFile={() => setFileNotice(null)} />
                <div class="canvas-run-controls">
                    <CanvasFileMenu
                        clientId={doc.clientId}
                        loaded={doc.loaded}
                        canvas={doc.snapshot}
                        add={addFile}
                        flush={doc.flush}
                        reload={doc.reload}
                        onNotice={setFileNotice}
                    />
                    <PaperEffect variant="success">
                        <PaperButton
                            variant="success"
                            icon
                            onClick={runs.playAll}
                            title="Run On-Play Flows">
                            <PaperIcon>play_arrow</PaperIcon>
                        </PaperButton>
                    </PaperEffect>
                </div>

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
                            iconSrc={block.iconSrc}
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
    );
}
