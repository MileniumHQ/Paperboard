import { children, splitProps, Show, type JSX, type ParentProps } from "solid-js";
import { PaperIcon } from "../PaperIcon";
import styles from "./menu.module.css";

/**
 * The one menu-item element. PaperContextMenu and PaperSelectMenu both render
 * through it, so hover, highlight, icons, descriptions, keybinds and checks
 * behave and look the same in every menu.
 */
export interface MenuItemProps extends JSX.HTMLAttributes<HTMLDivElement> {
    icon?: JSX.Element | string;
    description?: JSX.Element | string;
    keybind?: string;
    danger?: boolean;
    disabled?: boolean;
    highlighted?: boolean;
    checked?: boolean;
}

export function MenuItem(props: ParentProps<MenuItemProps>) {
    const [local, rest] = splitProps(props, [
        "icon",
        "description",
        "keybind",
        "danger",
        "disabled",
        "highlighted",
        "checked",
        "class",
        "classList",
        "children",
    ]);

    const icon = children(() => local.icon);
    const description = children(() => local.description);

    const className = () =>
        [
            styles.item,
            local.danger ? styles.danger : "",
            local.disabled ? styles.disabled : "",
            local.highlighted ? styles.highlighted : "",
            local.class,
        ]
            .filter(Boolean)
            .join(" ");

    return (
        <div {...rest} class={className()} classList={local.classList}>
            <Show when={icon()}>
                {typeof icon() === "string" ? (
                    <PaperIcon class={styles.itemIcon}>{icon()}</PaperIcon>
                ) : (
                    <span class={styles.itemIcon}>{icon()}</span>
                )}
            </Show>

            <div class={styles.itemContent}>
                <span class={styles.itemLabel}>{local.children}</span>
                <Show when={description()}>
                    <span class={styles.itemDescription}>{description()}</span>
                </Show>
            </div>

            <Show when={local.keybind}>
                <span class={styles.itemKeybind}>{local.keybind}</span>
            </Show>

            <Show when={local.checked}>
                <PaperIcon class={styles.itemCheck}>check</PaperIcon>
            </Show>
        </div>
    );
}
