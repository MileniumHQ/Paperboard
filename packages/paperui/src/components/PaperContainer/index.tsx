import styles from "./index.module.css";
import { splitProps, type JSX, type ParentProps } from "solid-js";

export interface PaperContainerProps extends JSX.HTMLAttributes<HTMLDivElement> {}

export function PaperContainer(props: ParentProps<PaperContainerProps>) {
    const [local, rest] = splitProps(props, ["class", "classList", "children"]);

    return (
        <div
            {...rest}
            class={[styles.PaperContainer, local.class].filter(Boolean).join(" ")}
            classList={local.classList}
        >
            {local.children}
        </div>
    );
}
