import styles from "./index.module.css";
import { splitProps, Show, type JSX } from "solid-js";
import { PaperIcon } from "../PaperIcon";
import { roleVars, isPaperRole } from "../../utils/colors";
import type { PaperRole } from "../../types";

export type PaperAvatarSize = "small" | "medium" | "large" | "xlarge";

export interface PaperAvatarProps extends JSX.HTMLAttributes<HTMLSpanElement> {
    src?: string;
    alt?: string;
    size?: PaperAvatarSize;
    /** square: rounded tiles for app and plugin icons; sharp: square corners
     * for art that draws its own edge, such as pixel art */
    shape?: "circle" | "square" | "sharp";
    /** material icon shown when src is missing or fails */
    fallbackIcon?: string;
    /** tint the fallback chip with a semantic role (the active item of a set) */
    accent?: PaperRole;
    /** makes the avatar a button: hovering darkens it under an edit glyph */
    onEdit?: () => void;
    /** the edit button's accessible name and tooltip */
    editLabel?: string;
}

/**
 * An avatar: image when available, icon on a surface chip when not. The chip
 * background belongs to the fallback glyph only — an image avatar is drawn on
 * a transparent background so its own pixels (and any transparency) show.
 */
export function PaperAvatar(props: PaperAvatarProps) {
    const [local, rest] = splitProps(props, [
        "src",
        "alt",
        "size",
        "shape",
        "fallbackIcon",
        "accent",
        "onEdit",
        "editLabel",
        "class",
        "classList",
        "style",
    ]);

    const className = () =>
        [
            styles.PaperAvatar,
            styles[local.size ?? "medium"],
            local.shape === "square" ? styles.square : "",
            local.shape === "sharp" ? styles.sharp : "",
            local.src ? "" : styles.chip,
            !local.src && local.accent ? styles.accent : "",
            local.onEdit ? styles.editable : "",
            local.class,
        ]
            .filter(Boolean)
            .join(" ");

    return (
        <span
            {...rest}
            class={className()}
            classList={local.classList}
            style={{
                ...(isPaperRole(local.accent) ? roleVars(local.accent) : {}),
                ...(typeof local.style === "object" ? local.style : {}),
            }}
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
            <Show when={local.onEdit}>
                {(onEdit) => (
                    <button
                        type="button"
                        class={styles.edit}
                        title={local.editLabel || "Edit"}
                        aria-label={local.editLabel || "Edit"}
                        onClick={() => onEdit()()}
                    >
                        <PaperIcon>edit</PaperIcon>
                    </button>
                )}
            </Show>
        </span>
    );
}
