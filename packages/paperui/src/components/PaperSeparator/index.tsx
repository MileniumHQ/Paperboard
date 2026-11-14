import styles from "./index.module.css";
import { splitProps, type JSX } from "solid-js";
import { cx } from "../../utils/cx";

export interface PaperSeparatorProps extends JSX.HTMLAttributes<HTMLSpanElement> {
    direction?: "horizontal" | "vertical";
    orientation?: "horizontal" | "vertical";
    vertical?: boolean;
}

export function PaperSeparator(props: PaperSeparatorProps) {
    const [local, rest] = splitProps(props, [
        "direction",
        "orientation",
        "vertical",
        "class",
        "classList",
    ]);

    const isVertical = () =>
        Boolean(local.vertical) ||
        local.direction === "vertical" ||
        local.orientation === "vertical";

    const className = () =>
        cx(
            styles.PaperSeparator,
            isVertical() ? styles.vertical : styles.horizontal,
            local.class,
        );

    return <span {...rest} class={className()} classList={local.classList} />;
}
