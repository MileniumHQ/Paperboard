import styles from "./index.module.css";
import { splitProps, Show, children, type JSX } from "solid-js";
import { PaperIcon } from "../PaperIcon";
import { resolveColor } from "../../utils/theme";
import { mergeStyle } from "../../utils/style";
import { cx } from "../../utils/cx";
import type { PaperColor } from "../../types";

export interface PaperColorChipProps
    extends Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, "children" | "color"> {
    /** the fill: a color token ("success") or any CSS color */
    color: PaperColor;
    /** the picked one, ringed in the action color */
    selected?: boolean;
    /** a glyph on the fill */
    icon?: JSX.Element | string;
    /** text on the fill, which turns the circle into a pill */
    children?: JSX.Element;
}

/**
 * A color to pick: a filled circle, ringed when it's the selected one. An
 * icon or text sits on the fill, and text makes it a pill. Renders a real
 * button; one with only a color needs an `aria-label` naming it.
 */
export function PaperColorChip(props: PaperColorChipProps) {
    const [local, rest] = splitProps(props, [
        "color",
        "selected",
        "icon",
        "disabled",
        "type",
        "class",
        "classList",
        "style",
        "children",
    ]);

    const icon = children(() => local.icon);
    const label = children(() => local.children);

    const className = () =>
        cx(
            styles.PaperColorChip,
            label() ? styles.pill : "",
            local.selected ? styles.selected : "",
            local.disabled ? styles.disabled : "",
            local.class,
        );

    return (
        <button
            {...rest}
            type={local.type ?? "button"}
            class={className()}
            classList={local.classList}
            style={mergeStyle({ background: resolveColor(local.color) }, local.style)}
            disabled={local.disabled}
            aria-pressed={local.selected === true ? "true" : "false"}
        >
            <Show when={icon()}>
                {typeof icon() === "string" ? <PaperIcon zeroHeight>{icon()}</PaperIcon> : icon()}
            </Show>
            {label()}
        </button>
    );
}
