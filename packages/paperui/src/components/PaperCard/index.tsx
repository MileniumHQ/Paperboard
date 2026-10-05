import styles from "./index.module.css";
import { splitProps, type JSX, type ParentProps } from "solid-js";
import { resolveSpacing } from "../../utils/theme";
import { roleVars, isPaperRole } from "../../utils/colors";
import {
    resolveLayoutStyles,
    usePaperLayout,
    type PaperLayoutProps,
} from "../../contexts/layout";
import type { PaperSpacing, PaperRole } from "../../types";

/** surface tone; front is the standard panel card */
export type PaperCardSurface =
    | "front"
    | "frontest"
    | "back"
    | "element"
    | "transparent";

export interface PaperCardProps
    extends JSX.HTMLAttributes<HTMLDivElement>,
        PaperLayoutProps {
    surface?: PaperCardSurface;
    padding?: PaperSpacing;
    paddingX?: PaperSpacing;
    paddingY?: PaperSpacing;
    gap?: PaperSpacing;
    borderless?: boolean;
    /** round the corners only, without a surface tone */
    plain?: boolean;
    /** tint the surface and border with a semantic role (danger zones, alerts) */
    accent?: PaperRole;
}

/**
 * The panel surface: bordered, rounded, clipped. Replaces per-panel surface
 * classes and PaperContainer. Padding and gap take the same spacing tokens
 * as PaperFlex.
 */
export function PaperCard(props: ParentProps<PaperCardProps>) {
    const layoutCtx = usePaperLayout();
    const [local, rest] = splitProps(props, [
        "surface",
        "padding",
        "paddingX",
        "paddingY",
        "gap",
        "borderless",
        "plain",
        "accent",
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
            styles.PaperCard,
            local.surface ? styles[local.surface] : "",
            local.borderless ? styles.borderless : "",
            local.plain ? styles.plain : "",
            local.accent ? styles.accent : "",
            local.class,
        ]
            .filter(Boolean)
            .join(" ");

    const cardStyle = () => {
        const axisPadding =
            local.paddingX !== undefined || local.paddingY !== undefined;
        const paddingX = resolveSpacing(local.paddingX ?? local.padding);
        const paddingY = resolveSpacing(local.paddingY ?? local.padding);
        return {
            // a growing card must also be able to shrink, or it overflows
            ...(local.grow && local.shrink === undefined ? { "flex-shrink": 1 } : {}),
            ...(isPaperRole(local.accent) ? roleVars(local.accent) : {}),
            ...resolveLayoutStyles(local, layoutCtx),
            ...(axisPadding
                ? {
                      "padding-left": paddingX,
                      "padding-right": paddingX,
                      "padding-top": paddingY,
                      "padding-bottom": paddingY,
                  }
                : { padding: resolveSpacing(local.padding) }),
            gap: resolveSpacing(local.gap),
            ...(typeof local.style === "object" ? local.style : {}),
        };
    };

    return (
        <div
            {...rest}
            class={className()}
            classList={local.classList}
            style={cardStyle()}
        >
            {local.children}
        </div>
    );
}
