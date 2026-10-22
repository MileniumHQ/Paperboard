import styles from "./index.module.css";
import {
    createSignal,
    onCleanup,
    onMount,
    splitProps,
    type JSX,
    type ParentProps,
} from "solid-js";
import { PaperPanelContext, type PaperPanelEntry } from "../../contexts/panel";

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
 * entry slides its interface in over the menu as a page with a back bar.
 */
export function PaperPanel(props: ParentProps<PaperPanelProps>) {
    let ref: HTMLDivElement | undefined;
    const [local, rest] = splitProps(props, [
        "direction",
        "class",
        "classList",
        "children",
    ]);

    const [width, setWidth] = createSignal<number | null>(null);
    const [pageOpen, setPageOpen] = createSignal(false);
    const [entries, setEntries] = createSignal<ReadonlyMap<string | number, PaperPanelEntry>>(new Map());

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
            if (w !== undefined) setWidth(w);
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
        [
            styles.PaperPanel,
            local.direction === "column" ? styles.column : "",
            local.class,
        ]
            .filter(Boolean)
            .join(" ");

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
            }}
        >
            <div ref={ref} {...rest} class={className()} classList={local.classList}>
                {local.children}
            </div>
        </PaperPanelContext.Provider>
    );
}
