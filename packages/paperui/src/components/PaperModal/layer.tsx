// The part of a modal every dialog shares: the scrim, the stack of open
// dialogs, Escape and the back gesture, focus going in and coming back, Tab
// kept inside, and the way in and out. PaperModal draws a box with a header
// in it; PaperPreview draws a file with its close button above it.

import { createNavigationBack } from "../../utils/navigationBack";
import styles from "./index.module.css";
import {
    createEffect,
    on,
    createMemo,
    createSignal,
    onCleanup,
    splitProps,
    untrack,
    type JSX,
} from "solid-js";
import { ThemedPortal } from "../shared/ThemedPortal";
import { PaperPresence } from "../PaperPresence";
import { focusBeforeMenu } from "../shared/menuFocus";
import { cx } from "../../utils/cx";

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

// The element that last let focus go to nothing. A press on something
// that takes no focus (a menu's item, a card) drops focus to the body before
// its click opens a dialog: the dialog returns focus here instead.
let droppedFocus: WeakRef<HTMLElement> | null = null;
let watchingFocus = false;
function watchDroppedFocus() {
    if (watchingFocus) return;
    watchingFocus = true;
    document.addEventListener(
        "focusout",
        (e) => {
            if (e.relatedTarget === null && e.target instanceof HTMLElement) droppedFocus = new WeakRef(e.target);
        },
        true,
    );
    document.addEventListener("focusin", () => (droppedFocus = null), true);
}

// from the start: a dialog mounted only as it opens needs what came before it
if (typeof document !== "undefined") watchDroppedFocus();

/**
 * Where focus goes back to when a dialog opening now closes: what has focus,
 * or, for a dialog chosen from a menu, what had it before the menu opened.
 */
function opener(): HTMLElement | null {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body) return focusBeforeMenu(active) ?? active;
    return droppedFocus?.deref() ?? null;
}

const FOCUSABLE =
    'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

/** What Tab can reach in `root`, in document order. */
function focusablesIn(root: HTMLElement): HTMLElement[] {
    return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) =>
            !el.matches(":disabled") &&
            !el.hidden &&
            !el.closest('[hidden], [inert], [aria-hidden="true"]') &&
            el.getAttribute("aria-disabled") !== "true" &&
            getComputedStyle(el).display !== "none" &&
            getComputedStyle(el).visibility !== "hidden",
    );
}

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
    // whether it is open, changing only when that does: a prop worked out
    // from something else (the item a dialog is about) is read again each
    // time that changes, and the dialog must not close and open for it
    const isOpen = createMemo(() => !!local.open);
    // this modal's place in the stack while open, and whether it opened over another
    const [layer, setLayer] = createSignal<object | null>(null);
    const [over, setOver] = createSignal(false);
    const covered = () => {
        const own = layer();
        const stack = openModals();
        return own !== null && stack.indexOf(own) < stack.length - 1;
    };
    createEffect(
        on(
            isOpen,
            (open) => {
                if (open) {
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
            },
        ),
    );

    createEffect(on(isOpen, (open) => {
        if (!open) return;

        const previousActiveElement = opener();
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
                // the toasts take turns too: a failure said while the dialog
                // is open is read and closed from the keyboard, then focus
                // comes back in, never to the page under the scrim
                const toasts = document.querySelector<HTMLElement>("[data-paper-toasts]");
                const inDialog = focusablesIn(dialog);
                const inToasts = toasts ? focusablesIn(toasts) : [];
                const cycle = [...inDialog, ...inToasts];
                const active = document.activeElement;
                const move = (to: HTMLElement | undefined) => {
                    e.preventDefault();
                    (to ?? dialog)?.focus({ preventScroll: true });
                };
                if (cycle.length === 0) return move(dialog);
                const inside = active instanceof Node && (dialog.contains(active) || !!toasts?.contains(active));
                if (!inside) return move(e.shiftKey ? cycle.at(-1) : cycle[0]);
                if (e.shiftKey) {
                    if (active === cycle[0] || active === dialog) move(cycle.at(-1));
                    else if (active === inToasts[0]) move(inDialog.at(-1));
                } else if (active === cycle.at(-1)) move(cycle[0]);
                else if (active === inDialog.at(-1) && inToasts.length > 0) move(inToasts[0]);
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        onCleanup(() => {
            window.removeEventListener("keydown", handleKeyDown);
            setOpenModals((stack) => stack.filter((open) => open !== layer));
            setLayer(null);
            cancelAnimationFrame(focusFrame);
            // back where it was, if that is still on the page
            if (previousActiveElement?.isConnected) previousActiveElement.focus();
        });
    }));

    const handleBackdropClick = (e: MouseEvent) => {
        if (e.target === e.currentTarget && (local.closeOnBackdropClick ?? true)) {
            local.onClose?.();
        }
    };

    return (
        <ThemedPortal>
            {/* appear: a modal mounted already open (shown by a <Show>) still rises in */}
            <PaperPresence
                when={shown()}
                appear
                enterClass={styles.backdropTransitionIn}
                exitClass={styles.backdropTransitionOut}
            >
                <div
                    class={cx(styles.backdrop, local.backdropClass)}
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
                        class={cx(styles.dialog, local.class)}
                    >
                        <Held open={isOpen()}>{local.content}</Held>
                    </div>
                </div>
            </PaperPresence>
        </ThemedPortal>
    );
}
