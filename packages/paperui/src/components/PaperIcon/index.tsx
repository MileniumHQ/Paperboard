import styles from "./index.module.css";
import { splitProps, Show, type JSX } from "solid-js";

export interface PaperIconProps extends JSX.HTMLAttributes<HTMLSpanElement> {
    zeroHeight?: boolean;
    monogram?: boolean;
    src?: string;
    alt?: string;
}

export function PaperIcon(props: PaperIconProps) {
    const [local, rest] = splitProps(props, [
        "zeroHeight",
        "monogram",
        "src",
        "alt",
        "class",
        "classList",
        "children",
    ]);

    const className = () =>
        [
            styles.PaperIcon,
            local.zeroHeight ? styles.zeroHeight : "",
            local.monogram ? styles.monogram : "",
            local.class,
        ]
            .filter(Boolean)
            .join(" ");

    return (
        <span {...rest} class={className()} classList={local.classList}>
            <Show when={local.src} fallback={local.children}>
                <img
                    src={local.src}
                    alt={local.alt ?? ""}
                    class={styles.iconImage}
                />
            </Show>
        </span>
    );
}
