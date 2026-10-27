// What a block on the canvas is given. Its fields reach the same picker and
// value callbacks, so they take these props as they are.
import type { ActionSchema } from "@mileniumhq/paperapi";
import type { CanvasBlock } from "../lib/tree";

export interface ActionBlockProps {
    id?: string;
    action: ActionSchema;
    isTrigger?: boolean;
    pos?: { x: number; y: number };
    zIndex?: number;
    values?: Record<string, any>;
    children?: CanvasBlock[];
    elseChildren?: CanvasBlock[];
    activeDropTarget?: { parentId: string; insertIndex: number } | null;
    onValueChange?: (blockId: string, key: string, value: any) => void;
    onMove?: (newPos: { x: number; y: number }, clientX?: number, clientY?: number) => void;
    onDragEnd?: () => void;
    onInteract?: () => void;
    onContextMenu?: (
        blockId: string,
        clientX: number,
        clientY: number,
        e: MouseEvent,
    ) => void;
    onStartDragChild?: (
        child: CanvasBlock,
        grabOffset: { x: number; y: number },
        e: PointerEvent,
    ) => void;
    onRequestVariablePicker?: (
        blockId: string,
        paramKey: string,
        x: number,
        y: number,
        onInsert: (varId: string, label: string, icon: string) => void,
        expectedType?: string,
        isArray?: boolean,
        anchor?: HTMLElement,
    ) => void;
    onRequestOptionPicker?: (
        blockId: string,
        paramKey: string,
        x: number,
        y: number,
        options: { label: string; value: any; icon?: string; description?: string }[],
        selectedValue: any,
        onSelect: (value: any) => void,
        anchor?: HTMLElement,
    ) => void;
    variableName?: string | null;
    activeTargetBlockId?: () => string | null;
    highlightedSourceBlockId?: () => string | null;
    isVariablePickerOpen?: () => boolean;
    iconSrc?: string;
    class?: string;
    static?: boolean;
    running?: boolean;
    runningBlockIds?: () => Set<string>;
}
