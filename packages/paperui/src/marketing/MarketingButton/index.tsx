import { splitProps, type JSX, type ParentProps } from "solid-js";
import { Dynamic } from "solid-js/web";
import { cx } from "../../utils/cx";
// the tokens, grain and fonts every marketing component draws with; imported
// here, not only from the index, so a bundler that skips the index keeps them
import "../marketing.css";
import styles from "./index.module.css";

export type MarketingButtonVariant = "brand" | "black" | "text";

export interface MarketingButtonProps {
    /** brand: the surface's accent. black: ink. text: the words alone, for a quieter way on. */
    variant?: MarketingButtonVariant;
    size?: "medium" | "large";
    /** When set, the button is a link. */
    href?: string;
    target?: JSX.AnchorHTMLAttributes<HTMLAnchorElement>["target"];
    rel?: string;
    disabled?: boolean;
    onClick?: (e: MouseEvent) => void;
    class?: string;
    "aria-label"?: string;
    /** data attributes land on the link or button itself, for a page's own script */
    [data: `data-${string}`]: string | undefined;
}

/** A raised paper button for Paperboard's own pages. Icons (svg or img) sit beside the label. */
export function MarketingButton(props: ParentProps<MarketingButtonProps>) {
    const [local, rest] = splitProps(props, ["variant", "size", "href", "target", "rel", "disabled", "onClick", "class", "children"]);
    const variant = () => local.variant ?? "brand";
    // a disabled link drops its href: without one it is not a link, so it
    // can't be followed or focused, and aria-disabled says why
    const inertLink = () => Boolean(local.href && local.disabled);
    return (
        <span
            class={cx(
                styles.effect,
                variant() === "black" && styles.black,
                variant() === "text" && styles.text,
                local.disabled && styles.disabled,
                local.class,
            )}
        >
            <Dynamic
                component={local.href ? "a" : "button"}
                {...rest}
                type={local.href ? undefined : "button"}
                href={inertLink() ? undefined : local.href}
                target={local.target}
                rel={local.rel}
                disabled={local.href ? undefined : local.disabled}
                aria-disabled={inertLink() ? "true" : undefined}
                onClick={local.onClick}
                class={cx(styles.button, styles.icons, local.size === "large" ? styles.large : styles.medium)}
            >
                {local.children}
            </Dynamic>
        </span>
    );
}
