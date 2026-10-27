import { getVarCss, resolveColor } from "../../utils/theme";
import type { PaperColor } from "../../types";
import styles from "./index.module.css";
import { splitProps, type JSX } from "solid-js";

export type PaperSwatchSize = "small" | "medium" | "large";

export interface PaperSwatchProps extends JSX.HTMLAttributes<HTMLSpanElement> {
    /** a color token ("success") or any CSS color; defaults to the neutral border tone */
    color?: PaperColor;
    size?: PaperSwatchSize;
}

/** A small color dot, for roles, swatches, and presence markers. */
export function PaperSwatch(props: PaperSwatchProps) {
    const [local, rest] = splitProps(props, [
        "color",
        "size",
        "class",
        "classList",
        "style",
    ]);

    const className = () =>
        [styles.PaperSwatch, styles[local.size ?? "medium"], local.class]
            .filter(Boolean)
            .join(" ");

    return (
        <span
            {...rest}
            class={className()}
            classList={local.classList}
            style={{
                background: resolveColor(local.color) || getVarCss("border"),
                ...(typeof local.style === "object" ? local.style : {}),
            }}
        />
    );
}
