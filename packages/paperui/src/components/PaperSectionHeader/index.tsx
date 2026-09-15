import styles from "./index.module.css";
import { splitProps, Show, type JSX, type ParentProps } from "solid-js";
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

    const className = () =>
        [styles.PaperSectionHeader, local.class].filter(Boolean).join(" ");

    return (
        <div {...rest} class={className()} classList={local.classList}>
            <div class={styles.title}>
                <Show when={local.icon}>
                    {typeof local.icon === "string" ? (
                        <PaperIcon class={styles.icon}>{local.icon}</PaperIcon>
                    ) : (
                        local.icon
                    )}
                </Show>
                <PaperText size={2} weight={700}>
                    {local.title}
                </PaperText>
                <Show when={local.count !== undefined}>
                    <PaperBadge variant="monochrome">{local.count}</PaperBadge>
                </Show>
            </div>
            <Show when={local.children}>
                <div class={styles.actions}>{local.children}</div>
            </Show>
        </div>
    );
}
