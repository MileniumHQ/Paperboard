import styles from "./index.module.css";
import {
    createContext,
    useContext,
    createSignal,
    splitProps,
    Show,
    type ParentProps,
    type JSX,
} from "solid-js";
import { PaperButton } from "../PaperButton";
import { PaperIcon } from "../PaperIcon";
import { PaperText } from "../PaperText";
import {
    SelectionProvider,
    SelectionRadioInput,
    useSelectionItem,
    type SelectionProviderProps,
} from "../contexts/selection";

export interface PaperListItemCloseEvent {
    value: string | number;
    nativeEvent: MouseEvent;
    preventDefault: () => void;
    defaultPrevented: boolean;
}

export type PaperListProps = SelectionProviderProps &
    JSX.HTMLAttributes<HTMLDivElement> & {
        direction?: "horizontal" | "vertical";
        horizontal?: boolean;
        reorderable?: boolean;
        onReorder?: (newOrderValues: (string | number)[]) => void;
        onBeforeItemClose?: (
            event: PaperListItemCloseEvent,
        ) => boolean | Promise<boolean> | void;
        onItemClose?: (event: PaperListItemCloseEvent) => void;
        onItemClosed?: (value: string | number) => void;
        borderless?: boolean;
        fullWidth?: boolean;
        fullHeight?: boolean;
        flex?: boolean | number | JSX.CSSProperties["flex"];
        scrollable?: boolean | "x" | "y";
    };

interface DragState {
    value: string;
    startIndex: number;
    targetIndex: number;
    startCoord: number;
    currentCoord: number;
    itemSize: number;
    gap: number;
    currentValues: string[];
}

interface PaperListContextType {
    isReorderable: () => boolean;
    hasActiveDrag: () => boolean;
    isDropping: () => boolean;
    isItemDragging: (value: string | number) => boolean;
    handlePointerDown: (value: string | number, e: PointerEvent) => void;
    getItemStyle: (value: string | number) => JSX.CSSProperties;
    containerRef: () => HTMLDivElement | undefined;
    onBeforeItemClose?: (
        event: PaperListItemCloseEvent,
    ) => boolean | Promise<boolean> | void;
    onItemClose?: (event: PaperListItemCloseEvent) => void;
    onItemClosed?: (value: string | number) => void;
}

const PaperListContext = createContext<PaperListContextType>();

export function usePaperListContext() {
    return useContext(PaperListContext);
}

export function PaperList(props: ParentProps<PaperListProps>) {
    let containerRef: HTMLDivElement | undefined;
    let justFinishedDrag = false;

    const [local, rest] = splitProps(props, [
        "name",
        "value",
        "defaultValue",
        "onValueChange",
        "direction",
        "horizontal",
        "reorderable",
        "onReorder",
        "onBeforeItemClose",
        "onItemClose",
        "onItemClosed",
        "borderless",
        "fullWidth",
        "fullHeight",
        "flex",
        "scrollable",
        "class",
        "classList",
        "style",
        "children",
    ]);

    const isHorizontal = () =>
        local.direction === "horizontal" || Boolean(local.horizontal);
    const isReorderable = () => local.reorderable ?? false;

    const [dragState, setDragState] = createSignal<DragState | null>(null);
    const [isDropping, setIsDropping] = createSignal(false);

    const handlePointerDown = (value: string | number, e: PointerEvent) => {
        if (!isReorderable() || e.button !== 0 || !containerRef) return;

        const valStr = String(value);
        const itemEls = Array.from(
            containerRef.querySelectorAll<HTMLLabelElement>(
                ":scope > label[data-value]",
            ),
        );
        const currentValues = itemEls.map(
            (el) => el.getAttribute("data-value") ?? "",
        );

        const startIndex = currentValues.indexOf(valStr);
        if (startIndex < 0) return;

        const horiz = isHorizontal();
        const startEl = itemEls[startIndex];
        const rect = startEl.getBoundingClientRect();

        const itemSize = horiz ? rect.width : rect.height;
        let gap = 0;
        if (itemEls.length > 1) {
            const nextIdx =
                startIndex === itemEls.length - 1
                    ? startIndex - 1
                    : startIndex + 1;
            const nextRect = itemEls[nextIdx].getBoundingClientRect();
            const diff = horiz
                ? Math.abs(nextRect.left - rect.left)
                : Math.abs(nextRect.top - rect.top);
            gap = Math.max(0, diff - itemSize);
        }

        const startCoord = horiz ? e.clientX : e.clientY;
        let didDrag = false;
        const targetEl = e.currentTarget as HTMLElement;
        try {
            targetEl.setPointerCapture(e.pointerId);
        } catch (err) {
            console.debug("[PaperList] pointer capture failed:", err);
        }

        const handlePointerMove = (ev: PointerEvent) => {
            const currentCoord = horiz ? ev.clientX : ev.clientY;
            const delta = currentCoord - startCoord;

            if (!didDrag && Math.abs(delta) < 6) {
                return;
            }

            didDrag = true;

            const stepSize = itemSize + gap;
            const steps = stepSize > 0 ? Math.round(delta / stepSize) : 0;
            const targetIndex = Math.max(
                0,
                Math.min(itemEls.length - 1, startIndex + steps),
            );

            setDragState({
                value: valStr,
                startIndex,
                targetIndex,
                startCoord,
                currentCoord,
                itemSize,
                gap,
                currentValues,
            });
        };

        const handlePointerUp = (ev: PointerEvent) => {
            try {
                targetEl.releasePointerCapture(ev.pointerId);
            } catch (err) {
                console.debug("[PaperList] pointer capture release failed:", err);
            }

            window.removeEventListener("pointermove", handlePointerMove);
            window.removeEventListener("pointerup", handlePointerUp);
            window.removeEventListener("pointercancel", handlePointerUp);

            const state = dragState();
            if (state) {
                if (didDrag) {
                    justFinishedDrag = true;
                    setTimeout(() => {
                        justFinishedDrag = false;
                    }, 50);
                }

                if (
                    didDrag &&
                    state.startIndex !== state.targetIndex &&
                    local.onReorder
                ) {
                    setIsDropping(true);
                    const newOrder = [...state.currentValues];
                    const [moved] = newOrder.splice(state.startIndex, 1);
                    newOrder.splice(state.targetIndex, 0, moved);
                    local.onReorder(newOrder);
                    setDragState(null);
                    setTimeout(() => setIsDropping(false), 50);
                } else {
                    setDragState(null);
                }
            }
        };

        window.addEventListener("pointermove", handlePointerMove);
        window.addEventListener("pointerup", handlePointerUp);
        window.addEventListener("pointercancel", handlePointerUp);
    };

    const getItemStyle = (value: string | number): JSX.CSSProperties => {
        const ds = dragState();
        if (!ds) return {};

        const valStr = String(value);
        const horiz = isHorizontal();
        const itemIdx = ds.currentValues.indexOf(valStr);
        if (itemIdx < 0) return {};

        if (valStr === ds.value) {
            const delta = ds.currentCoord - ds.startCoord;
            return {
                transform: horiz
                    ? `translate3d(${delta}px, 0, 0)`
                    : `translate3d(0, ${delta}px, 0)`,
            };
        }

        const stepSize = ds.itemSize + ds.gap;
        let shift = 0;

        if (
            ds.startIndex < ds.targetIndex &&
            itemIdx > ds.startIndex &&
            itemIdx <= ds.targetIndex
        ) {
            shift = -stepSize;
        } else if (
            ds.startIndex > ds.targetIndex &&
            itemIdx >= ds.targetIndex &&
            itemIdx < ds.startIndex
        ) {
            shift = stepSize;
        }

        return shift
            ? {
                  transform: horiz
                      ? `translate3d(${shift}px, 0, 0)`
                      : `translate3d(0, ${shift}px, 0)`,
              }
            : {};
    };

    const isItemDragging = (value: string | number) =>
        dragState()?.value === String(value);
    const hasActiveDrag = () => dragState() !== null;

    const handleContainerClickCapture = (e: MouseEvent) => {
        if (justFinishedDrag) {
            e.preventDefault();
            e.stopPropagation();
            justFinishedDrag = false;
        }
    };

    const contextValue: PaperListContextType = {
        isReorderable,
        hasActiveDrag,
        isDropping,
        isItemDragging,
        handlePointerDown,
        getItemStyle,
        containerRef: () => containerRef,
        onBeforeItemClose: local.onBeforeItemClose,
        onItemClose: local.onItemClose,
        onItemClosed: local.onItemClosed,
    };

    const className = () =>
        [
            styles.PaperList,
            isHorizontal() ? styles.horizontal : "",
            isReorderable() ? styles.reorderable : "",
            local.borderless ? styles.borderless : "",
            local.fullWidth ? styles.fullWidth : "",
            local.fullHeight ? styles.fullHeight : "",
            local.scrollable ? styles.scrollable : "",
            local.class,
        ]
            .filter(Boolean)
            .join(" ");

    const dynamicStyle = () => {
        const extra: JSX.CSSProperties = {};
        if (local.flex !== undefined) {
            extra.flex =
                local.flex === true
                    ? "1 1 0%"
                    : local.flex === false
                      ? "none"
                      : typeof local.flex === "number"
                        ? `${local.flex} ${local.flex} 0%`
                        : local.flex;
        }
        if (local.fullWidth) extra.width = "100%";
        if (local.fullHeight) extra.height = "100%";
        if (local.scrollable) {
            extra.overflow = typeof local.scrollable === "string" ? (local.scrollable === "x" ? "hidden auto" : "auto hidden") : "auto";
        }
        return {
            ...extra,
            ...(typeof local.style === "object" ? local.style : {}),
        };
    };

    return (
        <SelectionProvider
            name={local.name}
            value={local.value}
            defaultValue={local.defaultValue}
            onValueChange={local.onValueChange}
        >
            <PaperListContext.Provider value={contextValue}>
                <div
                    ref={containerRef}
                    onClick={handleContainerClickCapture}
                    {...rest}
                    class={className()}
                    classList={local.classList}
                    style={dynamicStyle()}
                >
                    {local.children}
                </div>
            </PaperListContext.Provider>
        </SelectionProvider>
    );
}

export interface PaperListItemProps extends Omit<
    JSX.HTMLAttributes<HTMLLabelElement>,
    "onClose"
> {
    value: string | number;
    description?: JSX.Element | string;
    icon?: JSX.Element | string;
    disabled?: boolean;
    closeable?: boolean;
    onBeforeClose?: (
        event: PaperListItemCloseEvent,
    ) => boolean | Promise<boolean> | void;
    onClose?: (event: PaperListItemCloseEvent) => void;
    onClosed?: (value: string | number) => void;
}

export function PaperListItem(props: ParentProps<PaperListItemProps>) {
    const [local, rest] = splitProps(props, [
        "value",
        "description",
        "icon",
        "disabled",
        "closeable",
        "onBeforeClose",
        "onClose",
        "onClosed",
        "class",
        "classList",
        "style",
        "children",
    ]);

    const { isSelected } = useSelectionItem(local.value, local.disabled);
    const listCtx = usePaperListContext();
    const isDragging = () => listCtx?.isItemDragging(local.value) ?? false;

    const isCloseable = () =>
        Boolean(
            local.closeable ||
            local.onClose ||
            local.onBeforeClose ||
            local.onClosed ||
            listCtx?.onItemClose ||
            listCtx?.onBeforeItemClose ||
            listCtx?.onItemClosed,
        );

    const className = () =>
        [
            styles.PaperListItem,
            isSelected() ? styles.selected : "",
            isDragging() ? styles.dragging : "",
            listCtx?.isDropping() ? styles.dropping : "",
            listCtx?.hasActiveDrag() && !isDragging() ? styles.isSibling : "",
            local.disabled ? styles.disabled : "",
            local.class,
        ]
            .filter(Boolean)
            .join(" ");

    const handlePointerDown = (e: PointerEvent) => {
        if (listCtx?.isReorderable()) {
            listCtx.handlePointerDown(local.value, e);
        }
    };

    const handleCloseClick = async (e: MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();

        let isPrevented = false;
        const closeEvent: PaperListItemCloseEvent = {
            value: local.value,
            nativeEvent: e,
            preventDefault: () => {
                isPrevented = true;
            },
            get defaultPrevented() {
                return isPrevented;
            },
        };

        if (local.onBeforeClose) {
            const res = await local.onBeforeClose(closeEvent);
            if (res === false) {
                isPrevented = true;
            }
        }

        if (!isPrevented && listCtx?.onBeforeItemClose) {
            const res = await listCtx.onBeforeItemClose(closeEvent);
            if (res === false) {
                isPrevented = true;
            }
        }

        local.onClose?.(closeEvent);
        listCtx?.onItemClose?.(closeEvent);

        if (!closeEvent.defaultPrevented) {
            local.onClosed?.(local.value);
            listCtx?.onItemClosed?.(local.value);
        }
    };

    return (
        <label
            data-value={String(local.value)}
            {...rest}
            class={className()}
            classList={local.classList}
            style={{
                ...(listCtx?.getItemStyle(local.value) ?? {}),
                ...(typeof local.style === "object" ? local.style : {}),
            }}
            onPointerDown={handlePointerDown}
        >
            <SelectionRadioInput
                value={local.value}
                disabled={local.disabled}
            />

            <Show when={local.icon}>
                {typeof local.icon === "string" ? (
                    <PaperIcon class={styles.listIcon} zeroHeight>
                        {local.icon}
                    </PaperIcon>
                ) : (
                    <span class={styles.listIcon}>{local.icon}</span>
                )}
            </Show>

            <div class={styles.itemText}>
                <PaperText class={styles.listTitle} size={3} weight={500}>
                    <span>{local.children}</span>
                    <Show when={isCloseable()}>
                        <PaperButton
                            tiny
                            icon
                            onPointerDown={(e) => {
                                e.stopPropagation();
                                e.preventDefault();
                            }}
                            onClick={handleCloseClick}
                        >
                            close
                        </PaperButton>
                    </Show>
                </PaperText>
                <Show when={local.description}>
                    <PaperText
                        class={styles.listDescription}
                        size={1}
                        weight={600}
                    >
                        {local.description}
                    </PaperText>
                </Show>
            </div>
        </label>
    );
}
