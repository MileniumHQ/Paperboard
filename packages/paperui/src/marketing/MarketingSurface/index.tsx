import { splitProps, type JSX, type ParentProps } from "solid-js";
import { cx } from "../../utils/cx";
import { mergeStyle } from "../../utils/style";
// the tokens, grain and fonts every marketing component draws with; imported
// here, not only from the index, so a bundler that skips the index keeps them
import "../marketing.css";
import styles from "./index.module.css";

export interface MarketingSurfaceProps extends JSX.HTMLAttributes<HTMLDivElement> {
    /** The colour the surface is made of; any CSS colour. PaperUI's primary when unset. */
    accent?: string;
    /** How far the surface sinks toward the ink, from 0 to 1. Changes glide. */
    depth?: number;
    /** Fill the viewport (a full-screen page) instead of the parent. */
    viewport?: boolean;
}

/**
 * The backdrop of Paperboard's own pages: the accent, deepening downward,
 * under the paper grain. Every marketing component inside takes its tones
 * from the surface's accent, so changing it recolours the page.
 */
export function MarketingSurface(props: ParentProps<MarketingSurfaceProps>) {
    const [local, rest] = splitProps(props, ["accent", "depth", "viewport", "class", "style", "children"]);
    const vars = (): JSX.CSSProperties => ({
        "--marketing-accent": local.accent,
        "--marketing-depth": local.depth === undefined ? undefined : String(Math.min(1, Math.max(0, local.depth))),
    });
    return (
        <div
            {...rest}
            class={cx(styles.surface, local.viewport && styles.viewport, local.class)}
            style={mergeStyle(vars(), local.style)}
        >
            <div class={styles.content}>{local.children}</div>
        </div>
    );
}
