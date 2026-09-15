import styles from "./index.module.css";
import { splitProps, type JSX, type ParentProps } from "solid-js";

export interface PaperKeyValueListProps extends JSX.HTMLAttributes<HTMLDListElement> {}

/** Label/value rows: health, stats, and settings readouts. */
export function PaperKeyValueList(props: ParentProps<PaperKeyValueListProps>) {
    const [local, rest] = splitProps(props, ["class", "classList", "children"]);

    const className = () =>
        [styles.PaperKeyValueList, local.class].filter(Boolean).join(" ");

    return (
        <dl {...rest} class={className()} classList={local.classList}>
            {local.children}
        </dl>
    );
}

export interface PaperKeyValueProps extends JSX.HTMLAttributes<HTMLDivElement> {
    label: JSX.Element | string;
}

export function PaperKeyValue(props: ParentProps<PaperKeyValueProps>) {
    const [local, rest] = splitProps(props, [
        "label",
        "class",
        "classList",
        "children",
    ]);

    const className = () =>
        [styles.PaperKeyValue, local.class].filter(Boolean).join(" ");

    return (
        <div {...rest} class={className()} classList={local.classList}>
            <dt class={styles.label}>{local.label}</dt>
            <dd class={styles.value}>{local.children}</dd>
        </div>
    );
}
