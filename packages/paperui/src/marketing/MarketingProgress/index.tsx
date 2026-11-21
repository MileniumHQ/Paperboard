import { Show, splitProps, type JSX } from "solid-js";
import { cx } from "../../utils/cx";
// the tokens, grain and fonts every marketing component draws with; imported
// here, not only from the index, so a bundler that skips the index keeps them
import "../marketing.css";
import styles from "./index.module.css";

export interface MarketingProgressProps extends JSX.HTMLAttributes<HTMLDivElement> {
    /** From 0 to 100, as PaperProgress takes it. Unset, the bar sweeps for work of unknown length. */
    value?: number;
}

/** PaperProgress for a marketing surface: light on the surface's colour. It fills its parent's width; name it with aria-label. */
export function MarketingProgress(props: MarketingProgressProps) {
    const [local, rest] = splitProps(props, ["value", "class"]);
    const indeterminate = () => local.value === undefined;
    const percent = () => Math.round(Math.min(100, Math.max(0, local.value ?? 0)));
    return (
        <div
            {...rest}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={indeterminate() ? undefined : percent()}
            class={cx(styles.track, indeterminate() && styles.indeterminate, local.class)}
        >
            <Show when={!indeterminate()} fallback={<div class={styles.bar} />}>
                <div class={styles.bar} style={{ width: `${percent()}%` }} />
            </Show>
        </div>
    );
}
