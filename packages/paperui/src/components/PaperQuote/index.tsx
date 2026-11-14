import styles from "./index.module.css";
import { children, splitProps, Show, type JSX, type ParentProps } from "solid-js";
import { PaperIcon } from "../PaperIcon";
import { PaperText } from "../PaperText";
import { PaperButton } from "../PaperButton";
import { roleVars, isPaperRole } from "../../utils/colors";
import type { PaperRole } from "../../types";
import { cx } from "../../utils/cx";

export type PaperQuoteVariant = "monochrome" | PaperRole;

export interface PaperQuoteProps extends Omit<JSX.HTMLAttributes<HTMLDivElement>, "title"> {
    variant?: PaperQuoteVariant;
    icon?: JSX.Element | string;
    title?: JSX.Element | string;
    /** shows a close button: for a notice that outlives the moment it reports */
    onDismiss?: () => void;
}

export function PaperQuote(props: ParentProps<PaperQuoteProps>) {
    const [local, rest] = splitProps(props, [
        "variant",
        "icon",
        "title",
        "onDismiss",
        "class",
        "classList",
        "children",
    ]);

    const icon = children(() => local.icon);
    const title = children(() => local.title);

    const variantClass = () =>
        isPaperRole(local.variant)
            ? styles.variantRole
            : styles.variantMonochrome;

    const roleStyle = () =>
        isPaperRole(local.variant) ? roleVars(local.variant) : {};

    return (
        <div
            {...rest}
            class={cx(styles.PaperQuote, variantClass(), local.class)}
            classList={local.classList}
            style={roleStyle()}
        >
            <Show when={icon()}>
                <div class={styles.quoteIcon}>
                    {typeof icon() === "string" ? <PaperIcon>{icon()}</PaperIcon> : icon()}
                </div>
            </Show>

            <div class={styles.quoteContent}>
                <Show when={title()}>
                    <PaperText class={styles.quoteTitle} size={3} weight={700}>
                        {title()}
                    </PaperText>
                </Show>
                {/* errors quote paths and URLs, so long words wrap */}
                <PaperText size={2} weight={500} breakWord>
                    {local.children}
                </PaperText>
            </div>
            <Show when={local.onDismiss}>
                {(dismiss) => (
                    <PaperButton
                        size="tiny"
                        variant="text"
                        icon
                        class={styles.dismiss}
                        aria-label="Dismiss"
                        title="Dismiss"
                        onClick={() => dismiss()()}
                    >
                        <PaperIcon>close</PaperIcon>
                    </PaperButton>
                )}
            </Show>
        </div>
    );
}
