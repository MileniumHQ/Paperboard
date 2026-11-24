import { splitProps, type JSX } from "solid-js";
import { Dynamic } from "solid-js/web";
import { cx } from "../../utils/cx";
import { defineMarketingText } from "../elements/marketingText";
// the tokens, grain and fonts every marketing component draws with; imported
// here, not only from the index, so a bundler that skips the index keeps them
import "../marketing.css";
import styles from "./index.module.css";

declare module "solid-js" {
    namespace JSX {
        interface IntrinsicElements {
            // set as attributes: the element renders from them, on the server too
            "marketing-text": JSX.HTMLAttributes<HTMLElement> & { "attr:text"?: string; "attr:size"?: string; "attr:fluid"?: "" };
        }
    }
}

defineMarketingText();

export interface MarketingTextProps extends Omit<JSX.HTMLAttributes<HTMLElement>, "children"> {
    /** The words. */
    text: string;
    /** Font size in pixels; the shadows and grain scale with it. */
    size: number;
    /** The element that carries the words, for headings. A span when unset. */
    as?: "h1" | "h2" | "h3" | "p" | "span";
    /** The page sets the font size instead (`size` still scales the shadows), so a heading's wrapped lines share one size. */
    fluid?: boolean;
}

/**
 * Paperboard's display lettering: white Nunito, pressed into the page with
 * an accent-tinted inner edge, a soft drop and the paper grain. It draws the
 * <marketing-text> element, which a page without Solid uses directly.
 */
export function MarketingText(props: MarketingTextProps) {
    const [local, rest] = splitProps(props, ["text", "size", "as", "fluid", "class"]);
    return (
        <Dynamic component={local.as ?? "span"} {...rest} class={cx(styles.text, local.class)}>
            <marketing-text attr:text={local.text} attr:size={String(local.size)} attr:fluid={local.fluid ? "" : undefined}>
                {local.text}
            </marketing-text>
        </Dynamic>
    );
}
