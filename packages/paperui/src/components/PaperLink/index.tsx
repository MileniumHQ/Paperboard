import styles from "./index.module.css";
import { splitProps, Show, type ParentProps, type JSX } from "solid-js";
import { PaperIcon } from "../PaperIcon";

export interface PaperLinkProps extends JSX.AnchorHTMLAttributes<HTMLAnchorElement> {
    external?: boolean;
}

export function PaperLink(props: ParentProps<PaperLinkProps>) {
    const [local, rest] = splitProps(props, ["external", "class", "classList", "children", "target", "rel"]);

    const isExternal = () => local.external ?? Boolean(rest.href?.startsWith("http"));

    return (
        <a
            {...rest}
            target={local.target ?? (isExternal() ? "_blank" : undefined)}
            rel={local.rel ?? (isExternal() ? "noopener noreferrer" : undefined)}
            class={[styles.PaperLink, local.class].filter(Boolean).join(" ")}
            classList={local.classList}
        >
            {local.children}
            <Show when={isExternal()}>
                <PaperIcon class={styles.externalIcon} zeroHeight>
                    open_in_new
                </PaperIcon>
            </Show>
        </a>
    );
}
