import styles from "./index.module.css";
import {
    createContext,
    useContext,
    splitProps,
    Show,
    type ParentProps,
    type JSX,
} from "solid-js";
import { Dynamic } from "solid-js/web";
import { PaperButton } from "../PaperButton";
import { PaperIcon } from "../PaperIcon";
import { PaperLoader } from "../PaperLoader";
import { PaperText, type PaperTextProps } from "../PaperText";
import {
    SelectionProvider,
    SelectionRadioInput,
    useSelectionItem,
    type SelectionProviderProps,
} from "../contexts/selection";
import type { LoaderStatus, PaperBackgroundSurface } from "../../types";
import { resolveBackground } from "../../utils/theme";
import { createReorder } from "../shared/reorder";

export interface PaperListItemCloseEvent {
    value: string | number;
    nativeEvent: MouseEvent;
    preventDefault: () => void;
    defaultPrevented: boolean;
}

// a list that only shows things has nothing to choose, so it needs no name
export type PaperListProps = (
    | (SelectionProviderProps & { selectable?: true })
    | (Partial<SelectionProviderProps> & { selectable: false })
) &
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
        /** the list's surface; inset by default, transparent inside a card
         *  that already provides one */
        background?: PaperBackgroundSurface | "transparent";
        /**
         * false: the list only shows things (what is updating, what
         * happened). Its items can't be chosen, so they don't highlight or
         * take a selection bar; their actions still work. Default true.
         */
        selectable?: boolean;
        /**
         * Smaller rows with smaller text, for a dense sidebar (a vertical
         * tab strip). Default false.
         */
        compact?: boolean;
        /**
         * A list of buttons, like a phone's navigation list: pressing an item
         * still chooses it (onValueChange, the item's onClick), but no item
         * stays highlighted, because what it opens covers the list. Default
         * false.
         */
        buttons?: boolean;
    };

interface PaperListContextType {
    isSelectable: () => boolean;
    isButtons: () => boolean;
    isCompact: () => boolean;
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
        "background",
        "selectable",
        "compact",
        "buttons",
        "class",
        "classList",
        "style",
        "children",
    ]);

    const isCompact = () => local.compact ?? false;
    const isSelectable = () => local.selectable ?? true;
    const isHorizontal = () =>
        local.direction === "horizontal" || Boolean(local.horizontal);
    const isReorderable = () => local.reorderable ?? false;
    // Tabs scroll rather than compress: by default a list owns the overflow
    // on its layout axis. Set scrollable={false} for the old shrink-to-fit
    // behavior, or "x"/"y" to force an axis.
    const isScrollable = () => local.scrollable ?? true;

    const reorder = createReorder({
        container: () => containerRef,
        itemSelector: ":scope > [data-value]",
        valueAttribute: "data-value",
        horizontal: isHorizontal,
        onReorder: () => local.onReorder,
    });

    const handlePointerDown = (value: string | number, e: PointerEvent) => {
        if (isReorderable()) reorder.start(value, e);
    };

    // the click that ends a drag lands on an item; it must not select it
    const handleContainerClickCapture = (e: MouseEvent) => {
        if (reorder.justDragged()) {
            e.preventDefault();
            e.stopPropagation();
        }
    };

    const contextValue: PaperListContextType = {
        isSelectable,
        isButtons: () => local.buttons ?? false,
        isCompact,
        isReorderable,
        hasActiveDrag: reorder.hasActiveDrag,
        isDropping: reorder.isDropping,
        isItemDragging: reorder.isDragging,
        handlePointerDown,
        getItemStyle: reorder.itemStyle,
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
            isSelectable() ? "" : styles.static,
            isCompact() ? styles.compact : "",
            local.borderless ? styles.borderless : "",
            local.fullWidth ? styles.fullWidth : "",
            local.fullHeight ? styles.fullHeight : "",
            isScrollable() ? styles.scrollable : "",
            isScrollable() && local.scrollable !== "x" && !isHorizontal() ? "paper-scroll-end" : "",
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
        if (local.background) extra.background = resolveBackground(local.background);
        if (isScrollable()) {
            const scrollable = local.scrollable;
            extra.overflow =
                scrollable === "x"
                    ? "auto hidden"
                    : scrollable === "y"
                      ? "hidden auto"
                      : isHorizontal()
                        ? "auto hidden"
                        : "hidden auto";
        }
        return {
            ...extra,
            ...(typeof local.style === "object" ? local.style : {}),
        };
    };

    return (
        <SelectionProvider
            // a list that isn't selectable renders no inputs to name
            name={local.name ?? ""}
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

export type PaperListLabelProps = PaperTextProps;

/** A group label between list items: names the items that follow it. */
export function PaperListLabel(props: ParentProps<PaperListLabelProps>) {
    const [local, rest] = splitProps(props, ["class", "children"]);
    return (
        <PaperText
            as="div"
            color="text-subtle"
            {...rest}
            preset="section"
            class={[styles.PaperListLabel, local.class].filter(Boolean).join(" ")}
        >
            {local.children}
        </PaperText>
    );
}

export interface PaperListItemProps extends Omit<
    JSX.HTMLAttributes<HTMLLabelElement>,
    "onClose"
> {
    value: string | number;
    description?: JSX.Element | string;
    icon?: JSX.Element | string;
    /**
     * A small loader in the icon's place, for an item that is doing
     * something (downloading, installing). It takes the place of icon.
     */
    loaderStatus?: LoaderStatus;
    /** how far the loader has come, 0 to 100 */
    percent?: number;
    /**
     * Trailing controls (for example a menu button). They render after the
     * item text and are responsible for stopping their own events.
     */
    actions?: JSX.Element;
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
        "loaderStatus",
        "percent",
        "actions",
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
    const selectable = () => listCtx?.isSelectable() ?? true;
    const compact = () => listCtx?.isCompact() ?? false;
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
            isSelected() && selectable() && !listCtx?.isButtons() ? styles.selected : "",
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
        <Dynamic
            component={selectable() ? "label" : "div"}
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
            <Show when={selectable()}>
                <SelectionRadioInput
                    value={local.value}
                    disabled={local.disabled}
                />
            </Show>

            <Show
                when={local.loaderStatus}
                fallback={
                    <Show when={local.icon}>
                        {typeof local.icon === "string" ? (
                            <PaperIcon class={styles.listIcon} zeroHeight>
                                {local.icon}
                            </PaperIcon>
                        ) : (
                            <span class={styles.listIcon}>{local.icon}</span>
                        )}
                    </Show>
                }
            >
                {(status) => (
                    <span class={styles.listIcon}>
                        <PaperLoader size="small" loaderStatus={status()} percent={local.percent ?? 0} />
                    </span>
                )}
            </Show>

            <div class={styles.itemText}>
                <PaperText class={styles.listTitle} size={compact() ? 2 : 3} weight={500}>
                    <span>{local.children}</span>
                    <Show when={isCloseable()}>
                        <PaperButton size="tiny"
                            icon
                            aria-label="Close"
                            onPointerDown={(e) => {
                                e.stopPropagation();
                                e.preventDefault();
                            }}
                            onClick={handleCloseClick}>
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

            <Show when={local.actions}>
                <span class={styles.itemActions}>{local.actions}</span>
            </Show>
        </Dynamic>
    );
}
