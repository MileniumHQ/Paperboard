// PaperText's inline style, shared with PaperTextList; internal, so the
// barrel's export * doesn't make it PaperUI's API
import type { JSX } from "solid-js";
import type { PaperTextPreset } from "../../types";
import { resolveColor, getVarCss } from "../../utils/theme";
import { mergeStyle } from "../../utils/style";
import type { PaperTextProps } from "./index";

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
