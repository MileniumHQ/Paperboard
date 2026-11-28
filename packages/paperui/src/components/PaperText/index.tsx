import styles from "./index.module.css";
import { splitProps, createSignal, onCleanup, Show, type JSX } from "solid-js";
import { Dynamic } from "solid-js/web";
import { PaperButton } from "../PaperButton";
import { PaperIcon } from "../PaperIcon";
import type { PaperColor, PaperTextPreset } from "../../types";
import { copyText } from "../../utils/clipboard";
import { textStyle } from "./style";
import { cx } from "../../utils/cx";

export { PRESETS } from "./style";

export interface PaperTextProps extends JSX.HTMLAttributes<HTMLElement> {
    weight?: number;
    size?: number;
    rounded?: boolean;
    /** code switches to the monospace family */
    family?: "body" | "code";
    preset?: PaperTextPreset;
    as?: string;
    color?: PaperColor;
    breakWord?: boolean;
    truncate?: boolean | number;
    /** indents by --paper-inset-outside so text outside a card lines up with the text inside it */
    inset?: boolean;
}

export function PaperText(props: PaperTextProps) {
    const [local, rest] = splitProps(props, [
        "weight",
        "size",
        "rounded",
        "family",
        "preset",
        "as",
        "color",
        "breakWord",
        "truncate",
        "inset",
        "class",
        "classList",
        "children",
        "style",
    ]);

    const [copied, setCopied] = createSignal<"idle" | "copied" | "failed">("idle");
    let resetTimer: ReturnType<typeof setTimeout> | undefined;
    onCleanup(() => clearTimeout(resetTimer));

    const handleCopyAnchor = async (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (!rest.id) return;
        const url = `${window.location.origin}${window.location.pathname}#${rest.id}`;
        // copyText falls back to execCommand where the async clipboard is
        // denied, and reports a failure the button then shows
        const ok = await copyText(url);
        if (ok) window.history.pushState(null, "", `#${rest.id}`);
        setCopied(ok ? "copied" : "failed");
        clearTimeout(resetTimer);
        resetTimer = setTimeout(() => setCopied("idle"), 2000);
    };

    const className = () =>
        cx(
            styles.PaperText,
            local.rounded ? styles.rounded : "",
            local.family === "code" ? styles.code : "",
            local.preset ? styles[local.preset] : "",
            local.breakWord ? styles.breakWord : "",
            local.truncate ? styles.truncate : "",
            local.inset ? styles.inset : "",
            local.class,
        );

    return (
        <Dynamic
            component={local.as || "span"}
            data-preset={local.preset}
            {...rest}
            class={className()}
            classList={local.classList}
            style={textStyle(local, 4)}
        >
            {local.children}
            <Show when={rest.id}>
                <PaperButton size="tiny"
                    icon
                    variant="text"
                    class={styles.anchorLink}
                    onClick={handleCopyAnchor}
                    title={
                        copied() === "copied"
                            ? "Copied link"
                            : copied() === "failed"
                              ? "Copy failed"
                              : "Copy link"
                    }>
                    <PaperIcon zeroHeight>
                        {copied() === "copied" ? "check" : copied() === "failed" ? "error" : "link"}
                    </PaperIcon>
                </PaperButton>
            </Show>
        </Dynamic>
    );
}
