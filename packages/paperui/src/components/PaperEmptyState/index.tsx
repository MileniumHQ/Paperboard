import styles from "./index.module.css";
import { splitProps, Show, type JSX, type ParentProps } from "solid-js";
import { PaperIcon } from "../PaperIcon";
import { PaperText } from "../PaperText";

export interface PaperEmptyStateProps extends Omit<JSX.HTMLAttributes<HTMLDivElement>, "title"> {
    icon?: JSX.Element | string;
    title?: JSX.Element | string;
    description?: JSX.Element | string;
}

/** The shared "nothing here" block: icon, title, description, actions. */
export function PaperEmptyState(props: ParentProps<PaperEmptyStateProps>) {
    const [local, rest] = splitProps(props, [
        "icon",
        "title",
        "description",
        "class",
        "classList",
        "children",
    ]);

    const className = () =>
        [styles.PaperEmptyState, local.class].filter(Boolean).join(" ");

    return (
        <div {...rest} class={className()} classList={local.classList}>
            <Show when={local.icon}>
                {typeof local.icon === "string" ? (
                    <PaperIcon class={styles.icon}>{local.icon}</PaperIcon>
                ) : (
                    local.icon
                )}
            </Show>
            <Show when={local.title}>
                <PaperText size={4} weight={600}>
                    {local.title}
                </PaperText>
            </Show>
            <Show when={local.description}>
                <PaperText size={2} color="text-subtle" style={{ "text-align": "center" }}>
                    {local.description}
                </PaperText>
            </Show>
            <Show when={local.children}>
                <div class={styles.actions}>{local.children}</div>
            </Show>
        </div>
    );
}
