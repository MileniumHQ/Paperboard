import styles from "./index.module.css";
import { splitProps, Show, type JSX, type ParentProps } from "solid-js";
import { PaperIcon } from "../PaperIcon";
import { PaperText } from "../PaperText";

export type PaperQuoteVariant =
    | "monochrome"
    | "blue"
    | "green"
    | "yellow"
    | "red"
    | "brand";

export interface PaperQuoteProps extends Omit<JSX.HTMLAttributes<HTMLDivElement>, "title"> {
    variant?: PaperQuoteVariant;
    icon?: JSX.Element | string;
    title?: JSX.Element | string;
}

export function PaperQuote(props: ParentProps<PaperQuoteProps>) {
    const [local, rest] = splitProps(props, [
        "variant",
        "icon",
        "title",
        "class",
        "classList",
        "children",
    ]);

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
            case "brand":
                return styles.variantBrand;
            case "monochrome":
            default:
                return styles.variantMonochrome;
        }
    };

    return (
        <div
            {...rest}
            class={[styles.PaperQuote, variantClass(), local.class]
                .filter(Boolean)
                .join(" ")}
            classList={local.classList}
        >
            <Show when={local.icon}>
                <div class={styles.quoteIcon}>
                    {typeof local.icon === "string" ? (
                        <PaperIcon>{local.icon}</PaperIcon>
                    ) : (
                        local.icon
                    )}
                </div>
            </Show>

            <div class={styles.quoteContent}>
                <Show when={local.title}>
                    <PaperText class={styles.quoteTitle} size={3} weight={700}>
                        {local.title}
                    </PaperText>
                </Show>
                <PaperText size={2} weight={500}>
                    {local.children}
                </PaperText>
            </div>
        </div>
    );
}
