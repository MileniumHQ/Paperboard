import styles from "./index.module.css";
import { children, createContext, createMemo, useContext, splitProps, onCleanup, onMount, Show, type ParentProps, type JSX } from "solid-js";
import { PaperIcon } from "../PaperIcon";
import {
    SelectionProvider,
    useSelectionItem,
    type SingleSelectionProviderProps,
} from "../contexts/selection";
import { createReorder, type Reorder } from "../shared/reorder";
import { HOLD_MS } from "../../utils/touchHold";
import { mergeStyle } from "../../utils/style";

const RailContext = createContext<{ showLabels?: boolean; reorder: Reorder }>();

// the reorderable items carry their value here, apart from the rest
const REORDER_ATTRIBUTE = "data-reorder-value";

export type PaperRailProps = SingleSelectionProviderProps &
    JSX.HTMLAttributes<HTMLDivElement> & {
        showLabels?: boolean;
        /** the reorderable items' values, in their new order, after a drag */
        onReorder?: (newOrderValues: string[]) => void;
    };

export function PaperRail(props: ParentProps<PaperRailProps>) {
    const [local, rest] = splitProps(props, [
        "name",
        "value",
        "defaultValue",
        "onValueChange",
        "showLabels",
        "onReorder",
        "class",
        "classList",
        "children",
    ]);

    let railRef: HTMLDivElement | undefined;
    const reorder = createReorder({
        container: () => railRef,
        itemSelector: `:scope > [${REORDER_ATTRIBUTE}]`,
        valueAttribute: REORDER_ATTRIBUTE,
        horizontal: () => false,
        onReorder: () => local.onReorder,
    });

    // a finger carrying a held item must move it, not scroll the rail; only
    // a non-passive listener there when the touch starts can stop the scroll
    onMount(() => {
        const rail = railRef;
        if (!rail) return;
        const holdScroll = (e: TouchEvent) => {
            if (reorder.blocksScroll() && e.cancelable) e.preventDefault();
        };
        rail.addEventListener("touchmove", holdScroll, { passive: false });
        onCleanup(() => rail.removeEventListener("touchmove", holdScroll));
    });

    // the selection reads the chosen value and its callback when an item is pressed, outside any tracking: a parent
    // passing a computed `value` would make its getter build a computation there
    const value = createMemo(() => local.value);
    const onValueChange = createMemo(() => local.onValueChange);

    const className = () =>
        [
            styles.PaperRail,
            local.showLabels ? styles.withLabels : "",
            local.class,
        ]
            .filter(Boolean)
            .join(" ");

    return (
        <SelectionProvider
            name={local.name}
            value={value()}
            defaultValue={local.defaultValue}
            onValueChange={onValueChange()}
        >
            <RailContext.Provider value={{
                get showLabels() { return local.showLabels; },
                reorder,
            }}>
                <div {...rest} ref={railRef} class={className()} classList={local.classList}>
                    {local.children}
                </div>
            </RailContext.Provider>
        </SelectionProvider>
    );
}

export interface PaperRailItemProps
    extends JSX.HTMLAttributes<HTMLDivElement> {
    value: string | number;
    icon: JSX.Element | string;
    label?: JSX.Element | string;
    showLabel?: boolean;
    disabled?: boolean;
    /** drag with a mouse or pen, or hold with a finger and then drag, to
     *  move it among the rail's other reorderable items; the rail's
     *  onReorder reports the new order */
    reorderable?: boolean;
}

export function PaperRailItem(props: PaperRailItemProps) {
    const railCtx = useContext(RailContext);
    const [local, rest] = splitProps(props, [
        "value",
        "icon",
        "label",
        "showLabel",
        "disabled",
        "reorderable",
        "class",
        "classList",
        "style",
        "onClick",
        "onPointerDown",
        "onKeyDown",
        "aria-label",
        "title",
    ]);

    // what the handlers read when pressed, outside any tracking: a parent passing a computed prop
    // would make its getter build a computation there
    const value = createMemo(() => local.value);
    const disabled = createMemo(() => local.disabled);
    const reorderable = createMemo(() => local.reorderable);
    const onClick = createMemo(() => local.onClick);
    const onPointerDown = createMemo(() => local.onPointerDown);
    const onKeyDown = createMemo(() => local.onKeyDown);

    const { isSelected, select } = useSelectionItem(value, disabled);
    const icon = children(() => local.icon);
    const label = children(() => local.label);
    const shouldShowLabel = () => local.showLabel ?? railCtx?.showLabels ?? false;
    // a text label names the item, unless the caller names it themselves
    const textLabel = () => {
        const text = label();
        return typeof text === "string" ? text : undefined;
    };

    const isDragging = () => railCtx?.reorder.isDragging(value()) ?? false;

    const className = () =>
        [
            styles.PaperRailItem,
            isSelected() ? styles.selected : "",
            shouldShowLabel() ? styles.hasLabel : "",
            disabled() ? styles.disabled : "",
            reorderable() ? styles.reorderable : "",
            isDragging() ? styles.dragging : "",
            railCtx?.reorder.isLifted(value()) ? styles.lifted : "",
            railCtx?.reorder.isDropping() ? styles.dropping : "",
            railCtx?.reorder.hasActiveDrag() && !isDragging() ? styles.isSibling : "",
            local.class,
        ]
            .filter(Boolean)
            .join(" ");

    // a finger holds first, so a quick swipe still scrolls the rail; the
    // hold is the same one that opens the item's context menu
    const handlePointerDown = (e: PointerEvent) => {
        if (reorderable() && !disabled()) {
            railCtx?.reorder.start(value(), e, e.pointerType === "touch" ? { holdMs: HOLD_MS } : {});
        }
        if (typeof onPointerDown() === "function") {
            (onPointerDown() as (e: PointerEvent) => void)(e);
        }
    };

    // hidden inputs scroll ancestors on focus, divs don't
    const activate = (e: MouseEvent) => {
        // the click that ends a drag is not a choice
        if (disabled() || railCtx?.reorder.justDragged()) return;
        select();
        if (typeof onClick() === "function") {
            (onClick() as (e: MouseEvent) => void)(e);
        }
    };

    return (
        <div
            {...rest}
            role="radio"
            aria-label={local["aria-label"] ?? textLabel()}
            aria-checked={isSelected()}
            aria-disabled={disabled() || undefined}
            tabIndex={disabled() ? -1 : 0}
            class={className()}
            classList={local.classList}
            {...{ [REORDER_ATTRIBUTE]: reorderable() ? String(value()) : undefined }}
            style={mergeStyle((reorderable() ? railCtx?.reorder.itemStyle(value()) : undefined) ?? {}, local.style)}
            title={local.title ?? textLabel()}
            onClick={activate}
            onPointerDown={handlePointerDown}
            onKeyDown={(e) => {
                if (
                    !disabled() &&
                    (e.key === " " || e.key === "Enter")
                ) {
                    e.preventDefault();
                    select();
                }
                if (typeof onKeyDown() === "function") {
                    (onKeyDown() as (e: KeyboardEvent) => void)(e);
                }
            }}
        >
            {typeof icon() === "string" ? (
                <PaperIcon aria-hidden="true" class={styles.railIcon} zeroHeight>
                    {icon()}
                </PaperIcon>
            ) : (
                <span class={styles.railIcon}>{icon()}</span>
            )}
            <Show when={shouldShowLabel() && label()}>
                <span class={styles.railLabel}>{label()}</span>
            </Show>
        </div>
    );
}

export interface PaperRailActionProps
    extends JSX.ButtonHTMLAttributes<HTMLButtonElement> {
    icon: JSX.Element | string;
    label?: JSX.Element | string;
    showLabel?: boolean;
}

export function PaperRailAction(props: PaperRailActionProps) {
    const railCtx = useContext(RailContext);
    const [local, rest] = splitProps(props, [
        "icon",
        "label",
        "showLabel",
        "class",
        "classList",
        "title",
    ]);

    const icon = children(() => local.icon);
    const label = children(() => local.label);
    const shouldShowLabel = () => local.showLabel ?? railCtx?.showLabels ?? false;
    const textLabel = () => {
        const text = label();
        return typeof text === "string" ? text : undefined;
    };

    const className = () =>
        [
            styles.PaperRailItem,
            styles.railAction,
            shouldShowLabel() ? styles.hasLabel : "",
            local.class,
        ]
            .filter(Boolean)
            .join(" ");

    return (
        <button
            type="button"
            aria-label={textLabel()}
            {...rest}
            class={className()}
            classList={local.classList}
            title={local.title ?? textLabel()}
        >
            {typeof icon() === "string" ? (
                <PaperIcon aria-hidden="true" class={styles.railIcon} zeroHeight>
                    {icon()}
                </PaperIcon>
            ) : (
                <span class={styles.railIcon}>{icon()}</span>
            )}
            <Show when={shouldShowLabel() && label()}>
                <span class={styles.railLabel}>{label()}</span>
            </Show>
        </button>
    );
}
