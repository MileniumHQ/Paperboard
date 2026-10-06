import styles from "./index.module.css";
import { createSignal, splitProps, Show, type JSX } from "solid-js";
import { PaperButton } from "../PaperButton";
import { PaperIcon } from "../PaperIcon";
import { copyText } from "../../utils/clipboard";
import type { PaperButtonVariant } from "../../types";

export interface PaperCopyButtonProps
    extends Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, "onClick"> {
    text: string;
    /** label shown beside the icon; icon-only when omitted */
    label?: string;
    title?: string;
    /** PaperButton variant; defaults to the plain button surface */
    variant?: PaperButtonVariant;
}

/** Copy-to-clipboard button with the shared fallback and feedback. */
export function PaperCopyButton(props: PaperCopyButtonProps) {
    const [local, rest] = splitProps(props, [
        "text",
        "label",
        "title",
        "class",
        "classList",
    ]);
    const [copied, setCopied] = createSignal(false);

    const handleCopy = async () => {
        const ok = await copyText(local.text);
        if (!ok) return;
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <PaperButton size={local.label ? "medium" : "tiny"}
            {...rest}
            icon={!local.label}
            class={[styles.PaperCopyButton, local.class].filter(Boolean).join(" ")}
            classList={local.classList}
            title={local.title ?? (copied() ? "Copied" : "Copy")}
            onClick={() => void handleCopy()}>
            <PaperIcon>{copied() ? "check" : "content_copy"}</PaperIcon>
            <Show when={local.label}>
                {copied() ? "Copied" : local.label}
            </Show>
        </PaperButton>
    );
}
