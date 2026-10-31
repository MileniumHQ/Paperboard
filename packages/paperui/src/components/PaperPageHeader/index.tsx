import styles from "./index.module.css";
import {
    createEffect,
    createSignal,
    onCleanup,
    splitProps,
    Show,
    type JSX,
    type ParentProps,
} from "solid-js";
import { PaperIcon } from "../PaperIcon";
import { PaperText } from "../PaperText";

export interface PaperPageHeaderProps
    extends Omit<JSX.HTMLAttributes<HTMLDivElement>, "title"> {
    /** Icon glyph name or custom element shown in the leading chip. */
    icon?: JSX.Element | string;
    title: JSX.Element | string;
    subtitle?: JSX.Element | string;
    /** When the actions wrap under the title, center both rows. */
    centerWhenStacked?: boolean;
}

// One header for a page/tab body: a leading icon chip, title, subtitle, and
// trailing actions. Flat by design — a border and surface, no shadow — so
// it sits at the same depth as the content it introduces.
export function PaperPageHeader(props: ParentProps<PaperPageHeaderProps>) {
    const [local, rest] = splitProps(props, [
        "icon",
        "title",
        "subtitle",
        "centerWhenStacked",
        "class",
        "classList",
        "children",
    ]);

    let rootRef: HTMLDivElement | undefined;
    let headingRef: HTMLDivElement | undefined;
    let actionsRef: HTMLDivElement | undefined;
    const [stacked, setStacked] = createSignal(false);

    // flex-wrap leaves no trace CSS can select, so the row is measured:
    // actions that start below the heading have wrapped under it
    createEffect(() => {
        if (!local.centerWhenStacked || !rootRef || typeof ResizeObserver === "undefined") {
            setStacked(false);
            return;
        }
        const measure = () =>
            setStacked(
                Boolean(
                    headingRef &&
                        actionsRef &&
                        actionsRef.offsetTop >= headingRef.offsetTop + headingRef.offsetHeight,
                ),
            );
        const observer = new ResizeObserver(measure);
        observer.observe(rootRef);
        measure();
        onCleanup(() => observer.disconnect());
    });

    return (
        <div
            {...rest}
            ref={(el) => {
                rootRef = el;
                if (typeof rest.ref === "function") rest.ref(el);
            }}
            class={[styles.PaperPageHeader, stacked() ? styles.stacked : "", local.class]
                .filter(Boolean)
                .join(" ")}
            classList={local.classList}
        >
            <div class={styles.heading} ref={headingRef}>
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
                    <PaperText preset="title" class={styles.title}>
                        {local.title}
                    </PaperText>
                    <Show when={local.subtitle}>
                        <PaperText size={3} color="text-subtle">
                            {local.subtitle}
                        </PaperText>
                    </Show>
                </div>
            </div>

            <Show when={local.children}>
                <div class={styles.actions} ref={actionsRef}>
                    {local.children}
                </div>
            </Show>
        </div>
    );
}
