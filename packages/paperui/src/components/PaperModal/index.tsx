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
import { Transition } from "solid-transition-group";
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

    createEffect(() => {
        if (!local.open) return;

        const previousActiveElement = document.activeElement as HTMLElement | null;

        requestAnimationFrame(() => {
            if (modalRef) {
                modalRef.focus();
            }
        });

        const handleKeyDown = (e: KeyboardEvent) => {
            if ((local.closeOnEsc ?? true) && e.key === "Escape") {
                local.onClose?.();
                return;
            }

            if (e.key === "Tab" && modalRef) {
                const focusables = modalRef.querySelectorAll<HTMLElement>(
                    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
                );
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
            <Transition
                onEnter={(el, done) => {
                    el.classList.add(styles.backdropTransitionIn);
                    const handleEnd = () => {
                        el.removeEventListener("animationend", handleEnd);
                        done();
                    };
                    el.addEventListener("animationend", handleEnd, { once: true });
                }}
                onExit={(el, done) => {
                    el.classList.add(styles.backdropTransitionOut);
                    const handleEnd = () => {
                        el.removeEventListener("animationend", handleEnd);
                        done();
                    };
                    el.addEventListener("animationend", handleEnd, { once: true });
                }}
            >
                <Show when={local.open}>
                    <div class={styles.backdrop} onClick={handleBackdropClick}>
                        <div
                            ref={modalRef}
                            tabIndex={-1}
                            role="dialog"
                            aria-modal="true"
                            aria-labelledby={local.title ? titleId : undefined}
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
                                        <PaperText size={4} weight={700}>
                                            {local.title}
                                        </PaperText>
                                    </Show>

                                    <Show when={local.onClose}>
                                        <PaperButton
                                            tiny
                                            icon
                                            type="button"
                                            variant="text"
                                            onClick={() => local.onClose?.()}
                                            aria-label="Close modal"
                                            class={styles.closeBtn}
                                        >
                                            <PaperIcon aria-hidden="true" zeroHeight>
                                                close
                                            </PaperIcon>
                                        </PaperButton>
                                    </Show>
                                </div>
                            </Show>

                            <Show when={local.noHeader && local.onClose}>
                                <PaperButton
                                    tiny
                                    icon
                                    type="button"
                                    variant="text"
                                    onClick={() => local.onClose?.()}
                                    aria-label="Close modal"
                                    class={styles.floatingCloseBtn}
                                >
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
                </Show>
            </Transition>
        </Portal>
    );
}
