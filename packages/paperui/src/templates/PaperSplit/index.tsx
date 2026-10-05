import styles from "./index.module.css";
import {
    createSignal,
    onCleanup,
    onMount,
    Show,
    splitProps,
    type JSX,
    type ParentProps,
} from "solid-js";
import { getVarCss } from "../../utils/theme";
import { PaperModal } from "../../components/PaperModal";

export interface PaperSplitProps {
    /** the list/roster pane, held at a fixed width beside the detail */
    side: JSX.Element;
    /** the detail pane (the default children slot) */
    children: JSX.Element;
    /** side width; a number is px, a string is used verbatim, default token */
    sideWidth?: number | string;
    /** container width (px) below which the panes collapse to one */
    collapseWidth?: number;
    /** when collapsed, presents the detail as a modal over the side */
    detailActive?: boolean;
    onDetailClose?: () => void;
    /** collapsed modal title */
    detailTitle?: JSX.Element | string;
    class?: string;
    classList?: JSX.ClassList;
}

const DEFAULT_COLLAPSE_WIDTH = 680;

/**
 * Master-detail layout. Side by side when there is room; below
 * `collapseWidth` the side pane fills the space and the detail presents as a
 * modal, so a panel works at Paperboard's minimum window size without any
 * per-panel media queries.
 */
export function PaperSplit(props: ParentProps<PaperSplitProps>) {
    let rootRef: HTMLDivElement | undefined;
    const [width, setWidth] = createSignal<number | undefined>(undefined);

    onMount(() => {
        if (!rootRef || typeof ResizeObserver === "undefined") return;
        const observer = new ResizeObserver((entries) => {
            const w = entries[0]?.contentRect.width;
            if (typeof w === "number") setWidth(w);
        });
        observer.observe(rootRef);
        onCleanup(() => observer.disconnect());
    });

    const collapsed = () => {
        const w = width();
        return w !== undefined && w < (props.collapseWidth ?? DEFAULT_COLLAPSE_WIDTH);
    };

    const sideStyle = () => ({
        width:
            typeof props.sideWidth === "number"
                ? `${props.sideWidth}px`
                : props.sideWidth ?? getVarCss("size-split-side"),
    });

    const [local, rest] = splitProps(props, [
        "side",
        "children",
        "sideWidth",
        "collapseWidth",
        "detailActive",
        "onDetailClose",
        "detailTitle",
        "class",
        "classList",
    ]);

    return (
        <div
            ref={rootRef}
            {...rest}
            class={[styles.PaperSplit, local.class].filter(Boolean).join(" ")}
            classList={local.classList}
        >
            <Show
                when={!collapsed()}
                fallback={
                    <>
                        <div class={styles.single}>{local.side}</div>
                        <PaperModal
                            open={Boolean(local.detailActive)}
                            onClose={() => local.onDetailClose?.()}
                            title={local.detailTitle}
                            size="medium"
                        >
                            {local.children}
                        </PaperModal>
                    </>
                }
            >
                <div class={styles.row}>
                    <div class={styles.side} style={sideStyle()}>
                        {local.side}
                    </div>
                    <div class={styles.main}>{local.children}</div>
                </div>
            </Show>
        </div>
    );
}
