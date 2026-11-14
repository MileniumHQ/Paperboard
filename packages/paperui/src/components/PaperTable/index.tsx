import styles from "./index.module.css";
import { splitProps, type ParentProps, type JSX } from "solid-js";
import { cx } from "../../utils/cx";

export interface PaperTableProps extends JSX.HTMLAttributes<HTMLTableElement> {}

export function PaperTable(props: ParentProps<PaperTableProps>) {
    const [local, rest] = splitProps(props, ["class", "classList", "children"]);

    return (
        <div class={styles.PaperTableWrapper}>
            <table
                {...rest}
                class={cx(styles.PaperTable, local.class)}
                classList={local.classList}
            >
                {local.children}
            </table>
        </div>
    );
}
