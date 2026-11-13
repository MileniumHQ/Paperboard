import styles from "./index.module.css";
import { Show, splitProps, type JSX } from "solid-js";
import { PaperIcon } from "../PaperIcon";

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
 * the file in a PaperPreview. A long label is cut short with an ellipsis.
 */
export function PaperInlineChip(props: PaperInlineChipProps) {
    const [local, rest] = splitProps(props, ["icon", "type", "class", "classList", "children"]);

    return (
        <button
            {...rest}
            type={local.type ?? "button"}
            class={[styles.PaperInlineChip, local.class].filter(Boolean).join(" ")}
            classList={local.classList}
        >
            <Show when={local.icon}>
                {typeof local.icon === "string" ? <PaperIcon class={styles.icon}>{local.icon}</PaperIcon> : local.icon}
            </Show>
            <span class={styles.label}>{local.children}</span>
        </button>
    );
}
