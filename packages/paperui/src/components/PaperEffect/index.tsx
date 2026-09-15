import styles from "./index.module.css";
import { splitProps, type JSX } from "solid-js";
import { roleVars, isPaperRole } from "../../utils/colors";
import type { PaperRole } from "../../types";

export interface PaperEffectProps extends JSX.HTMLAttributes<HTMLDivElement> {
    colorless?: boolean;
    variant?: PaperRole;
    disabled?: boolean;
}

export function PaperEffect(props: PaperEffectProps) {
    const [local, rest] = splitProps(props, [
        "colorless",
        "variant",
        "disabled",
        "class",
        "classList",
        "children",
        "style",
    ]);

    const isColorless = () => local.colorless || local.disabled;

    const roleStyle = () =>
        local.variant && isPaperRole(local.variant)
            ? roleVars(local.variant)
            : {};

    const className = () =>
        [
            styles.PaperEffect,
            isColorless() ? styles.colorless : "",
            local.disabled ? styles.disabled : "",
            local.class,
        ]
            .filter(Boolean)
            .join(" ");

    return (
        <div
            {...rest}
            class={className()}
            classList={local.classList}
            style={roleStyle()}
        >
            {local.children}
        </div>
    );
}
