import { createNavigationBack } from "../../utils/navigationBack";
import styles from "./index.module.css";
import {
    splitProps,
    createEffect,
    createSignal,
    createUniqueId,
    onCleanup,
    Show,
    untrack,
    type JSX,
    type ParentProps,
} from "solid-js";
import { Portal } from "solid-js/web";
import { PaperPresence } from "../PaperPresence";
import { PaperText } from "../PaperText";
import { PaperIcon } from "../PaperIcon";
import { PaperButton } from "../PaperButton";

export interface PaperModalProps extends Omit<JSX.HTMLAttributes<HTMLDivElement>, "title"> {
    open?: boolean;
    onClose?: () => void;
    title?: JSX.Element | string;
    size?: "small" | "medium" | "large" | "full";
    fullscreen?: boolean;
    closeOnBackdropClick?: boolean;
    closeOnEsc?: boolean;
    noHeader?: boolean;
    noPadding?: boolean;
    footer?: JSX.Element;
    /** "bottom" rises from the screen's bottom edge, like a phone's sheet */
    placement?: "center" | "bottom";
    /**
     * Stays open and mounted but isn't shown and takes no input: what was
     * picked up from it is being carried elsewhere, and the touch that
     * picked it up must keep its element.
     */
    concealed?: boolean;
}

// open modals, newest last: only the top one answers the keyboard, so
// Escape on a modal opened over another closes just that one. A modal
// under another steps back out of sight, and the one over it brings no
// scrim of its own, so the page is dimmed once however many are stacked.
const [openModals, setOpenModals] = createSignal<object[]>([]);

// how long a closed dialog waits for a frame before it leaves without one
const LEAVE_WITHOUT_FRAME_MS = 100;

export function PaperModal(props: ParentProps<PaperModalProps>) {
    let modalRef: HTMLDivElement | undefined;
    const titleId = `paper-modal-title-${createUniqueId()}`;
    const [local, rest] = splitProps(props, [
        "open",
        "onClose",
        "title",
        "size",
        "fullscreen",
        "closeOnBackdropClick",
        "closeOnEsc",
        "noHeader",
        "noPadding",
        "footer",
        "placement",
        "concealed",
        "class",
        "classList",
        "children",
    ]);

    const sizeClass = () => {
        if (local.fullscreen) return styles.fullscreen;
        switch (local.size) {
            case "small":
                return styles.small;
            case "large":
                return styles.large;
            case "full":
                return styles.full;
            case "medium":
            default:
                return styles.medium;
        }
    };

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
            if (!modalRef) return;
            (modalRef.querySelector<HTMLElement>("[autofocus]") ?? modalRef).focus({ preventScroll: true });
        });

        const handleKeyDown = (e: KeyboardEvent) => {
            if (local.concealed || openModals().at(-1) !== layer) return;
            if ((local.closeOnEsc ?? true) && e.key === "Escape") {
                local.onClose?.();
                return;
            }

            if (e.key === "Tab" && modalRef) {
                const focusables = [...modalRef.querySelectorAll<HTMLElement>(
                    'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
                )].filter((el) => !el.matches(":disabled") && !el.hidden && !el.closest('[hidden], [inert], [aria-hidden="true"]') && el.getAttribute("aria-disabled") !== "true" && getComputedStyle(el).display !== "none" && getComputedStyle(el).visibility !== "hidden");
                if (focusables.length === 0) {
                    e.preventDefault();
                    modalRef.focus({ preventScroll: true });
                    return;
                }

                const firstEl = focusables[0];
                const lastEl = focusables[focusables.length - 1];

                if (e.shiftKey) {
                    if (document.activeElement === firstEl || document.activeElement === modalRef) {
                        e.preventDefault();
                        lastEl.focus();
                    }
                } else {
                    if (document.activeElement === lastEl) {
                        e.preventDefault();
                        firstEl.focus();
                    }
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
                    class={styles.backdrop}
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
                        ref={modalRef}
                        tabIndex={-1}
                        role="dialog"
                        aria-modal={local.open ? "true" : undefined}
                        aria-labelledby={local.title && !local.noHeader ? titleId : undefined}
                        {...rest}
                        class={[styles.modalBox, sizeClass(), local.class]
                            .filter(Boolean)
                            .join(" ")}
                        classList={local.classList}
                    >
                        <Show
                            when={
                                !local.noHeader &&
                                (local.title || local.onClose)
                            }
                        >
                            <div class={styles.header}>
                                <Show when={local.title}>
                                    <span id={titleId}><PaperText size={4} weight={700}>
                                        {local.title}
                                    </PaperText></span>
                                </Show>

                                <Show when={local.onClose}>
                                    <PaperButton size="tiny"
                                        icon
                                        type="button"
                                        variant="text"
                                        onClick={() => local.onClose?.()}
                                        aria-label="Close modal"
                                        class={styles.closeBtn}>
                                        <PaperIcon aria-hidden="true" zeroHeight>
                                            close
                                        </PaperIcon>
                                    </PaperButton>
                                </Show>
                            </div>
                        </Show>

                        <Show when={local.noHeader && local.onClose}>
                            <PaperButton size="tiny"
                                icon
                                type="button"
                                variant="text"
                                onClick={() => local.onClose?.()}
                                aria-label="Close modal"
                                class={styles.floatingCloseBtn}>
                                <PaperIcon aria-hidden="true" zeroHeight>
                                    close
                                </PaperIcon>
                            </PaperButton>
                        </Show>

                        <div
                            class={[
                                styles.body,
                                local.noPadding ? styles.noPadding : "",
                            ]
                                .filter(Boolean)
                                .join(" ")}
                        >
                            {local.children}
                        </div>

                        <Show when={local.footer}>
                            <div class={styles.footer}>{local.footer}</div>
                        </Show>
                    </div>
                </div>
            </PaperPresence>
        </Portal>
    );
}
