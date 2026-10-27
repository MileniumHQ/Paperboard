import styles from "./index.module.css";
import { createSignal, onCleanup, splitProps, Show, type JSX } from "solid-js";
import { PaperButton } from "../PaperButton";
import { PaperIcon } from "../PaperIcon";
import { copyText } from "../../utils/clipboard";
import { haptic } from "../../utils/haptics";
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
    // a failed copy says so: the button never looks like it worked when it didn't
    const [outcome, setOutcome] = createSignal<"copied" | "failed" | null>(null);
    let resetTimer: ReturnType<typeof setTimeout> | undefined;
    onCleanup(() => clearTimeout(resetTimer));

    const handleCopy = async () => {
        const ok = await copyText(local.text);
        haptic(ok ? "success" : "error");
        setOutcome(ok ? "copied" : "failed");
        clearTimeout(resetTimer);
        resetTimer = setTimeout(() => setOutcome(null), 2000);
    };

    const statusText = () =>
        outcome() === "copied" ? "Copied" : outcome() === "failed" ? "Couldn't copy" : null;

    return (
        <PaperButton size={local.label ? "medium" : "tiny"}
            {...rest}
            icon={!local.label}
            class={[styles.PaperCopyButton, local.class].filter(Boolean).join(" ")}
            classList={local.classList}
            title={statusText() ?? local.title ?? "Copy"}
            onClick={() => void handleCopy()}>
            <PaperIcon>
                {outcome() === "copied" ? "check" : outcome() === "failed" ? "error" : "content_copy"}
            </PaperIcon>
            <Show when={local.label}>
                {statusText() ?? local.label}
            </Show>
        </PaperButton>
    );
}
