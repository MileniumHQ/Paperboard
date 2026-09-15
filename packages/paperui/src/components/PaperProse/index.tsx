import styles from "./index.module.css";
import { splitProps, type JSX, type ParentProps } from "solid-js";

export interface PaperProseProps extends JSX.HTMLAttributes<HTMLDivElement> {}

/**
 * Typography for rendered rich text (markdown HTML, descriptions). The
 * consumer sanitizes the HTML and passes it as innerHTML; PaperProse owns
 * the look so panels ship no prose CSS.
 */
export function PaperProse(props: ParentProps<PaperProseProps>) {
    const [local, rest] = splitProps(props, ["class", "classList", "children"]);

    const className = () =>
        [styles.PaperProse, local.class].filter(Boolean).join(" ");

    return (
        <div {...rest} class={className()} classList={local.classList}>
            {local.children}
        </div>
    );
}
