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
    /** stretches across its container, like PaperInput's fullWidth */
    fullWidth?: boolean;
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
        "fullWidth",
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
        "onClick",
    ]);

    // a disabled anchor drops its href: without one it is not a link, so it
    // cannot be followed, focused, or clicked into its handler
    const inertLink = () => Boolean(local.href && local.disabled);

    const className = () =>
        [
            styles.PaperButton,
            styles[`size-${local.size ?? "medium"}`],
            local.variant === "text" ? styles.text : "",
            local.variant === "outline" ? styles.outline : "",
            local.disabled ? styles.disabled : "",
            local.icon ? styles.icon : "",
            local.fullWidth ? styles.fullWidth : "",
            local.class,
        ]
            .filter(Boolean)
            .join(" ");

    const roleStyle = () =>
        local.variant && isPaperRole(local.variant)
            ? roleVars(local.variant)
            : {};

    // an icon button's glyph is ligature text, never its name: the name is
    // aria-label, or the title the button already shows on hover
    const ariaLabel = () => props["aria-label"] ?? (local.icon ? props.title : undefined);

    return (
        <Dynamic
            component={local.href ? "a" : "button"}
            type={local.href ? undefined : (local.type ?? "button")}
            href={inertLink() ? undefined : local.href}
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
            aria-disabled={inertLink() ? "true" : undefined}
            onClick={inertLink() ? undefined : local.onClick}
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
