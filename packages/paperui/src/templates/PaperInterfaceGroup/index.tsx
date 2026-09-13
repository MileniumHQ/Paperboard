import styles from "./index.module.css";
import { createContext, useContext, Show, splitProps, type JSX, type ParentProps } from "solid-js";

const InterfaceGroupContext = createContext<() => string | number>();

export interface PaperInterfaceGroupProps extends JSX.HTMLAttributes<HTMLDivElement> {
    value: string | number;
}

export interface PaperInterfaceItemProps extends JSX.HTMLAttributes<HTMLDivElement> {
    value: string | number;
}

export function PaperInterfaceGroup(props: ParentProps<PaperInterfaceGroupProps>) {
    const [local, rest] = splitProps(props, ["value", "class", "classList", "children"]);

    const className = () =>
        [styles.PaperInterfaceGroup, local.class].filter(Boolean).join(" ");

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
    const [local, rest] = splitProps(props, ["value", "class", "classList", "children"]);

    const className = () =>
        [styles.PaperInterfaceItem, local.class].filter(Boolean).join(" ");

    return (
        <Show when={activeValue?.() === local.value}>
            <div {...rest} class={className()} classList={local.classList}>
                {local.children}
            </div>
        </Show>
    );
}

export const PaperInterfaceStep = PaperInterfaceItem;
