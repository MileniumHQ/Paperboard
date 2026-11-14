import styles from "./index.module.css";
import { children, splitProps, Show, type JSX, type ParentProps } from "solid-js";
import { PaperIcon } from "../PaperIcon";
import { PaperText } from "../PaperText";
import { PaperBadge } from "../PaperBadge";

export interface PaperSectionHeaderProps extends Omit<JSX.HTMLAttributes<HTMLDivElement>, "title"> {
    icon?: JSX.Element | string;
    title: JSX.Element | string;
    /** count badge; omitted when undefined */
    count?: number;
}

/** A list section header: icon, title, count, trailing actions. */
export function PaperSectionHeader(props: ParentProps<PaperSectionHeaderProps>) {
    const [local, rest] = splitProps(props, [
        "icon",
        "title",
        "count",
        "class",
        "classList",
        "children",
    ]);

    const icon = children(() => local.icon);
    const actions = children(() => local.children);

    const className = () =>
        [styles.PaperSectionHeader, local.class].filter(Boolean).join(" ");

    return (
        <div {...rest} class={className()} classList={local.classList}>
            <div class={styles.title}>
                <Show when={icon()}>
                    {typeof icon() === "string" ? <PaperIcon class={styles.icon}>{icon()}</PaperIcon> : icon()}
                </Show>
                <PaperText preset="heading">
                    {local.title}
                </PaperText>
                <Show when={local.count !== undefined}>
                    <PaperBadge variant="monochrome">{local.count}</PaperBadge>
                </Show>
            </div>
            <Show when={actions()}>
                <div class={styles.actions}>{actions()}</div>
            </Show>
        </div>
    );
}
