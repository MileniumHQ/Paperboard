import styles from "./index.module.css";
import { splitProps, Show, type ParentProps, type JSX } from "solid-js";
import { PaperIcon } from "../PaperIcon";
import { roleVars, isPaperRole } from "../../utils/colors";
import type { PaperBadgeVariant } from "../../types";

export interface PaperBadgeProps extends JSX.HTMLAttributes<HTMLSpanElement> {
    variant?: PaperBadgeVariant;
    icon?: JSX.Element | string;
}

export function PaperBadge(props: ParentProps<PaperBadgeProps>) {
    const [local, rest] = splitProps(props, ["variant", "icon", "class", "classList", "children"]);

    const variantClass = () =>
        isPaperRole(local.variant)
            ? styles.variantRole
            : styles.variantMonochrome;

    const roleStyle = () =>
        isPaperRole(local.variant) ? roleVars(local.variant) : {};

    return (
        <span
            {...rest}
            class={[styles.PaperBadge, variantClass(), local.class].filter(Boolean).join(" ")}
            classList={local.classList}
            style={roleStyle()}
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
