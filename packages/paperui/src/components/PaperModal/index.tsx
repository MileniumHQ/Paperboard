import { createNavigationBack } from "../../utils/navigationBack";
import styles from "./index.module.css";
import {
    splitProps,
    createEffect,
    createUniqueId,
    onCleanup,
    Show,
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

    // A closing dialog lets go of the page while it animates out. WebKit
    // keeps the page hidden from VoiceOver if an aria-modal dialog leaves
    // the DOM still claiming it, until something else on the page changes.
    createEffect(() => {
        if (!local.open) modalRef?.removeAttribute("aria-modal");
    });

    createEffect(() => {
        if (!local.open) return;

        const previousActiveElement = document.activeElement as HTMLElement | null;

        const focusFrame = requestAnimationFrame(() => {
            if (modalRef) {
                modalRef.focus();
            }
        });

        const handleKeyDown = (e: KeyboardEvent) => {
            if (local.concealed) return;
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
                    modalRef.focus();
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
                when={local.open}
                appear
                enterClass={styles.backdropTransitionIn}
                exitClass={styles.backdropTransitionOut}
            >
                <div
                    class={styles.backdrop}
                    classList={{ [styles.bottom]: local.placement === "bottom", [styles.concealed]: !!local.concealed }}
                    aria-hidden={local.concealed ? "true" : undefined}
                    onClick={handleBackdropClick}
                >
                    <div
                        ref={modalRef}
                        tabIndex={-1}
                        role="dialog"
                        aria-modal="true"
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
