import styles from "./index.module.css";
import { createSignal, createUniqueId, splitProps, Show, type JSX, type ParentProps } from "solid-js";
import { PaperIcon } from "../PaperIcon";
import { PaperText } from "../PaperText";

export interface PaperCollapsibleProps extends Omit<JSX.HTMLAttributes<HTMLDivElement>, "title"> {
    /** what the button says; the content is hidden behind it */
    title: JSX.Element | string;
    /** a Material icon name or an element before the title */
    icon?: JSX.Element | string;
    /** controlled: whether it's open. Leave it out and the collapsible keeps its own state */
    open?: boolean;
    /** uncontrolled: whether it starts open */
    defaultOpen?: boolean;
    onOpenChange?: (open: boolean) => void;
}

/** A button that shows and hides what's under it: details, options, anything the page needn't show at once. */
export function PaperCollapsible(props: ParentProps<PaperCollapsibleProps>) {
    const [local, rest] = splitProps(props, ["title", "icon", "open", "defaultOpen", "onOpenChange", "class", "classList", "children"]);
    const [own, setOwn] = createSignal(local.defaultOpen ?? false);
    const open = () => local.open ?? own();
    const id = createUniqueId();
    const toggle = () => {
        const next = !open();
        if (local.open === undefined) setOwn(next);
        local.onOpenChange?.(next);
    };

    return (
        <div {...rest} class={[styles.PaperCollapsible, local.class].filter(Boolean).join(" ")} classList={local.classList}>
            <button type="button" class={styles.header} aria-expanded={open()} aria-controls={`${id}-content`} id={`${id}-header`} onClick={toggle}>
                <span class={styles.chevron} classList={{ [styles.open!]: open() }} aria-hidden="true">
                    <PaperIcon>chevron_right</PaperIcon>
                </span>
                <Show when={local.icon}>
                    <span class={styles.icon} aria-hidden="true">
                        {typeof local.icon === "string" ? <PaperIcon>{local.icon}</PaperIcon> : local.icon}
                    </span>
                </Show>
                <PaperText size={2} weight={600}>
                    {local.title}
                </PaperText>
            </button>
            {/* kept in the page while closed so it can animate; inert, so nothing in it takes focus or is read */}
            <div class={styles.body} classList={{ [styles.open!]: open() }} id={`${id}-content`} role="region" aria-labelledby={`${id}-header`} inert={!open()}>
                <div class={styles.inner}>
                    <div class={styles.content}>{local.children}</div>
                </div>
            </div>
        </div>
    );
}
