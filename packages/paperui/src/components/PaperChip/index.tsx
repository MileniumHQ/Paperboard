import styles from "./index.module.css";
import { splitProps, Show, type JSX } from "solid-js";
import { PaperIcon } from "../PaperIcon";

export interface PaperChipProps
    extends Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
    /** selected/toggled state (filters, view switches) */
    selected?: boolean;
    /** optional trailing count */
    count?: number;
    icon?: JSX.Element | string;
    children: JSX.Element;
}

/**
 * A compact toggle pill for filters and view switches. Renders a real
 * button, so keyboard and screen-reader users get the toggle for free.
 */
export function PaperChip(props: PaperChipProps) {
    const [local, rest] = splitProps(props, [
        "selected",
        "count",
        "icon",
        "disabled",
        "type",
        "class",
        "classList",
        "children",
    ]);

    const className = () =>
        [
            styles.PaperChip,
            local.selected ? styles.selected : "",
            local.disabled ? styles.disabled : "",
            local.class,
        ]
            .filter(Boolean)
            .join(" ");

    return (
        <button
            {...rest}
            type={local.type ?? "button"}
            class={className()}
            classList={local.classList}
            disabled={local.disabled}
            aria-pressed={local.selected === true ? "true" : "false"}
        >
            <Show when={local.icon}>
                {typeof local.icon === "string" ? (
                    <PaperIcon zeroHeight>{local.icon}</PaperIcon>
                ) : (
                    local.icon
                )}
            </Show>
            {local.children}
            <Show when={local.count !== undefined}>
                <span class={styles.count}>{local.count}</span>
            </Show>
        </button>
    );
}
