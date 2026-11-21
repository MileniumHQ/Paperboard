import { Show, children, splitProps, type JSX } from "solid-js";
import { Dynamic } from "solid-js/web";
import { cx } from "../../utils/cx";
// the tokens, grain and fonts every marketing component draws with; imported
// here, not only from the index, so a bundler that skips the index keeps them
import "../marketing.css";
import styles from "./index.module.css";

export interface MarketingCardProps {
    /** A screenshot's address, cut to a wide strip across the top. */
    banner?: string;
    /** A picture's address, drawn bare (no frame) above the title; under a banner it sits on the banner's edge. */
    icon?: string;
    title: string;
    subtitle?: string;
    /** Kept to two lines, and two lines tall when shorter, so a set of cards stands even. */
    description?: string | JSX.Element;
    /** The chosen card of a set: its border turns solid. */
    selected?: boolean;
    /** Makes the card a button. */
    onClick?: (e: MouseEvent) => void;
    class?: string;
}

/** A card to choose from on a marketing surface, printed in the surface's own colour. */
export function MarketingCard(props: MarketingCardProps) {
    const [local] = splitProps(props, ["banner", "icon", "title", "subtitle", "description", "selected", "onClick", "class"]);
    const description = children(() => local.description);
    return (
        <div class={cx(styles.effect, local.onClick && styles.interactive, local.selected && styles.selected, local.class)}>
            <Dynamic
                component={local.onClick ? "button" : "div"}
                type={local.onClick ? "button" : undefined}
                aria-pressed={local.onClick ? Boolean(local.selected) : undefined}
                onClick={local.onClick}
                class={styles.card}
            >
                <Show when={local.banner}>{(src) => <img class={styles.banner} src={src()} alt="" />}</Show>
                <span class={styles.body}>
                    <Show when={local.icon}>{(src) => <img class={styles.icon} src={src()} alt="" />}</Show>
                    <span class={styles.title}>{local.title}</span>
                    <Show when={local.subtitle}>{(subtitle) => <span class={styles.subtitle}>{subtitle()}</span>}</Show>
                    <Show when={description()}>{(content) => <span class={styles.description}>{content()}</span>}</Show>
                </span>
            </Dynamic>
        </div>
    );
}
