import styles from "./index.module.css";
import { splitProps, Show, type ParentProps, type JSX } from "solid-js";
import { PaperIcon } from "../PaperIcon";
import type { PaperBadgeVariant } from "../../types";

export interface PaperBadgeProps extends JSX.HTMLAttributes<HTMLSpanElement> {
    variant?: PaperBadgeVariant;
    icon?: JSX.Element | string;
}

export function PaperBadge(props: ParentProps<PaperBadgeProps>) {
    const [local, rest] = splitProps(props, ["variant", "icon", "class", "classList", "children"]);

    const variantClass = () => {
        switch (local.variant) {
            case "blue":
                return styles.variantBlue;
            case "green":
                return styles.variantGreen;
            case "yellow":
                return styles.variantYellow;
            case "red":
                return styles.variantRed;
            case "monochrome":
            default:
                return styles.variantMonochrome;
        }
    };

    return (
        <span
            {...rest}
            class={[styles.PaperBadge, variantClass(), local.class].filter(Boolean).join(" ")}
            classList={local.classList}
        >
            <Show when={local.icon}>
                {typeof local.icon === "string" ? (
                    <PaperIcon zeroHeight>{local.icon}</PaperIcon>
                ) : (
                    local.icon
                )}
            </Show>
            {local.children}
        </span>
    );
}
