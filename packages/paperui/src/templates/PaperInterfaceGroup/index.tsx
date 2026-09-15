import styles from "./index.module.css";
import { createContext, useContext, Show, splitProps, type JSX, type ParentProps } from "solid-js";
import { PaperPage } from "../PaperPage";
import { usePaperPanel } from "../../contexts/panel";

const InterfaceGroupContext = createContext<() => string | number>();

export interface PaperInterfaceGroupProps extends JSX.HTMLAttributes<HTMLDivElement> {
    value: string | number;
}

/** how an active item hosts its content */
export type PaperInterfaceItemVariant = "page" | "full" | "centered" | "plain";

export interface PaperInterfaceItemProps extends JSX.HTMLAttributes<HTMLDivElement> {
    value: string | number;
    /**
     * page (default): centered PaperPage column, item scrolls
     * full: edge to edge, no padding, item clips (canvas-style tabs)
     * centered: content centered in the item, item scrolls
     * plain: raw item, the author composes
     */
    variant?: PaperInterfaceItemVariant;
}

export function PaperInterfaceGroup(props: ParentProps<PaperInterfaceGroupProps>) {
    const panel = usePaperPanel();
    const [local, rest] = splitProps(props, ["value", "class", "classList", "children"]);

    const className = () =>
        [
            styles.PaperInterfaceGroup,
            panel?.inPanel ? styles.inPanel : "",
            local.class,
        ]
            .filter(Boolean)
            .join(" ");

    return (
        <InterfaceGroupContext.Provider value={() => local.value}>
            <div {...rest} class={className()} classList={local.classList}>
                {local.children}
            </div>
        </InterfaceGroupContext.Provider>
    );
}

export function PaperInterfaceItem(props: ParentProps<PaperInterfaceItemProps>) {
    const activeValue = useContext(InterfaceGroupContext);
    const [local, rest] = splitProps(props, [
        "value",
        "variant",
        "class",
        "classList",
        "children",
    ]);

    const variant = () => local.variant ?? "page";

    const className = () =>
        [styles.PaperInterfaceItem, styles[variant()], local.class]
            .filter(Boolean)
            .join(" ");

    return (
        <Show when={activeValue?.() === local.value}>
            <div {...rest} class={className()} classList={local.classList}>
                <Show when={variant() === "page"} fallback={local.children}>
                    <PaperPage>{local.children}</PaperPage>
                </Show>
            </div>
        </Show>
    );
}

export const PaperInterfaceStep = PaperInterfaceItem;
