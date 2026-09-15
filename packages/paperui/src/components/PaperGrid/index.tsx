import { getVarCss } from "../../utils/theme";
import styles from "./index.module.css";
import { splitProps, type JSX, type ParentProps } from "solid-js";

export interface PaperGridProps extends JSX.HTMLAttributes<HTMLDivElement> {
    /** minimum column width; defaults to the shared grid token */
    min?: string;
    /** fixed column count instead of an auto-fill track */
    columns?: number;
}

/**
 * Responsive grid without per-panel inline styles. Auto-fill by default,
 * fixed columns when asked.
 */
export function PaperGrid(props: ParentProps<PaperGridProps>) {
    const [local, rest] = splitProps(props, [
        "min",
        "columns",
        "class",
        "classList",
        "style",
        "children",
    ]);

    const className = () =>
        [styles.PaperGrid, local.class].filter(Boolean).join(" ");

    const gridStyle = () => ({
        "grid-template-columns": local.columns
            ? `repeat(${local.columns}, minmax(0, 1fr))`
            : `repeat(auto-fill, minmax(${local.min ?? `${getVarCss("grid-min")}`}, 1fr))`,
        ...(typeof local.style === "object" ? local.style : {}),
    });

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
