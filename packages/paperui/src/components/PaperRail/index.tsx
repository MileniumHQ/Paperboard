import styles from "./index.module.css";
import { createContext, useContext, splitProps, Show, type ParentProps, type JSX } from "solid-js";
import { PaperIcon } from "../PaperIcon";
import {
    SelectionProvider,
    useSelectionItem,
    type SingleSelectionProviderProps,
} from "../contexts/selection";
import { createReorder, type Reorder } from "../shared/reorder";

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
            value={local.value}
            defaultValue={local.defaultValue}
            onValueChange={local.onValueChange}
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
    /** drag with a mouse or pen to move it among the rail's other
     *  reorderable items; the rail's onReorder reports the new order */
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

    const { isSelected, select } = useSelectionItem(
        local.value,
        local.disabled,
    );
    const shouldShowLabel = () => local.showLabel ?? railCtx?.showLabels ?? false;
    // a text label names the item, unless the caller names it themselves
    const textLabel = () => (typeof local.label === "string" ? local.label : undefined);

    const isDragging = () => railCtx?.reorder.isDragging(local.value) ?? false;

    const className = () =>
        [
            styles.PaperRailItem,
            isSelected() ? styles.selected : "",
            shouldShowLabel() ? styles.hasLabel : "",
            local.disabled ? styles.disabled : "",
            local.reorderable ? styles.reorderable : "",
            isDragging() ? styles.dragging : "",
            railCtx?.reorder.isDropping() ? styles.dropping : "",
            railCtx?.reorder.hasActiveDrag() && !isDragging() ? styles.isSibling : "",
            local.class,
        ]
            .filter(Boolean)
            .join(" ");

    // touch keeps its drag for scrolling the rail
    const handlePointerDown = (e: PointerEvent) => {
        if (local.reorderable && !local.disabled && e.pointerType !== "touch") {
            railCtx?.reorder.start(local.value, e);
        }
        if (typeof local.onPointerDown === "function") {
            (local.onPointerDown as (e: PointerEvent) => void)(e);
        }
    };

    // hidden inputs scroll ancestors on focus, divs don't
    const activate = (e: MouseEvent) => {
        // the click that ends a drag is not a choice
        if (local.disabled || railCtx?.reorder.justDragged()) return;
        select();
        if (typeof local.onClick === "function") {
            (local.onClick as (e: MouseEvent) => void)(e);
        }
    };

    return (
        <div
            {...rest}
            role="radio"
            aria-label={local["aria-label"] ?? textLabel()}
            aria-checked={isSelected()}
            aria-disabled={local.disabled || undefined}
            tabIndex={local.disabled ? -1 : 0}
            class={className()}
            classList={local.classList}
            {...{ [REORDER_ATTRIBUTE]: local.reorderable ? String(local.value) : undefined }}
            style={{
                ...(local.reorderable ? railCtx?.reorder.itemStyle(local.value) : {}),
                ...(typeof local.style === "object" ? local.style : {}),
            }}
            title={local.title ?? textLabel()}
            onClick={activate}
            onPointerDown={handlePointerDown}
            onKeyDown={(e) => {
                if (
                    !local.disabled &&
                    (e.key === " " || e.key === "Enter")
                ) {
                    e.preventDefault();
                    select();
                }
                if (typeof local.onKeyDown === "function") {
                    (local.onKeyDown as (e: KeyboardEvent) => void)(e);
                }
            }}
        >
            {typeof local.icon === "string" ? (
                <PaperIcon aria-hidden="true" class={styles.railIcon} zeroHeight>
                    {local.icon}
                </PaperIcon>
            ) : (
                <span class={styles.railIcon}>{local.icon}</span>
            )}
            <Show when={shouldShowLabel() && local.label}>
                <span class={styles.railLabel}>{local.label}</span>
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

    const shouldShowLabel = () => local.showLabel ?? railCtx?.showLabels ?? false;

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
            aria-label={typeof local.label === "string" ? local.label : undefined}
            {...rest}
            class={className()}
            classList={local.classList}
            title={local.title ?? (typeof local.label === "string" ? local.label : undefined)}
        >
            {typeof local.icon === "string" ? (
                <PaperIcon aria-hidden="true" class={styles.railIcon} zeroHeight>
                    {local.icon}
                </PaperIcon>
            ) : (
                <span class={styles.railIcon}>{local.icon}</span>
            )}
            <Show when={shouldShowLabel() && local.label}>
                <span class={styles.railLabel}>{local.label}</span>
            </Show>
        </button>
    );
}
