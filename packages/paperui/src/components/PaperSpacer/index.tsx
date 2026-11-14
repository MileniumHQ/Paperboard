import styles from "./index.module.css";
import { splitProps, type JSX } from "solid-js";
import type { PaperSpacing } from "../../types";
import { resolveSpacing } from "../../utils/theme";
import { mergeStyle } from "../../utils/style";

export interface PaperSpacerProps extends JSX.HTMLAttributes<HTMLDivElement> {
    size?: PaperSpacing;
    direction?: "horizontal" | "vertical";
}

export function PaperSpacer(props: PaperSpacerProps) {
    const [local, rest] = splitProps(props, [
        "size",
        "direction",
        "class",
        "classList",
        "style",
    ]);

    const style = () => {
        if (local.size === undefined) return local.style;
        const sizeStr = resolveSpacing(local.size);
        return mergeStyle(
            {
                "--spacer-size": sizeStr,
            },
            local.style,
        );
    };

    const className = () =>
        [
            styles.PaperSpacer,
            local.direction ? styles[local.direction] : "",
            local.class,
        ]
            .filter(Boolean)
            .join(" ");

    return (
        <div
            {...rest}
            class={className()}
            classList={local.classList}
            style={style()}
        />
    );
}
