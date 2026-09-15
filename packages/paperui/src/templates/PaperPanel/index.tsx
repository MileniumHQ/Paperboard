import styles from "./index.module.css";
import { splitProps, type JSX, type ParentProps } from "solid-js";
import { PaperPanelContext } from "../../contexts/panel";

export interface PaperPanelProps extends JSX.HTMLAttributes<HTMLDivElement> {
    /** column stacks the menu above the content instead of beside it */
    direction?: "row" | "column";
}

/**
 * The panel shell:
 *
 *   <PaperPanel>
 *       <PaperMenu>...</PaperMenu>
 *       <PaperInterfaceGroup>...</PaperInterfaceGroup>
 *   </PaperPanel>
 *
 * The shell owns the viewport; the menu sizes itself and the interface group
 * takes the remaining space and scrolls. No panel-level layout styles needed.
 */
export function PaperPanel(props: ParentProps<PaperPanelProps>) {
    const [local, rest] = splitProps(props, [
        "direction",
        "class",
        "classList",
        "children",
    ]);

    const className = () =>
        [
            styles.PaperPanel,
            local.direction === "column" ? styles.column : "",
            local.class,
        ]
            .filter(Boolean)
            .join(" ");

    return (
        <PaperPanelContext.Provider value={{ inPanel: true }}>
            <div {...rest} class={className()} classList={local.classList}>
                {local.children}
            </div>
        </PaperPanelContext.Provider>
    );
}
