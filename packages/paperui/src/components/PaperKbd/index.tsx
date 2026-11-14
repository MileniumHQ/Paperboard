import styles from "./index.module.css";
import { splitProps, type ParentProps, type JSX } from "solid-js";
import { cx } from "../../utils/cx";

export interface PaperKbdProps extends JSX.HTMLAttributes<HTMLElement> {}

export function PaperKbd(props: ParentProps<PaperKbdProps>) {
    const [local, rest] = splitProps(props, ["class", "classList", "children"]);

    return (
        <kbd
            {...rest}
            class={cx(styles.PaperKbd, local.class)}
            classList={local.classList}
        >
            {local.children}
        </kbd>
    );
}
