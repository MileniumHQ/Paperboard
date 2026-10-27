// Pointer work on the canvas: panning the viewport, dragging blocks and
// notes, dragging new blocks in from the Library, dropping into a flow or
// the trash, and the background's context menu.
import { createSignal } from "solid-js";
import { useContextMenuState } from "@mileniumhq/paperui";
import type { ActionInfo } from "@mileniumhq/paperapi";
import {
    type CanvasBlock,
    removeBlock,
    insertBlock,
    findOwnerTrigger,
} from "../lib/tree";
import { functionIdFromCallAction, functionIdFromTriggerAction } from "../lib/functions";
import type { CanvasDocumentState } from "./document";

// a press on a nested action only becomes a drag after the pointer moves
// past this distance; below it the press is a plain click and the block
// must stay mounted where it is
const DRAG_START_THRESHOLD_PX = 4;
// drop zones and the trash catch a pointer this close to their edge
const DROP_SLOP_PX = 16;

export interface GhostDrag {
    id?: string;
    panelId: string;
    item: ActionInfo;
    isTrigger: boolean;
    iconSrc?: string;
    pos: { x: number; y: number };
    grabOffset: { x: number; y: number };
    values?: Record<string, any>;
    children?: CanvasBlock[];
    detachedFrom?: {
        originalParentId: string | null;
        originalIndex: number;
        block: CanvasBlock;
    };
}

interface PendingChildDrag {
    child: CanvasBlock;
    grabOffset: { x: number; y: number };
    startClient: { x: number; y: number };
    originalParentId: string | null;
    originalIndex: number;
}

export type DropTarget = { parentId: string; insertIndex: number };

const near = (rect: DOMRect, x: number, y: number) =>
    x >= rect.left - DROP_SLOP_PX &&
    x <= rect.right + DROP_SLOP_PX &&
    y >= rect.top - DROP_SLOP_PX &&
    y <= rect.bottom + DROP_SLOP_PX;

export function createCanvasInteraction(doc: CanvasDocumentState) {
    let viewport: HTMLDivElement | undefined;
    const [scroll, setScroll] = createSignal({ x: 0, y: 0 });
    const viewportScroll = () => ({ x: viewport ? viewport.scrollLeft : 0, y: viewport ? viewport.scrollTop : 0 });

    const [isPanning, setIsPanning] = createSignal(false);
    const [hoverDropTarget, setHoverDropTarget] = createSignal<DropTarget | null>(null);
    const [isOverTrash, setIsOverTrash] = createSignal(false);
    const [draggingCanvasBlockId, setDraggingCanvasBlockId] = createSignal<string | null>(null);
    const [ghostDrag, setGhostDrag] = createSignal<GhostDrag | null>(null);
    const [pendingChildDrag, setPendingChildDrag] = createSignal<PendingChildDrag | null>(null);

    const canvasMenu = useContextMenuState("mouse");
    const [canvasMenuPos, setCanvasMenuPos] = createSignal({ x: 0, y: 0 });

    let dragStart = { x: 0, y: 0 };
    let scrollStart = { x: 0, y: 0 };
    let rightClickDownPos = { x: 0, y: 0 };

    const libraryRect = () => document.querySelector(".library-sidebar")?.getBoundingClientRect();

    /** How much of the viewport's left edge the open Library covers. */
    const libraryInset = () => {
        const library = libraryRect();
        return library && viewport ? Math.max(0, Math.round(library.right - viewport.getBoundingClientRect().left)) : 0;
    };

    const toWorld = (clientX: number, clientY: number) => {
        const rect = viewport?.getBoundingClientRect();
        const sc = viewportScroll();
        return {
            x: Math.round(clientX - (rect ? rect.left : 0) + sc.x),
            y: Math.round(clientY - (rect ? rect.top : 0) + sc.y),
        };
    };

    const checkDropTarget = (clientX: number, clientY: number): DropTarget | null => {
        for (const zone of document.querySelectorAll<HTMLElement>("[data-drop-parent]")) {
            if (!near(zone.getBoundingClientRect(), clientX, clientY)) continue;
            const parentId = zone.getAttribute("data-drop-parent");
            const rawIdx = zone.getAttribute("data-drop-index");
            if (parentId !== null && rawIdx !== null) {
                return { parentId, insertIndex: parseInt(rawIdx, 10) };
            }
        }
        return null;
    };

    const checkTrashTarget = (clientX: number, clientY: number): boolean => {
        const trashEl = document.getElementById("canvas-trash-zone");
        return trashEl ? near(trashEl.getBoundingClientRect(), clientX, clientY) : false;
    };

    const isDropOnCanvas = (clientX: number): boolean => clientX > (libraryRect()?.right ?? 0);

    const isBackground = (target: EventTarget | null) =>
        target === viewport ||
        (target as HTMLElement).classList.contains("canvas-viewport") ||
        (target as HTMLElement).classList.contains("canvas-world");

    const onPointerDown = (e: PointerEvent) => {
        if (e.button === 1 || e.button === 2 || (e.button === 0 && isBackground(e.target))) {
            if (e.button === 2) {
                e.preventDefault();
                rightClickDownPos = { x: e.clientX, y: e.clientY };
            }
            setIsPanning(true);
            dragStart = { x: e.clientX, y: e.clientY };
            scrollStart = { ...viewportScroll() };

            if (viewport) {
                try {
                    viewport.setPointerCapture(e.pointerId);
                } catch (err) {
                    console.debug("[actions] pointer capture failed:", String(err));
                }
            }
        }
    };

    const beginChildDrag = (pending: PendingChildDrag, clientX: number, clientY: number) => {
        const { blocks: updated, removed } = removeBlock(doc.blocks, pending.child.id);
        if (!removed) return;
        doc.setBlocks(updated);
        setGhostDrag({
            id: removed.id,
            panelId: removed.panelId,
            item: {
                panelId: removed.panelId,
                action: (removed.action as any).id || "action",
                schema: removed.action,
            },
            isTrigger: removed.isTrigger,
            iconSrc: removed.iconSrc,
            pos: { x: clientX, y: clientY },
            grabOffset: pending.grabOffset,
            values: removed.values,
            children: removed.children,
            detachedFrom: {
                originalParentId: pending.originalParentId,
                originalIndex: pending.originalIndex,
                block: removed,
            },
        });
    };

    const onPointerMove = (e: PointerEvent) => {
        const pending = pendingChildDrag();
        if (pending && !ghostDrag()) {
            const distance = Math.hypot(e.clientX - pending.startClient.x, e.clientY - pending.startClient.y);
            if (distance >= DRAG_START_THRESHOLD_PX) {
                setPendingChildDrag(null);
                beginChildDrag(pending, e.clientX, e.clientY);
            }
            // a press that has not travelled yet is still a click: do not pan
            return;
        }

        const ghost = ghostDrag();
        if (ghost) {
            setGhostDrag({ ...ghost, pos: { x: e.clientX, y: e.clientY } });
            const overTrash = checkTrashTarget(e.clientX, e.clientY);
            setIsOverTrash(overTrash);
            setHoverDropTarget(!overTrash && !ghost.isTrigger ? checkDropTarget(e.clientX, e.clientY) : null);
            return;
        }

        if (draggingCanvasBlockId()) {
            setIsOverTrash(checkTrashTarget(e.clientX, e.clientY));
        }

        if (!isPanning()) return;
        if (viewport) {
            viewport.scrollLeft = Math.round(scrollStart.x - (e.clientX - dragStart.x));
            viewport.scrollTop = Math.round(scrollStart.y - (e.clientY - dragStart.y));
        }
    };

    const dropGhost = (drag: GhostDrag, dropTarget: DropTarget | null, overTrash: boolean, clientX: number, clientY: number) => {
        if (overTrash) {
            doc.save();
            return;
        }

        const actionId =
            (drag.item as any)?.action ||
            (drag.item as any)?.trigger ||
            (drag.item as any)?.schema?.id ||
            (drag as any).action?.id;
        const isContainer = actionId === "repeat" || actionId === "if" || actionId === "if-else";

        const droppedBlock: CanvasBlock = {
            id: drag.id || `block_${Date.now()}`,
            panelId: drag.panelId,
            pos: { x: 0, y: 0 },
            isTrigger: drag.isTrigger,
            zIndex: doc.nextZ(),
            action: drag.item
                ? (drag.item.schema || {
                      id: actionId || "action",
                      name: actionId || "action",
                      description: "",
                  })
                : (drag as any).action,
            iconSrc: drag.iconSrc,
            values: drag.values || {},
            children: drag.children || (drag.isTrigger || isContainer ? [] : undefined),
            elseChildren: (drag as any).elseChildren || (actionId === "if-else" ? [] : undefined),
        };

        if (dropTarget && !drag.isTrigger) {
            // reject self-calls
            const droppedFid = functionIdFromCallAction(actionId || "");
            if (droppedFid) {
                const owner = findOwnerTrigger(doc.blocks, dropTarget.parentId.replace(/:else$/, ""));
                const ownerFid = owner ? functionIdFromTriggerAction((owner.action as any)?.id || "") : null;
                if (ownerFid && ownerFid === droppedFid) {
                    console.warn(`[Actions] A function cannot call itself; "${droppedBlock.action.name}" was not added.`);
                    return;
                }
            }
            const updated = insertBlock(doc.blocks, dropTarget.parentId, dropTarget.insertIndex, droppedBlock);
            doc.setBlocks(updated);
            doc.save(updated);
            return;
        }

        if (isDropOnCanvas(clientX)) {
            droppedBlock.pos = toWorld(clientX - drag.grabOffset.x, clientY - drag.grabOffset.y);
            const updated = insertBlock(doc.blocks, null, doc.blocks.length, droppedBlock);
            doc.setBlocks(updated);
            doc.save(updated);
            return;
        }

        if (drag.detachedFrom) {
            const restored = insertBlock(
                doc.blocks,
                drag.detachedFrom.originalParentId,
                drag.detachedFrom.originalIndex,
                drag.detachedFrom.block,
            );
            doc.setBlocks(restored);
            doc.save(restored);
        }
    };

    const onPointerUp = (e: PointerEvent) => {
        // a press that never crossed the drag threshold was a click; the
        // block was never removed, so there is nothing to restore
        if (pendingChildDrag()) {
            setPendingChildDrag(null);
            return;
        }
        const dropTarget = hoverDropTarget();
        setHoverDropTarget(null);
        const overTrash = isOverTrash();
        setIsOverTrash(false);

        const drag = ghostDrag();
        if (drag) {
            setGhostDrag(null);
            dropGhost(drag, dropTarget, overTrash, e.clientX, e.clientY);
            return;
        }

        if (isPanning()) {
            setIsPanning(false);
            if (viewport && viewport.hasPointerCapture(e.pointerId)) {
                viewport.releasePointerCapture(e.pointerId);
            }
        }
    };

    const onContextMenu = (e: MouseEvent) => {
        e.preventDefault();
        if (isBackground(e.target) && isDropOnCanvas(e.clientX)) {
            const dist = Math.hypot(e.clientX - rightClickDownPos.x, e.clientY - rightClickDownPos.y);
            if (dist < 6) {
                setCanvasMenuPos({ x: e.clientX, y: e.clientY });
                canvasMenu.openAtCursor(e);
            }
        }
    };

    const addNoteAtMenu = () => {
        const pos = canvasMenuPos();
        doc.addNote(toWorld(pos.x, pos.y));
    };

    const moveNote = (id: string, newPos: { x: number; y: number }, clientX?: number, clientY?: number) => {
        setDraggingCanvasBlockId(id);
        doc.setNotes((n) => n.id === id, "pos", newPos);
        setIsOverTrash(clientX !== undefined && clientY !== undefined ? checkTrashTarget(clientX, clientY) : false);
    };

    const endNoteDrag = (id: string) => {
        const overTrash = isOverTrash();
        setIsOverTrash(false);
        setDraggingCanvasBlockId(null);
        if (overTrash) {
            doc.deleteNote(id);
            return;
        }
        doc.save();
    };

    const moveTopBlock = (id: string, newPos: { x: number; y: number }, clientX?: number, clientY?: number) => {
        setDraggingCanvasBlockId(id);
        doc.setBlocks((b) => b.id === id, "pos", newPos);

        if (clientX !== undefined && clientY !== undefined) {
            const overTrash = checkTrashTarget(clientX, clientY);
            setIsOverTrash(overTrash);
            const currentBlock = doc.blocks.find((b) => b.id === id);
            if (!overTrash && currentBlock && !currentBlock.isTrigger) {
                const target = checkDropTarget(clientX, clientY);
                setHoverDropTarget(target?.parentId !== id ? target : null);
            } else {
                setHoverDropTarget(null);
            }
        } else {
            setHoverDropTarget(null);
            setIsOverTrash(false);
        }
    };

    const endTopBlockDrag = (id: string) => {
        const dropTarget = hoverDropTarget();
        const overTrash = isOverTrash();
        setHoverDropTarget(null);
        setIsOverTrash(false);
        setDraggingCanvasBlockId(null);

        if (overTrash) {
            doc.deleteBlock(id);
            return;
        }

        if (dropTarget && dropTarget.parentId !== id) {
            const blockToInsert = doc.blocks.find((b) => b.id === id);
            if (blockToInsert && !blockToInsert.isTrigger) {
                const { blocks: updated, removed } = removeBlock(doc.blocks, id);
                if (removed) {
                    const finalTree = insertBlock(updated, dropTarget.parentId, dropTarget.insertIndex, removed);
                    doc.setBlocks(finalTree);
                    doc.save(finalTree);
                    return;
                }
            }
        }

        doc.save();
    };

    const startLibraryDrag = (
        item: ActionInfo,
        isTrigger: boolean,
        screenPos: { x: number; y: number },
        grabOffset: { x: number; y: number },
        iconSrc?: string,
    ) => {
        setGhostDrag({ item, panelId: item.panelId, isTrigger, iconSrc, pos: screenPos, grabOffset });
    };

    const startChildDrag = (child: CanvasBlock, grabOffset: { x: number; y: number }, e: PointerEvent) => {
        let originalParentId: string | null = null;
        let originalIndex = 0;
        for (const b of doc.blocks) {
            if (b.children) {
                const idx = b.children.findIndex((c) => c.id === child.id);
                if (idx >= 0) {
                    originalParentId = b.id;
                    originalIndex = idx;
                    break;
                }
            }
        }
        setPendingChildDrag({
            child,
            grabOffset,
            startClient: { x: e.clientX, y: e.clientY },
            originalParentId,
            originalIndex,
        });
    };

    return {
        setViewport: (el: HTMLDivElement) => { viewport = el; },
        scrollTo: (target: ScrollToOptions) => viewport?.scrollTo(target),
        libraryInset,
        scroll,
        onScroll: (el: HTMLDivElement) => setScroll({ x: el.scrollLeft, y: el.scrollTop }),
        isPanning,
        hoverDropTarget,
        isOverTrash,
        dragging: () => ghostDrag() !== null || draggingCanvasBlockId() !== null,
        ghostDrag,
        canvasMenu,
        addNoteAtMenu,
        onPointerDown,
        onPointerMove,
        onPointerUp,
        onContextMenu,
        moveNote,
        endNoteDrag,
        moveTopBlock,
        endTopBlockDrag,
        startLibraryDrag,
        startChildDrag,
    };
}
