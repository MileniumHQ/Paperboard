import { createContext, useContext, type JSX } from "solid-js";

export interface PaperLayoutProps {
    flex?: boolean | number | JSX.CSSProperties["flex"];
    shrink?: boolean | number | JSX.CSSProperties["flex-shrink"];
    grow?: boolean | number | JSX.CSSProperties["flex-grow"];
    minWidth?: JSX.CSSProperties["min-width"] | number;
    minHeight?: JSX.CSSProperties["min-height"] | number;
    maxWidth?: JSX.CSSProperties["max-width"] | number;
    maxHeight?: JSX.CSSProperties["max-height"] | number;
    fullWidth?: boolean;
    fullHeight?: boolean;
    scrollable?: boolean | "x" | "y";
    overflow?: JSX.CSSProperties["overflow"];
    overflowX?: JSX.CSSProperties["overflow-x"];
    overflowY?: JSX.CSSProperties["overflow-y"];
}

export interface PaperLayoutContextValue {
    direction?: "row" | "column" | "row-reverse" | "column-reverse";
    parentIsFlex?: boolean;
}

export const PaperLayoutContext = createContext<PaperLayoutContextValue>();

export function usePaperLayout() {
    return useContext(PaperLayoutContext);
}

export function resolveLayoutStyles(
    props: PaperLayoutProps,
    ctx?: PaperLayoutContextValue,
): JSX.CSSProperties {
    const styles: JSX.CSSProperties = {};

    const isColumn = ctx?.direction === "column" || ctx?.direction === "column-reverse";

    if (props.flex !== undefined) {
        if (props.flex === true) {
            styles.flex = "1 1 0%";
        } else if (props.flex === false) {
            styles.flex = "none";
        } else if (typeof props.flex === "number") {
            styles.flex = `${props.flex} ${props.flex} 0%`;
        } else {
            styles.flex = props.flex;
        }
    }

    if (props.shrink !== undefined) {
        styles["flex-shrink"] =
            typeof props.shrink === "boolean" ? (props.shrink ? 1 : 0) : props.shrink;
    }

    if (props.grow !== undefined) {
        styles["flex-grow"] =
            typeof props.grow === "boolean" ? (props.grow ? 1 : 0) : props.grow;
    }

    if (props.minWidth !== undefined) {
        styles["min-width"] =
            typeof props.minWidth === "number" ? `${props.minWidth}px` : props.minWidth;
    }

    if (props.minHeight !== undefined) {
        styles["min-height"] =
            typeof props.minHeight === "number" ? `${props.minHeight}px` : props.minHeight;
    }

    if (props.maxWidth !== undefined) {
        styles["max-width"] =
            typeof props.maxWidth === "number" ? `${props.maxWidth}px` : props.maxWidth;
    }

    if (props.maxHeight !== undefined) {
        styles["max-height"] =
            typeof props.maxHeight === "number" ? `${props.maxHeight}px` : props.maxHeight;
    }

    if (props.fullWidth) {
        styles.width = "100%";
    }

    if (props.fullHeight) {
        styles.height = "100%";
    }

    if (props.scrollable) {
        if (props.scrollable === "x") {
            styles["overflow-x"] = "auto";
        } else if (props.scrollable === "y") {
            styles["overflow-y"] = "auto";
        } else {
            styles.overflow = "auto";
        }
    }

    if (props.overflow !== undefined) {
        styles.overflow = props.overflow;
    }
    if (props.overflowX !== undefined) {
        styles["overflow-x"] = props.overflowX;
    }
    if (props.overflowY !== undefined) {
        styles["overflow-y"] = props.overflowY;
    }

    return styles;
}
