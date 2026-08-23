import styles from "./index.module.css";
import { splitProps, type JSX } from "solid-js";

export interface PaperButtonProps extends JSX.ButtonHTMLAttributes<HTMLButtonElement> {
    icon?: boolean;
    compact?: boolean;
    tiny?: boolean;
    variant?: "blue" | "green" | "yellow" | "red" | "brand" | "text";
    ref?: HTMLButtonElement | ((el: HTMLButtonElement) => void);
}

export function PaperButton(props: PaperButtonProps) {
    const [local, rest] = splitProps(props, [
        "icon",
        "compact",
        "tiny",
        "variant",
        "disabled",
        "class",
        "classList",
        "children",
        "type",
        "ref",
    ]);

    const className = () =>
        [
            styles.PaperButton,
            local.variant ? styles[local.variant] : "",
            local.compact ? styles.compact : "",
            local.tiny ? styles.tiny : "",
            local.disabled ? styles.disabled : "",
            local.icon ? styles.icon : "",
            local.class,
        ]
            .filter(Boolean)
            .join(" ");

    const ariaLabel = () =>
        props["aria-label"] ?? (local.icon && typeof props.children === "string" ? props.children : undefined);

    return (
        <button
            type={local.type ?? "button"}
            {...rest}
            ref={local.ref}
            class={className()}
            classList={local.classList}
            disabled={local.disabled}
            aria-label={ariaLabel()}
        >
            {local.children}
        </button>
    );
}
