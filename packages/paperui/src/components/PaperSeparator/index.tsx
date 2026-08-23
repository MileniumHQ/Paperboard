import styles from "./index.module.css";
import { splitProps, type JSX } from "solid-js";

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
        [
            styles.PaperSeparator,
            isVertical() ? styles.vertical : styles.horizontal,
            local.class,
        ]
            .filter(Boolean)
            .join(" ");

    return <span {...rest} class={className()} classList={local.classList} />;
}
