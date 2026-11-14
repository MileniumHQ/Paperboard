import styles from "./index.module.css";
import {
    createEffect,
    createMemo,
    createSignal,
    on,
    onCleanup,
    onMount,
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
    /**
     * Asked when Back would close the collapsed page, before it slides: false
     * (or a promise of false) keeps the page open, as when the detail holds
     * unsaved work and the person chooses to stay.
     */
    onBeforeDetailClose?: () => boolean | Promise<boolean>;
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
 * media queries. Both layouts are the same elements: crossing the width
 * restyles the panes, it never moves or rebuilds what's in them.
 */
export function PaperSplit(props: ParentProps<PaperSplitProps>) {
    let rootRef: HTMLDivElement | undefined;
    // Until it is measured, a split is as wide as its document (a split
    // usually fills its panel): a phone's first paint is already collapsed.
    // A server render has no document width and draws the panes side by side.
    const [width, setWidth] = createSignal<number | null>(typeof window === "undefined" ? null : window.innerWidth);

    // measured before the first notice below runs, then followed
    onMount(() => {
        if (!rootRef || typeof ResizeObserver === "undefined") return;
        setWidth(rootRef.getBoundingClientRect().width);
        const observer = new ResizeObserver((entries) => {
            const w = entries[0]?.contentRect.width;
            if (typeof w === "number") setWidth(w);
        });
        observer.observe(rootRef);
        onCleanup(() => observer.disconnect());
    });

    const collapsed = createMemo(() => {
        const w = width();
        return w !== null && w < (props.collapseWidth ?? DEFAULT_COLLAPSE_WIDTH);
    });

    // once with the first layout, then once per crossing
    createEffect(on(collapsed, (isCollapsed) => props.onCollapsedChange?.(isCollapsed)));

    // Back slides the page away first; the consumer hears of it after
    const [closing, setClosing] = createSignal(false);
    createEffect(on(() => props.detailActive, () => setClosing(false)));

    // the collapsed page is open while the detail is and Back hasn't closed it
    const pageOpen = () => Boolean(props.detailActive) && !closing();

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
        "onBeforeDetailClose",
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
            <div class={styles.row}>
                <div class={collapsed() ? styles.single : styles.side} style={collapsed() ? {} : sideStyle()}>
                    {local.side}
                </div>
                <div class={styles.main} classList={{ [styles.collapsed!]: collapsed() }}>
                    {/* collapsed, a page over the whole panel (in a frame, fixed
                        is the panel's own screen); side by side, it draws nothing */}
                    <PaperSlidePage
                        enabled={collapsed()}
                        position="fixed"
                        open={pageOpen()}
                        title={local.detailTitle ?? ""}
                        onBack={() => {
                            const before = local.onBeforeDetailClose;
                            if (!before) return setClosing(true);
                            void Promise.resolve(before()).then((close) => {
                                if (close) setClosing(true);
                            });
                        }}
                        onClosed={() => {
                            if (closing()) local.onDetailClose?.();
                        }}
                    >
                        {local.children}
                    </PaperSlidePage>
                </div>
            </div>
        </div>
    );
}
