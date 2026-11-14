import styles from "./index.module.css";
import { splitProps, Show, children, type JSX, type ParentProps } from "solid-js";
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

    const icon = children(() => local.icon);
    const title = children(() => local.title);
    const description = children(() => local.description);
    const actions = children(() => local.children);

    const className = () =>
        [styles.PaperEmptyState, local.class].filter(Boolean).join(" ");

    return (
        <div {...rest} class={className()} classList={local.classList}>
            <Show when={icon()}>
                {typeof icon() === "string" ? <PaperIcon class={styles.icon}>{icon()}</PaperIcon> : icon()}
            </Show>
            <Show when={title()}>
                <PaperText preset="label">{title()}</PaperText>
            </Show>
            <Show when={description()}>
                <PaperText preset="hint">{description()}</PaperText>
            </Show>
            <Show when={actions()}>
                <div class={styles.actions}>{actions()}</div>
            </Show>
        </div>
    );
}
