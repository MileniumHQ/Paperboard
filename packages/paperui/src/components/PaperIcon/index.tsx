import styles from "./index.module.css";
import { splitProps, Show, type JSX } from "solid-js";

export interface PaperIconProps extends JSX.HTMLAttributes<HTMLSpanElement> {
    zeroHeight?: boolean;
    monogram?: boolean;
    src?: string;
    alt?: string;
    /**
     * What the icon means, for an icon that carries information no nearby
     * text does. Without it the icon is decorative and hidden from
     * assistive technology: a symbol's ligature text ("content_copy") is a
     * font trick, not a name, and must never be read out or become part of
     * a control's accessible name.
     */
    label?: string;
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
        "label",
    ]);

    // explicit aria-* from the caller (in rest) still win
    const semantics = () =>
        local.label
            ? { role: "img" as const, "aria-label": local.label }
            : { "aria-hidden": "true" as const };

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
        <span {...semantics()} {...rest} class={className()} classList={local.classList}>
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
