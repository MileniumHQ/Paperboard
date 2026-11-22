import styles from "./index.module.css";
import { Show, splitProps, children, type JSX } from "solid-js";
import { PaperIcon } from "../PaperIcon";
import { cx } from "../../utils/cx";

export interface PaperInlineChipProps
    extends Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
    /** An icon name, or an element, before the label. */
    icon?: JSX.Element | string;
    children: JSX.Element;
}

/**
 * A pressable chip that sits in a line of text, like a file named in a
 * sentence: an icon and a label, exactly one line tall, so the text around
 * it keeps its spacing. What a press does is the caller's, such as opening
 * the file in a PaperPreviewModal. A long label is cut short with an ellipsis.
 */
export function PaperInlineChip(props: PaperInlineChipProps) {
    const [local, rest] = splitProps(props, ["icon", "type", "class", "classList", "children"]);
    const icon = children(() => local.icon);

    return (
        <button
            {...rest}
            type={local.type ?? "button"}
            class={cx(styles.PaperInlineChip, local.class)}
            classList={local.classList}
        >
            <Show when={icon()}>
                {typeof icon() === "string" ? <PaperIcon class={styles.icon}>{icon()}</PaperIcon> : icon()}
            </Show>
            <span class={styles.label}>{local.children}</span>
        </button>
    );
}
