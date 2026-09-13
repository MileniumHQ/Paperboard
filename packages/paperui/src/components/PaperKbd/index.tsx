import styles from "./index.module.css";
import { splitProps, type ParentProps, type JSX } from "solid-js";

export interface PaperKbdProps extends JSX.HTMLAttributes<HTMLElement> {}

export function PaperKbd(props: ParentProps<PaperKbdProps>) {
    const [local, rest] = splitProps(props, ["class", "classList", "children"]);

    return (
        <kbd
            {...rest}
            class={[styles.PaperKbd, local.class].filter(Boolean).join(" ")}
            classList={local.classList}
        >
            {local.children}
        </kbd>
    );
}
