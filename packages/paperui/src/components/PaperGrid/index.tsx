import { getVarCss, resolveSize } from "../../utils/theme";
import type { PaperSize } from "../../types";
import styles from "./index.module.css";
import { splitProps, type JSX, type ParentProps } from "solid-js";
import { mergeStyle } from "../../utils/style";
import { cx } from "../../utils/cx";

export interface PaperGridProps extends JSX.HTMLAttributes<HTMLDivElement> {
    /** minimum column width, a size token; defaults to the shared grid token */
    min?: PaperSize | (string & {});
    /** fixed column count instead of an auto-fill track */
    columns?: number;
    /**
     * Auto-fit instead of auto-fill: when there are fewer items than columns
     * fit, they stretch to share the whole row instead of leaving empty
     * columns at its end. Ignored with columns.
     */
    fit?: boolean;
}

/**
 * Responsive grid without per-panel inline styles. Auto-fill by default,
 * auto-fit or fixed columns when asked.
 */
export function PaperGrid(props: ParentProps<PaperGridProps>) {
    const [local, rest] = splitProps(props, [
        "min",
        "columns",
        "fit",
        "class",
        "classList",
        "style",
        "children",
    ]);

    const className = () =>
        cx(styles.PaperGrid, local.class);

    const gridStyle = () => mergeStyle(
        {
            "grid-template-columns": local.columns
                ? `repeat(${local.columns}, minmax(0, 1fr))`
                : `repeat(${local.fit ? "auto-fit" : "auto-fill"}, minmax(${local.min ? resolveSize(local.min) : getVarCss("grid-min")}, 1fr))`,
        },
        local.style,
    );

    return (
        <div
            {...rest}
            class={className()}
            classList={local.classList}
            style={gridStyle()}
        >
            {local.children}
        </div>
    );
}
