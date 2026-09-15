import styles from "./index.module.css";
import { splitProps, Show, type JSX } from "solid-js";
import { PaperIcon } from "../PaperIcon";

export type PaperAvatarSize = "small" | "medium" | "large" | "xlarge";

export interface PaperAvatarProps extends JSX.HTMLAttributes<HTMLSpanElement> {
    src?: string;
    alt?: string;
    size?: PaperAvatarSize;
    /** square tiles for app and plugin icons */
    shape?: "circle" | "square";
    /** material icon shown when src is missing or fails */
    fallbackIcon?: string;
}

/** A square avatar: image when available, icon chip when not. */
export function PaperAvatar(props: PaperAvatarProps) {
    const [local, rest] = splitProps(props, [
        "src",
        "alt",
        "size",
        "shape",
        "fallbackIcon",
        "class",
        "classList",
        "style",
    ]);

    const className = () =>
        [
            styles.PaperAvatar,
            styles[local.size ?? "medium"],
            local.shape === "square" ? styles.square : "",
            local.class,
        ]
            .filter(Boolean)
            .join(" ");

    return (
        <span
            {...rest}
            class={className()}
            classList={local.classList}
            style={typeof local.style === "object" ? local.style : {}}
        >
            <Show
                when={local.src}
                fallback={
                    <PaperIcon class={styles.fallback}>
                        {local.fallbackIcon || "person"}
                    </PaperIcon>
                }
            >
                <img src={local.src} alt={local.alt || ""} class={styles.image} />
            </Show>
        </span>
    );
}
