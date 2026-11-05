import styles from "./index.module.css";
import { splitProps, Show, type JSX } from "solid-js";
import type { PaperColor } from "../../types";
import { resolveColor } from "../../utils/theme";

export interface PaperIconProps extends JSX.HTMLAttributes<HTMLSpanElement> {
    zeroHeight?: boolean;
    monogram?: boolean;
    src?: string;
    alt?: string;
    /**
     * draw `src` as a stencil, for one-color logos: in the current text
     * color, or in the color named. A logo inside a control that colors its
     * icons (a PaperSelectorItem's are the primary color) names "text" to
     * stay the brand's single color.
     */
    tint?: boolean | PaperColor;
    /** keep pixel art crisp when `src` is scaled up */
    pixelated?: boolean;
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
        "tint",
        "pixelated",
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
                {(src) => (
                    <Show
                        when={local.tint}
                        fallback={
                            <img
                                src={src()}
                                alt={local.alt ?? ""}
                                class={[styles.iconImage, local.pixelated ? styles.pixelated : ""]
                                    .filter(Boolean)
                                    .join(" ")}
                            />
                        }
                    >
                        {/* the image's alpha cut out of the text color */}
                        <span
                            class={[styles.iconImage, styles.tint].join(" ")}
                            style={{
                                "--paper-icon-mask": `url(${JSON.stringify(src())})`,
                                "background-color": typeof local.tint === "string" ? resolveColor(local.tint) : undefined,
                            }}
                        />
                    </Show>
                )}
            </Show>
        </span>
    );
}
