import styles from "./index.module.css";
import { splitProps, Show, type JSX, type ParentProps } from "solid-js";
import { PaperIcon } from "../PaperIcon";
import { PaperText } from "../PaperText";
import { roleVars, isPaperRole } from "../../utils/colors";
import type { PaperRole } from "../../types";

export type PaperQuoteVariant = "monochrome" | PaperRole;

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

    const variantClass = () =>
        isPaperRole(local.variant)
            ? styles.variantRole
            : styles.variantMonochrome;

    const roleStyle = () =>
        isPaperRole(local.variant) ? roleVars(local.variant) : {};

    return (
        <div
            {...rest}
            class={[styles.PaperQuote, variantClass(), local.class]
                .filter(Boolean)
                .join(" ")}
            classList={local.classList}
            style={roleStyle()}
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
