import styles from "./index.module.css";
import {
    batch,
    createSignal,
    onCleanup,
    onMount,
    splitProps,
    type JSX,
    type ParentProps,
} from "solid-js";
import { PaperPanelContext, type PaperPanelEntry } from "../../contexts/panel";
import { cx } from "../../utils/cx";

export interface PaperPanelProps extends JSX.HTMLAttributes<HTMLDivElement> {
    /** column stacks the menu above the content instead of beside it */
    direction?: "row" | "column";
}

/**
 * Below this width a row panel takes the phone layout. Phones are 360-430px
 * wide; the narrowest desktop panel area is well over 600px.
 */
export const PAPER_PANEL_COMPACT_WIDTH = 520;

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
 *
 * On a phone-width panel the menu fills the panel instead, and picking an
 * entry slides its interface in over the menu as a page with a back bar. A
 * panel that loads at that width starts on the menu; one narrowed into it
 * keeps showing the entry that was open, as that entry's page.
 */
export function PaperPanel(props: ParentProps<PaperPanelProps>) {
    let ref: HTMLDivElement | undefined;
    const [local, rest] = splitProps(props, [
        "direction",
        "class",
        "classList",
        "children",
    ]);

    // Until it is measured, a panel is as wide as its document (a panel
    // fills its frame): its first paint already takes the phone layout,
    // rather than showing the wide one and then sliding its page away.
    const [width, setWidth] = createSignal<number | null>(typeof window === "undefined" ? null : window.innerWidth);
    const [pageOpen, setPageOpen] = createSignal(false);
    const [entries, setEntries] = createSignal<ReadonlyMap<string | number, PaperPanelEntry>>(new Map());
    // what the interface group shows, when it is one of the menu's entries
    const [shown, setShown] = createSignal<(() => string | number) | null>(null);

    const compact = () => {
        const w = width();
        return local.direction !== "column" && w !== null && w < PAPER_PANEL_COMPACT_WIDTH;
    };

    onMount(() => {
        if (!ref) return;
        setWidth(ref.getBoundingClientRect().width);
        if (typeof ResizeObserver === "undefined") return;
        const observer = new ResizeObserver((items) => {
            const w = items[0]?.contentRect.width;
            if (w === undefined) return;
            const wasCompact = compact();
            // one change: the page is already in place as the layout turns,
            // rather than sliding in over the menu
            batch(() => {
                setWidth(w);
                // narrowed into the phone layout: the person stays on the
                // entry they were looking at, as its page, rather than being
                // sent back to the menu (the first measurement above opens
                // nothing, so a phone still starts on the menu)
                const value = shown()?.();
                if (!wasCompact && compact() && value !== undefined && entries().has(value)) setPageOpen(true);
            });
        });
        observer.observe(ref);
        onCleanup(() => observer.disconnect());
    });

    const registerEntry = (value: string | number, entry: PaperPanelEntry) => {
        setEntries((prev) => new Map(prev).set(value, entry));
        return () =>
            setEntries((prev) => {
                if (prev.get(value) !== entry) return prev;
                const next = new Map(prev);
                next.delete(value);
                return next;
            });
    };

    const className = () =>
        cx(
            styles.PaperPanel,
            local.direction === "column" ? styles.column : "",
            local.class,
        );

    return (
        <PaperPanelContext.Provider
            value={{
                inPanel: true,
                compact,
                pageOpen,
                openPage: () => setPageOpen(true),
                closePage: () => setPageOpen(false),
                registerEntry,
                entry: (value) => entries().get(value),
                registerShown: (value) => {
                    setShown(() => value);
                    return () => setShown((current) => (current === value ? null : current));
                },
            }}
        >
            <div ref={ref} {...rest} class={className()} classList={local.classList}>
                {local.children}
            </div>
        </PaperPanelContext.Provider>
    );
}
