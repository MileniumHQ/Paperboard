import styles from "./index.module.css";
import { splitProps, type JSX } from "solid-js";
import { roleVars, isPaperRole } from "../../utils/colors";
import type { PaperButtonVariant } from "../../types";

export type PaperButtonSize = "tiny" | "small" | "medium" | "large";

export interface PaperButtonProps extends JSX.ButtonHTMLAttributes<HTMLButtonElement> {
    icon?: boolean;
    /** medium is the default; tiny is a low-emphasis control */
    size?: PaperButtonSize;
    variant?: PaperButtonVariant;
    ref?: HTMLButtonElement | ((el: HTMLButtonElement) => void);
}

export function PaperButton(props: PaperButtonProps) {
    const [local, rest] = splitProps(props, [
        "icon",
        "size",
        "variant",
        "disabled",
        "class",
        "classList",
        "children",
        "type",
        "ref",
        "style",
    ]);

    const className = () =>
        [
            styles.PaperButton,
            styles[`size-${local.size ?? "medium"}`],
            local.variant === "text" ? styles.text : "",
            local.disabled ? styles.disabled : "",
            local.icon ? styles.icon : "",
            local.class,
        ]
            .filter(Boolean)
            .join(" ");

    const roleStyle = () =>
        local.variant && isPaperRole(local.variant)
            ? roleVars(local.variant)
            : {};

    const ariaLabel = () =>
        props["aria-label"] ?? (local.icon && typeof props.children === "string" ? props.children : undefined);

    return (
        <button
            type={local.type ?? "button"}
            {...rest}
            ref={local.ref}
            class={className()}
            classList={local.classList}
            style={{
                ...roleStyle(),
                ...(typeof local.style === "object" ? local.style : {}),
            }}
            disabled={local.disabled}
            aria-label={ariaLabel()}
        >
            {local.children}
        </button>
    );
}
