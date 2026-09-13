import styles from "./index.module.css";
import { splitProps, type ParentProps, type JSX } from "solid-js";

export interface PaperTableProps extends JSX.HTMLAttributes<HTMLTableElement> {}

export function PaperTable(props: ParentProps<PaperTableProps>) {
    const [local, rest] = splitProps(props, ["class", "classList", "children"]);

    return (
        <div class={styles.PaperTableWrapper}>
            <table
                {...rest}
                class={[styles.PaperTable, local.class].filter(Boolean).join(" ")}
                classList={local.classList}
            >
                {local.children}
            </table>
        </div>
    );
}
