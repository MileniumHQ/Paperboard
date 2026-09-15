import styles from "./index.module.css";
import { splitProps, createSignal, Show, type JSX } from "solid-js";
import { Dynamic } from "solid-js/web";
import { PaperButton } from "../PaperButton";
import { PaperIcon } from "../PaperIcon";
import type { PaperColor, PaperTextPreset } from "../../types";
import { resolveColor, getVarCss } from "../../utils/theme";

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
}

const PRESETS: Record<string, { size: number; weight: number }> = {
    headline: { size: 12, weight: 800 },
    header: { size: 10, weight: 700 },
    subheader: { size: 7, weight: 600 },
    title: { size: 5, weight: 700 },
    subtitle: { size: 3, weight: 500 },
    section: { size: 1, weight: 700 },
    body: { size: 3, weight: 400 },
    caption: { size: 1, weight: 500 },
};

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
        "class",
        "classList",
        "children",
        "style",
    ]);

    const [copied, setCopied] = createSignal(false);

    const handleCopyAnchor = async (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (!rest.id) return;
        const url = `${window.location.origin}${window.location.pathname}#${rest.id}`;
        try {
            await navigator.clipboard.writeText(url);
            window.history.pushState(null, "", `#${rest.id}`);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (err) {
            console.error("Failed to copy anchor link to clipboard", err);
        }
    };

    const presetValues = () =>
        local.preset ? PRESETS[local.preset] : undefined;
    const effectiveSize = () => local.size ?? presetValues()?.size ?? 4;
    const effectiveWeight = () => local.weight ?? presetValues()?.weight ?? 400;

    const fontSizeVar = () => getVarCss(`text-size-${effectiveSize()}`);

    const resolvedColor = () => resolveColor(local.color);

    const className = () =>
        [
            styles.PaperText,
            local.rounded ? styles.rounded : "",
            local.family === "code" ? styles.code : "",
            local.preset ? styles[local.preset] : "",
            local.breakWord ? styles.breakWord : "",
            local.truncate ? styles.truncate : "",
            local.class,
        ]
            .filter(Boolean)
            .join(" ");

    const dynamicStyle = () => {
        const extra: JSX.CSSProperties = {};

        if (local.breakWord) {
            extra["word-break"] = "break-word";
            extra["overflow-wrap"] = "break-word";
        }

        if (local.truncate) {
            if (typeof local.truncate === "number" && local.truncate > 1) {
                extra.display = "-webkit-box";
                extra["-webkit-line-clamp"] = local.truncate;
                extra["-webkit-box-orient"] = "vertical";
                extra.overflow = "hidden";
                extra["text-overflow"] = "ellipsis";
            } else {
                extra.overflow = "hidden";
                extra["text-overflow"] = "ellipsis";
                extra["white-space"] = "nowrap";
            }
        }

        return {
            "font-weight": effectiveWeight(),
            "font-size": fontSizeVar(),
            color: resolvedColor(),
            ...extra,
            ...(typeof local.style === "object" ? local.style : {}),
        };
    };

    return (
        <Dynamic
            component={local.as || "span"}
            data-preset={local.preset}
            {...rest}
            class={className()}
            classList={local.classList}
            style={dynamicStyle()}
        >
            {local.children}
            <Show when={rest.id}>
                <PaperButton size="tiny"
                    icon
                    variant="text"
                    class={styles.anchorLink}
                    onClick={handleCopyAnchor}
                    title={copied() ? "Copied link!" : "Copy link"}>
                    <PaperIcon zeroHeight>
                        {copied() ? "check" : "link"}
                    </PaperIcon>
                </PaperButton>
            </Show>
        </Dynamic>
    );
}
