import styles from "./index.module.css";
import { splitProps, createUniqueId, Show, type JSX, type ParentProps } from "solid-js";
import { ModalLayer } from "./layer";
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

    return (
        <ModalLayer
            open={local.open}
            onClose={local.onClose}
            closeOnBackdropClick={local.closeOnBackdropClick}
            closeOnEsc={local.closeOnEsc}
            placement={local.placement}
            concealed={local.concealed}
            aria-labelledby={local.title && !local.noHeader ? titleId : undefined}
            {...rest}
            class={[styles.modalBox, sizeClass(), local.class].filter(Boolean).join(" ")}
            classList={local.classList}
            content={() => (
                                <>
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
                                </>
            )}
        />
    );
}
