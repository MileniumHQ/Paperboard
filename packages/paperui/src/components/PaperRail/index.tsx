import styles from "./index.module.css";
import { createContext, useContext, splitProps, Show, type ParentProps, type JSX } from "solid-js";
import { PaperIcon } from "../PaperIcon";
import {
    SelectionProvider,
    useSelectionItem,
    type SelectionProviderProps,
} from "../contexts/selection";

const RailContext = createContext<{ showLabels?: boolean }>();

export type PaperRailProps = SelectionProviderProps &
    JSX.HTMLAttributes<HTMLDivElement> & {
        showLabels?: boolean;
    };

export function PaperRail(props: ParentProps<PaperRailProps>) {
    const [local, rest] = splitProps(props, [
        "name",
        "value",
        "defaultValue",
        "onValueChange",
        "showLabels",
        "class",
        "classList",
        "children",
    ]);

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
            <RailContext.Provider value={{ showLabels: local.showLabels }}>
                <div {...rest} class={className()} classList={local.classList}>
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
}

export interface PaperRailItemProps
    extends JSX.HTMLAttributes<HTMLDivElement> {
    value: string | number;
    icon: JSX.Element | string;
    label?: JSX.Element | string;
    showLabel?: boolean;
    disabled?: boolean;
}

export function PaperRailItem(props: PaperRailItemProps) {
    const railCtx = useContext(RailContext);
    const [local, rest] = splitProps(props, [
        "value",
        "icon",
        "label",
        "showLabel",
        "disabled",
        "class",
        "classList",
        "onClick",
        "onKeyDown",
    ]);

    const { isSelected, select } = useSelectionItem(
        local.value,
        local.disabled,
    );
    const shouldShowLabel = () => local.showLabel ?? railCtx?.showLabels ?? false;

    const className = () =>
        [
            styles.PaperRailItem,
            isSelected() ? styles.selected : "",
            shouldShowLabel() ? styles.hasLabel : "",
            local.disabled ? styles.disabled : "",
            local.class,
        ]
            .filter(Boolean)
            .join(" ");

    // hidden inputs scroll ancestors on focus, divs don't
    const activate = (e: MouseEvent) => {
        if (local.disabled) return;
        select();
        if (typeof local.onClick === "function") {
            (local.onClick as (e: MouseEvent) => void)(e);
        }
    };

    return (
        <div
            {...rest}
            role="radio"
            aria-label={typeof local.label === "string" ? local.label : undefined}
            aria-checked={isSelected()}
            aria-disabled={local.disabled || undefined}
            tabIndex={local.disabled ? -1 : 0}
            class={className()}
            classList={local.classList}
            title={typeof local.label === "string" ? local.label : undefined}
            onClick={activate}
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
            title={typeof local.label === "string" ? local.label : undefined}
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
