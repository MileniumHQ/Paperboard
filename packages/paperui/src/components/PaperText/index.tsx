import styles from "./index.module.css";
import { splitProps, createSignal, onCleanup, Show, type JSX } from "solid-js";
import { Dynamic } from "solid-js/web";
import { PaperButton } from "../PaperButton";
import { PaperIcon } from "../PaperIcon";
import type { PaperColor, PaperTextPreset } from "../../types";
import { resolveColor, getVarCss } from "../../utils/theme";
import { copyText } from "../../utils/clipboard";
import { mergeStyle } from "../../utils/style";
import { cx } from "../../utils/cx";

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

/** size and weight per preset; colour, case and line height live in the stylesheet */
export const PRESETS: Record<PaperTextPreset, { size: number; weight: number }> = {
    headline: { size: 12, weight: 800 },
    header: { size: 10, weight: 700 },
    subheader: { size: 7, weight: 600 },
    /** the title at the top of a page or wizard step */
    title: { size: 6, weight: 700 },
    subtitle: { size: 3, weight: 500 },
    /** the heading over a group of cards or rows */
    heading: { size: 2, weight: 700 },
    /** an uppercase overline over a menu or list group */
    section: { size: 1, weight: 700 },
    /** the name of one card, row or empty state */
    label: { size: 4, weight: 600 },
    /** a sentence of app copy */
    text: { size: 3, weight: 400 },
    /** long reading: markdown and documentation */
    body: { size: 3, weight: 400 },
    /** supporting text: descriptions, status, counts, notes */
    hint: { size: 2, weight: 400 },
    /** a failure shown next to what failed */
    error: { size: 2, weight: 400 },
    caption: { size: 1, weight: 500 },
};

/** what sets a text's inline style; PaperTextList gives its own to its items */
type TextLook = Pick<PaperTextProps, "preset" | "size" | "weight" | "color" | "breakWord" | "truncate" | "style">;

/** A text's inline style: its weight, size and colour, and how it wraps or truncates; `own` is the element's own. */
export function textStyle(look: TextLook, defaultSize: number, own: JSX.CSSProperties = {}): JSX.CSSProperties | string {
    const preset = look.preset ? PRESETS[look.preset] : undefined;
    const extra: JSX.CSSProperties = {};
    if (look.breakWord) {
        extra["word-break"] = "break-word";
        extra["overflow-wrap"] = "break-word";
    }
    if (typeof look.truncate === "number" && look.truncate > 1) {
        Object.assign(extra, { display: "-webkit-box", "-webkit-line-clamp": look.truncate, "-webkit-box-orient": "vertical", overflow: "hidden", "text-overflow": "ellipsis" });
    } else if (look.truncate) {
        Object.assign(extra, { overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" });
    }
    return mergeStyle(
        {
            "font-weight": look.weight ?? preset?.weight ?? 400,
            "font-size": getVarCss(`text-size-${look.size ?? preset?.size ?? defaultSize}`),
            color: resolveColor(look.color),
            ...own,
            ...extra,
        },
        look.style,
    );
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
