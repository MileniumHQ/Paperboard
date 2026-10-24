import { type JSX, Show, createEffect, on } from "solid-js";
import { PaperButton } from "../PaperButton";
import { PaperIcon } from "../PaperIcon";
import { PaperText } from "../PaperText";
import { createSwipeBack } from "../../utils/swipeBack";
import styles from "./index.module.css";

export interface PaperSlidePageProps {
    /** false: the wide layout; the page draws nothing of its own */
    enabled: boolean;
    open: boolean;
    title: string;
    /** a Material icon name, or an element (an app's own icon) */
    icon?: JSX.Element;
    onBack: () => void;
    /** the open page's own menu, if it has one, opened from a ⋮ button */
    onMore?: (e: MouseEvent) => void;
    moreLabel?: string;
    /**
     * absolute (default): covers its positioned container (a PaperPanel).
     * fixed: covers the whole screen (an app shell's top-level page).
     */
    position?: "absolute" | "fixed";
    children: JSX.Element;
}

/**
 * The phone layout's drill-down page: what was picked from a list slides in
 * over the list from the right, with a top bar to go back. Back is the
 * button, or a rightward swipe: from the top bar or the page's left edge with
 * any pointer, or from anywhere on the page with a finger (see swipeBack).
 * Closed, the page stays mounted off-screen and inert, so its content keeps
 * its state and comes back as it was left.
 *
 * Disabled (the wide layout) its boxes are display: contents and the
 * children lay out as if it weren't there. The children are never
 * re-parented either way, so nothing inside remounts or reloads.
 */
export function PaperSlidePage(props: PaperSlidePageProps) {
    let pageRef: HTMLDivElement | undefined;
    const swipe = createSwipeBack({
        width: () => pageRef?.clientWidth ?? window.innerWidth,
        onBack: () => props.onBack(),
        el: () => pageRef,
        active: () => props.enabled && props.open,
    });

    // Switching layouts moves the page to where it already is: a closed page
    // turning into the phone layout must be off-screen at once, not slide out
    // over the list. Only opening and closing animate.
    createEffect(
        on(
            () => props.enabled,
            () => {
                if (!pageRef) return;
                pageRef.style.transition = "none";
                void pageRef.offsetWidth;
                pageRef.style.transition = "";
            },
            { defer: true },
        ),
    );

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
                [styles.fixed]: props.enabled && props.position === "fixed",
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
                    <Show when={props.icon}>
                        <span class={styles.icon} aria-hidden="true">
                            {typeof props.icon === "string" ? <PaperIcon>{props.icon}</PaperIcon> : props.icon}
                        </span>
                    </Show>
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
                    {/* above content that would otherwise take the touch (an iframe) */}
                    <div class={styles.edge} onPointerDown={swipe.onPointerDown} aria-hidden="true" />
                </Show>
            </div>
        </div>
    );
}
