import styles from "./index.module.css";
import {
    createEffect,
    createSignal,
    on,
    onCleanup,
    onMount,
    Show,
    splitProps,
    type JSX,
    type ParentProps,
} from "solid-js";
import { getVarCss } from "../../utils/theme";
import { PaperSlidePage } from "../../components/PaperSlidePage";

export interface PaperSplitProps {
    /** the list/roster pane, held at a fixed width beside the detail */
    side: JSX.Element;
    /** the detail pane (the default children slot) */
    children: JSX.Element;
    /** side width; a number is px, a string is used verbatim, default token */
    sideWidth?: number | string;
    /** container width (px) below which the panes collapse to one */
    collapseWidth?: number;
    /** when collapsed, slides the detail in over the side as a page */
    detailActive?: boolean;
    /**
     * The detail was closed. Collapsed, this comes once its page has slid
     * away, so the detail keeps showing what it showed until it's gone.
     */
    onDetailClose?: () => void;
    /** the collapsed page's title */
    detailTitle?: string;
    /**
     * Notified whenever the layout crosses between side-by-side and collapsed.
     * The detail pane is a page only while collapsed, so a consumer that
     * needs to change its interaction for the single-pane layout (for example
     * a list whose selection must not toggle) can track this instead of
     * re-measuring the same width itself.
     */
    onCollapsedChange?: (collapsed: boolean) => void;
    class?: string;
    classList?: JSX.ClassList;
}

const DEFAULT_COLLAPSE_WIDTH = 680;

/**
 * Master-detail layout. Side by side when there is room; below
 * `collapseWidth` the side pane fills the space and the detail slides in over
 * it as a page with a back bar (and the back swipe), so a panel works at
 * Paperboard's minimum window size and on a phone without any per-panel
 * media queries.
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

    createEffect(() => {
        props.onCollapsedChange?.(collapsed());
    });

    // Back slides the page away first; the consumer hears of it after
    const [closing, setClosing] = createSignal(false);
    createEffect(on(() => props.detailActive, () => setClosing(false)));

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
        "onCollapsedChange",
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
                        {/* over the whole panel: in a frame, fixed is the panel's own screen */}
                        <PaperSlidePage
                            enabled
                            position="fixed"
                            open={Boolean(local.detailActive) && !closing()}
                            title={local.detailTitle ?? ""}
                            onBack={() => setClosing(true)}
                            onClosed={() => {
                                if (closing()) local.onDetailClose?.();
                            }}
                        >
                            {local.children}
                        </PaperSlidePage>
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
