import styles from "./index.module.css";
import { splitProps, type JSX, type ParentProps } from "solid-js";
import { resolveSpacing } from "../../utils/theme";
import {
    resolveLayoutStyles,
    usePaperLayout,
    type PaperLayoutProps,
} from "../../contexts/layout";
import type { PaperSpacing } from "../../types";

export type PaperPageWidth = "standard" | "wide" | "full";

export interface PaperPageProps
    extends JSX.HTMLAttributes<HTMLDivElement>,
        PaperLayoutProps {
    /** column width; standard keeps content readable at 62rem */
    width?: PaperPageWidth;
    padding?: PaperSpacing;
    gap?: PaperSpacing;
}

/**
 * The centered content column used inside a page-variant interface item.
 * Replaces the per-panel `.page` class: full width up to a token, padded,
 * gapped, and centered.
 */
export function PaperPage(props: ParentProps<PaperPageProps>) {
    const layoutCtx = usePaperLayout();
    const [local, rest] = splitProps(props, [
        "width",
        "padding",
        "gap",
        "class",
        "classList",
        "style",
        "children",
        "flex",
        "shrink",
        "grow",
        "minWidth",
        "minHeight",
        "maxWidth",
        "maxHeight",
        "fullWidth",
        "fullHeight",
        "scrollable",
        "overflow",
        "overflowX",
        "overflowY",
    ]);

    const className = () =>
        [
            styles.PaperPage,
            local.width ? styles[local.width] : "",
            local.class,
        ]
            .filter(Boolean)
            .join(" ");

    const pageStyle = () => ({
        ...resolveLayoutStyles(local, layoutCtx),
        padding: resolveSpacing(local.padding ?? "full"),
        gap: resolveSpacing(local.gap ?? "full"),
        ...(typeof local.style === "object" ? local.style : {}),
    });

    return (
        <div {...rest} class={className()} classList={local.classList} style={pageStyle()}>
            {local.children}
        </div>
    );
}
