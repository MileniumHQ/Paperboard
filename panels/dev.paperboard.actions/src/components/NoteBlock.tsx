import { createSignal } from "solid-js";
import { PaperIcon, PaperButton, PaperText } from "@mileniumhq/paperui";

export interface CanvasNote {
    id: string;
    pos: { x: number; y: number };
    zIndex?: number;
    text: string;
}

export interface NoteBlockProps {
    id: string;
    pos: { x: number; y: number };
    zIndex?: number;
    text: string;
    onInteract?: () => void;
    onMove?: (newPos: { x: number; y: number }, clientX?: number, clientY?: number) => void;
    onDragEnd?: () => void;
    onChangeText?: (text: string) => void;
    onDelete?: () => void;
    onContextMenu?: (e: MouseEvent) => void;
}

export default function NoteBlock(props: NoteBlockProps) {
    const [isDragging, setIsDragging] = createSignal(false);
    let dragStart = { x: 0, y: 0 };
    let posStart = { x: 0, y: 0 };

    const handlePointerDown = (e: PointerEvent) => {
        props.onInteract?.();

        if (e.button === 2) {
            e.stopPropagation();
            return;
        }

        if (e.button !== 0 || !props.onMove) return;

        if (
            (e.target as HTMLElement).tagName === "TEXTAREA" ||
            (e.target as HTMLElement).closest("button")
        ) {
            return;
        }

        e.stopPropagation();
        setIsDragging(true);
        dragStart = { x: e.clientX, y: e.clientY };
        posStart = { x: props.pos.x, y: props.pos.y };

        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    };

    const handlePointerMove = (e: PointerEvent) => {
        if (!isDragging() || !props.onMove) return;
        e.stopPropagation();

        const dx = e.clientX - dragStart.x;
        const dy = e.clientY - dragStart.y;

        props.onMove(
            {
                x: Math.round(posStart.x + dx),
                y: Math.round(posStart.y + dy),
            },
            e.clientX,
            e.clientY,
        );
    };

    const handlePointerUp = (e: PointerEvent) => {
        if (isDragging()) {
            setIsDragging(false);
            try {
                (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
            } catch (err) {
                console.debug("[actions] pointer capture release failed:", String(err));
            }
            props.onDragEnd?.();
        }
    };

    return (
        <div
            class={`canvas-note ${isDragging() ? "dragging" : ""}`}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                props.onContextMenu?.(e);
            }}
            style={{
                transform: `translate3d(${props.pos.x}px, ${props.pos.y}px, 0)`,
                "z-index": props.zIndex !== undefined ? props.zIndex : "auto",
            }}
        >
            <div class="canvas-note-header">
                <div class="canvas-note-title">
                    <PaperIcon class="canvas-note-icon">edit_note</PaperIcon>
                    <PaperText size={2} weight={700}>
                        Note
                    </PaperText>
                </div>
                <PaperButton size="tiny"
                    icon
                    onClick={(e) => {
                        e.stopPropagation();
                        props.onDelete?.();
                    }}
                    title="Delete Note">
                    <PaperIcon>close</PaperIcon>
                </PaperButton>
            </div>
            <textarea
                class="canvas-note-textarea"
                placeholder="Write a note..."
                value={props.text}
                onInput={(e) => props.onChangeText?.(e.currentTarget.value)}
                onPointerDown={(e) => e.stopPropagation()}
            />
        </div>
    );
}
