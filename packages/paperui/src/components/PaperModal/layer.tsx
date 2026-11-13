// The part of a modal every dialog shares: the scrim, the stack of open
// dialogs, Escape and the back gesture, focus going in and coming back, Tab
// kept inside, and the way in and out. PaperModal draws a box with a header
// in it; PaperPreview draws a file with its close button above it.

import { createNavigationBack } from "../../utils/navigationBack";
import styles from "./index.module.css";
import {
    createEffect,
    createMemo,
    createSignal,
    onCleanup,
    splitProps,
    untrack,
    type JSX,
} from "solid-js";
import { Portal } from "solid-js/web";
import { PaperPresence } from "../PaperPresence";

export interface ModalLayerProps extends JSX.HTMLAttributes<HTMLDivElement> {
    open?: boolean;
    onClose?: () => void;
    closeOnBackdropClick?: boolean;
    closeOnEsc?: boolean;
    /** "bottom" rises from the screen's bottom edge, like a phone's sheet */
    placement?: "center" | "bottom";
    /**
     * Stays open and mounted but isn't shown and takes no input: what was
     * picked up from it is being carried elsewhere, and the touch that
     * picked it up must keep its element.
     */
    concealed?: boolean;
    /** a class for the scrim, which lays the dialog out */
    backdropClass?: string;
    /** the dialog's content, drawn while open and held through the exit */
    content: () => JSX.Element;
}

// open modals, newest last: only the top one answers the keyboard, so
// Escape on a modal opened over another closes just that one. A modal
// under another steps back out of sight, and the one over it brings no
// scrim of its own, so the page is dimmed once however many are stacked.
const [openModals, setOpenModals] = createSignal<object[]>([]);

// how long a closed dialog waits for a frame before it leaves without one
const LEAVE_WITHOUT_FRAME_MS = 100;

const FOCUSABLE =
    'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

/**
 * Draws its content while the modal is open and keeps the last drawing
 * through the exit animation. A caller that clears what the modal shows as
 * it closes (the computer it names, the item it describes) would otherwise
 * blank the dialog for the whole time it takes to leave.
 */
function Held(props: { open: boolean; children: () => JSX.Element }) {
    const content = createMemo<JSX.Element>((last) => (props.open ? props.children() : last));
    return <>{content()}</>;
}

export function ModalLayer(props: ModalLayerProps) {
    let dialog: HTMLDivElement | undefined;
    const [local, rest] = splitProps(props, [
        "open",
        "onClose",
        "closeOnBackdropClick",
        "closeOnEsc",
        "placement",
        "concealed",
        "backdropClass",
        "content",
        "ref",
        "class",
        "children",
    ]);

    createNavigationBack(() => !!local.open && !local.concealed, () => {
        if (local.closeOnEsc ?? true) local.onClose?.();
    });

    // A closing dialog lets go of the page (aria-modal follows open), and
    // leaves a frame later. WebKit keeps the page hidden from VoiceOver if
    // an aria-modal dialog leaves the DOM still claiming it, and it only
    // sees the claim dropped on a later frame. Without an exit animation,
    // under reduced motion, nothing else would wait that long.
    const [shown, setShown] = createSignal(!!local.open);
    // this modal's place in the stack while open, and whether it opened over another
    const [layer, setLayer] = createSignal<object | null>(null);
    const [over, setOver] = createSignal(false);
    const covered = () => {
        const own = layer();
        const stack = openModals();
        return own !== null && stack.indexOf(own) < stack.length - 1;
    };
    createEffect(() => {
        if (local.open) {
            setShown(true);
            return;
        }
        // A page that draws no frames (a hidden tab, a headless browser on
        // fast-forwarded time) still lets the dialog go: the timer comes long
        // after a frame wherever frames are drawn.
        const hide = () => setShown(false);
        const frame = requestAnimationFrame(hide);
        const timer = setTimeout(hide, LEAVE_WITHOUT_FRAME_MS);
        onCleanup(() => {
            cancelAnimationFrame(frame);
            clearTimeout(timer);
        });
    });

    createEffect(() => {
        if (!local.open) return;

        const previousActiveElement = document.activeElement as HTMLElement | null;
        const layer = {};
        setOver(untrack(openModals).length > 0);
        setOpenModals((stack) => [...stack, layer]);
        setLayer(layer);

        // the modal stays mounted, so a field's own autofocus fires once at
        // mount: the modal hands focus to it on every open instead. Without
        // scrolling: a sheet is still below the screen as it rises, and
        // scrolling to show it left the whole page scrolled, the sheet stuck
        // high above where it belongs.
        const focusFrame = requestAnimationFrame(() => {
            if (!dialog) return;
            (dialog.querySelector<HTMLElement>("[autofocus]") ?? dialog).focus({ preventScroll: true });
        });

        const handleKeyDown = (e: KeyboardEvent) => {
            if (local.concealed || openModals().at(-1) !== layer) return;
            if ((local.closeOnEsc ?? true) && e.key === "Escape") {
                local.onClose?.();
                return;
            }

            if (e.key === "Tab" && dialog) {
                const focusables = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
                    (el) =>
                        !el.matches(":disabled") &&
                        !el.hidden &&
                        !el.closest('[hidden], [inert], [aria-hidden="true"]') &&
                        el.getAttribute("aria-disabled") !== "true" &&
                        getComputedStyle(el).display !== "none" &&
                        getComputedStyle(el).visibility !== "hidden",
                );
                if (focusables.length === 0) {
                    e.preventDefault();
                    dialog.focus({ preventScroll: true });
                    return;
                }

                const firstEl = focusables[0];
                const lastEl = focusables[focusables.length - 1];

                if (e.shiftKey) {
                    if (document.activeElement === firstEl || document.activeElement === dialog) {
                        e.preventDefault();
                        lastEl.focus();
                    }
                } else if (document.activeElement === lastEl) {
                    e.preventDefault();
                    firstEl.focus();
                }
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        onCleanup(() => {
            window.removeEventListener("keydown", handleKeyDown);
            setOpenModals((stack) => stack.filter((open) => open !== layer));
            setLayer(null);
            cancelAnimationFrame(focusFrame);
            previousActiveElement?.focus?.();
        });
    });

    const handleBackdropClick = (e: MouseEvent) => {
        if (e.target === e.currentTarget && (local.closeOnBackdropClick ?? true)) {
            local.onClose?.();
        }
    };

    return (
        <Portal>
            {/* appear: a modal mounted already open (shown by a <Show>) still rises in */}
            <PaperPresence
                when={shown()}
                appear
                enterClass={styles.backdropTransitionIn}
                exitClass={styles.backdropTransitionOut}
            >
                <div
                    class={[styles.backdrop, local.backdropClass].filter(Boolean).join(" ")}
                    classList={{
                        [styles.bottom]: local.placement === "bottom",
                        [styles.concealed]: !!local.concealed,
                        [styles.closing]: !local.open,
                        [styles.over]: over(),
                        [styles.covered]: covered(),
                    }}
                    aria-hidden={local.concealed ? "true" : undefined}
                    onClick={handleBackdropClick}
                >
                    <div
                        ref={(el) => {
                            dialog = el;
                            if (typeof local.ref === "function") (local.ref as (el: HTMLDivElement) => void)(el);
                        }}
                        tabIndex={-1}
                        role="dialog"
                        aria-modal={local.open ? "true" : undefined}
                        {...rest}
                        class={[styles.dialog, local.class].filter(Boolean).join(" ")}
                    >
                        <Held open={!!local.open}>{local.content}</Held>
                    </div>
                </div>
            </PaperPresence>
        </Portal>
    );
}
