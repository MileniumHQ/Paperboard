import styles from "./index.module.css";
import { splitProps, type JSX } from "solid-js";
import { Dynamic } from "solid-js/web";
import { roleVars, isPaperRole } from "../../utils/colors";
import { PaperIcon } from "../PaperIcon";
import type { PaperButtonVariant } from "../../types";

export type PaperButtonSize = "tiny" | "small" | "medium" | "large";

export interface PaperButtonProps extends JSX.ButtonHTMLAttributes<HTMLButtonElement> {
    icon?: boolean;
    /** medium is the default; large is the hero CTA, tiny a low-emphasis control */
    size?: PaperButtonSize;
    variant?: PaperButtonVariant;
    ref?: HTMLButtonElement | ((el: HTMLButtonElement) => void);
    /** When set, renders an anchor styled as a button instead of a button. */
    href?: string;
    target?: JSX.AnchorHTMLAttributes<HTMLAnchorElement>["target"];
    rel?: string;
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
        "href",
        "target",
        "rel",
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
        <Dynamic
            component={local.href ? "a" : "button"}
            type={local.href ? undefined : (local.type ?? "button")}
            href={local.href}
            target={local.target}
            rel={local.rel}
            {...rest}
            ref={local.ref}
            class={className()}
            classList={local.classList}
            style={{
                ...roleStyle(),
                ...(typeof local.style === "object" ? local.style : {}),
            }}
            disabled={local.href ? undefined : local.disabled}
            aria-label={ariaLabel()}
        >
            {local.icon && typeof local.children === "string" ? (
                <PaperIcon>{local.children}</PaperIcon>
            ) : (
                local.children
            )}
        </Dynamic>
    );
}
