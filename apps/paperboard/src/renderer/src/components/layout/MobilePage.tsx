import { type Component, type JSX, Show } from "solid-js";
import { PaperButton, PaperIcon, PaperText } from "@mileniumhq/paperui";
import { createSwipeBack } from "../../lib/swipeBack";
import styles from "./MobilePage.module.css";

// Phone layout: what's open (a panel, the library, a computer's settings)
// slides in over the rail and panel list as its own page, with a top bar to
// go back. Back is the button, or a rightward swipe on the top bar or the
// page's left edge. Closed, the page stays mounted off-screen and inert, so
// a panel keeps its frame and comes back as it was left.
//
// Off (the desktop layout) it draws nothing of its own: its boxes are
// display: contents and the children lay out as if it weren't there. The
// children are never re-parented either way, so no panel frame reloads.
const MobilePage: Component<{
    enabled: boolean;
    open: boolean;
    title: string;
    /** a Material icon name, or an element (a panel's own icon) */
    icon: JSX.Element;
    onBack: () => void;
    /** the open page's own menu (a panel's restart/uninstall), if it has one */
    onMore?: (e: MouseEvent) => void;
    moreLabel?: string;
    children: JSX.Element;
}> = (props) => {
    let pageRef: HTMLDivElement | undefined;
    const swipe = createSwipeBack({
        width: () => pageRef?.clientWidth ?? window.innerWidth,
        onBack: () => props.onBack(),
    });

    const transform = () => {
        if (!props.enabled) return undefined;
        if (!props.open) return "translateX(100%)";
        return `translateX(${swipe.offset() ?? 0}px)`;
    };

    return (
        <div
            ref={pageRef}
            classList={{
                [styles.page]: props.enabled,
                [styles.passthrough]: !props.enabled,
                [styles.dragging]: props.enabled && swipe.offset() !== null,
                [styles.closed]: props.enabled && !props.open,
            }}
            style={{ transform: transform() }}
            role={props.enabled ? "region" : undefined}
            aria-label={props.enabled ? props.title : undefined}
            inert={props.enabled && !props.open}
        >
            <Show when={props.enabled}>
                <header class={styles.bar} onPointerDown={swipe.onPointerDown}>
                    <PaperButton icon variant="text" aria-label="Back" onClick={() => props.onBack()}>
                        <PaperIcon>arrow_back</PaperIcon>
                    </PaperButton>
                    <span class={styles.icon} aria-hidden="true">
                        {typeof props.icon === "string" ? <PaperIcon>{props.icon}</PaperIcon> : props.icon}
                    </span>
                    <PaperText class={styles.title} size={3} weight={700}>
                        {props.title}
                    </PaperText>
                    <Show when={props.onMore}>
                        {(onMore) => (
                            <PaperButton icon variant="text" aria-label={props.moreLabel ?? "More"} onClick={(e: MouseEvent) => onMore()(e)}>
                                <PaperIcon>more_vert</PaperIcon>
                            </PaperButton>
                        )}
                    </Show>
                </header>
            </Show>
            <div class={props.enabled ? styles.content : styles.passthrough}>
                {props.children}
                <Show when={props.enabled}>
                    {/* above the panel iframe, which would otherwise take the touch */}
                    <div class={styles.edge} onPointerDown={swipe.onPointerDown} aria-hidden="true" />
                </Show>
            </div>
        </div>
    );
};

export default MobilePage;
