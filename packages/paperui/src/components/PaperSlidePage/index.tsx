import { type JSX, For, Show, createEffect, on, onCleanup } from "solid-js";
import { PaperButton } from "../PaperButton";
import { PaperIcon } from "../PaperIcon";
import { PaperText } from "../PaperText";
import { createSwipeBack } from "../../utils/swipeBack";
import { createNavigationBack } from "../../utils/navigationBack";
import { createPageCrumb } from "../../utils/pageCrumbs";
import { resolveBackground } from "../../utils/theme";
import type { PaperBackgroundSurface } from "../../types";
import styles from "./index.module.css";

export interface PaperSlidePageProps {
    /** false: the wide layout; the page draws nothing of its own */
    enabled: boolean;
    open: boolean;
    title: string;
    /**
     * Where the person is inside the page, after its title, outermost
     * first: the bar reads "Title › Crumb › Crumb", the last crumb kept
     * whole and the earlier ones shortened. An app shell passes the open
     * pages a panel frame reports (pageCrumbs).
     */
    crumbs?: string[];
    /** a Material icon name, or an element (an app's own icon) */
    icon?: JSX.Element;
    onBack: () => void;
    /**
     * Called once a close has finished sliding the page away (at once with
     * motion off): the moment to clear what the page showed, so it never
     * changes while still in view.
     */
    onClosed?: () => void;
    /** the open page's own menu, if it has one, opened from a ⋮ button */
    onMore?: (e: MouseEvent) => void;
    moreLabel?: string;
    /**
     * absolute (default): covers its positioned container (a PaperPanel).
     * fixed: covers the whole screen (an app shell's top-level page).
     */
    position?: "absolute" | "fixed";
    /**
     * The page's surface, which also fills the strip a fixed page keeps
     * clear above the home indicator. Match what the content shows at its
     * foot, so the strip reads as part of it. Default surface.
     */
    background?: PaperBackgroundSurface;
    /**
     * A computed color for that strip alone, when the content's foot isn't a
     * PaperUI surface the shell knows: an app shell passes what a panel frame
     * reports (FRAME_BACKGROUND_EVENT). Default the page's background.
     */
    footColor?: string;
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
    createNavigationBack(() => props.enabled && props.open, () => props.onBack());
    // a page inside a panel names itself to the shell's bar; a fixed one too,
    // which in a frame covers the panel, not the screen
    const framed = typeof window !== "undefined" && window.parent !== window;
    createPageCrumb(() => props.enabled && props.open && (props.position !== "fixed" || framed), () => props.title);
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

    createEffect(
        on(
            () => props.open,
            (open) => {
                const el = pageRef;
                if (open || !props.enabled || !props.onClosed) return;
                if (!el || !parseFloat(getComputedStyle(el).transitionDuration)) {
                    props.onClosed();
                    return;
                }
                const done = (e: TransitionEvent) => {
                    if (e.target !== el || e.propertyName !== "transform") return;
                    el.removeEventListener("transitionend", done);
                    props.onClosed?.();
                };
                el.addEventListener("transitionend", done);
                onCleanup(() => el.removeEventListener("transitionend", done));
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
            style={{ transform: transform(), background: props.enabled ? resolveBackground(props.background) : undefined }}
            role={props.enabled ? "region" : undefined}
            aria-label={props.enabled ? [props.title, ...(props.crumbs ?? [])].join(", ") : undefined}
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
                    <span class={styles.trail}>
                        <PaperText class={styles.title} size={props.position === "fixed" ? 2 : 3} weight={700}>
                            {props.title}
                        </PaperText>
                        <For each={props.crumbs ?? []}>
                            {(crumb, index) => (
                                <>
                                    <PaperIcon class={styles.separator} aria-hidden="true">chevron_right</PaperIcon>
                                    <PaperText
                                        class={styles.crumb}
                                        classList={{ [styles.current]: index() === (props.crumbs?.length ?? 0) - 1 }}
                                        size={2}
                                        weight={index() === (props.crumbs?.length ?? 0) - 1 ? 700 : 600}
                                        color={index() === (props.crumbs?.length ?? 0) - 1 ? undefined : "text-subtle"}
                                    >
                                        {crumb}
                                    </PaperText>
                                </>
                            )}
                        </For>
                    </span>
                    <Show when={props.onMore}>
                        {(onMore) => (
                            <PaperButton icon variant="text" aria-label={props.moreLabel ?? "More"} onClick={(e: MouseEvent) => onMore()(e)}>
                                <PaperIcon>more_vert</PaperIcon>
                            </PaperButton>
                        )}
                    </Show>
                </header>
            </Show>
            <div
                class={props.enabled ? styles.content : styles.passthrough}
                style={{ "background-color": props.enabled ? props.footColor : undefined }}
            >
                {props.children}
                <Show when={props.enabled}>
                    {/* above content that would otherwise take the touch (an iframe) */}
                    <div class={styles.edge} onPointerDown={swipe.onPointerDown} aria-hidden="true" />
                </Show>
            </div>
        </div>
    );
}
