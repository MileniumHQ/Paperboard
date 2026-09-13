import styles from "./index.module.css";
import { splitProps, Show, type JSX, type ParentProps } from "solid-js";
import { PaperIcon } from "../PaperIcon";
import { PaperText } from "../PaperText";

export interface PaperPageHeaderProps
    extends Omit<JSX.HTMLAttributes<HTMLDivElement>, "title"> {
    /** Icon glyph name or custom element shown in the leading chip. */
    icon?: JSX.Element | string;
    title: JSX.Element | string;
    subtitle?: JSX.Element | string;
}

// One header for a page/tab body: a leading icon chip, title, subtitle, and
// trailing actions. Flat by design — a border and surface, no shadow — so
// it sits at the same depth as the content it introduces.
export function PaperPageHeader(props: ParentProps<PaperPageHeaderProps>) {
    const [local, rest] = splitProps(props, [
        "icon",
        "title",
        "subtitle",
        "class",
        "classList",
        "children",
    ]);

    return (
        <div
            {...rest}
            class={[styles.PaperPageHeader, local.class]
                .filter(Boolean)
                .join(" ")}
            classList={local.classList}
        >
            <div class={styles.heading}>
                <Show when={local.icon}>
                    <span class={styles.iconChip}>
                        {typeof local.icon === "string" ? (
                            <PaperIcon>{local.icon}</PaperIcon>
                        ) : (
                            local.icon
                        )}
                    </span>
                </Show>
                <div class={styles.text}>
                    <PaperText size={6} weight={700} class={styles.title}>
                        {local.title}
                    </PaperText>
                    <Show when={local.subtitle}>
                        <PaperText size={3} color="light-text">
                            {local.subtitle}
                        </PaperText>
                    </Show>
                </div>
            </div>

            <Show when={local.children}>
                <div class={styles.actions}>{local.children}</div>
            </Show>
        </div>
    );
}
