import { createContext, useContext, type JSX } from "solid-js";
import type { PaperSize } from "../types";
import { resolveSize } from "../utils/theme";

export interface PaperLayoutProps {
    flex?: boolean | number | JSX.CSSProperties["flex"];
    shrink?: boolean | number | JSX.CSSProperties["flex-shrink"];
    grow?: boolean | number | JSX.CSSProperties["flex-grow"];
    /** min and max sizes take a size token ("field"), or 0 to let a flex
     *  child shrink below its content */
    minWidth?: PaperSize | JSX.CSSProperties["min-width"] | number;
    minHeight?: PaperSize | JSX.CSSProperties["min-height"] | number;
    maxWidth?: PaperSize | JSX.CSSProperties["max-width"] | number;
    maxHeight?: PaperSize | JSX.CSSProperties["max-height"] | number;
    /** a fixed width, always a size token */
    width?: PaperSize;
    /** a fixed height, always a size token */
    height?: PaperSize;
    /** true fills the parent's width; false sizes to content, over a
     *  component's full-width default (a PaperCard beside a growing column) */
    fullWidth?: boolean;
    /** true fills the parent's height; false sizes to content */
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

/** Turns layout props into inline styles. The same props give the same
 *  styles in any parent: nothing here reads the parent's direction. */
export function resolveLayoutStyles(props: PaperLayoutProps): JSX.CSSProperties {
    const styles: JSX.CSSProperties = {};

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
        styles["min-width"] = resolveSize(props.minWidth);
    }

    if (props.minHeight !== undefined) {
        styles["min-height"] = resolveSize(props.minHeight);
    }

    if (props.maxWidth !== undefined) {
        styles["max-width"] = resolveSize(props.maxWidth);
    }

    if (props.maxHeight !== undefined) {
        styles["max-height"] = resolveSize(props.maxHeight);
    }

    if (props.width !== undefined) {
        styles.width = resolveSize(props.width);
    }

    if (props.height !== undefined) {
        styles.height = resolveSize(props.height);
    }

    if (props.fullWidth !== undefined) {
        styles.width = props.fullWidth ? "100%" : "auto";
    }

    if (props.fullHeight !== undefined) {
        styles.height = props.fullHeight ? "100%" : "auto";
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
