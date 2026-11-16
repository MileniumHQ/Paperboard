import styles from "./index.module.css";
import { For, onCleanup, Show, type JSX } from "solid-js";
import { Portal } from "solid-js/web";
import { PaperButton } from "../PaperButton";
import { PaperIcon } from "../PaperIcon";
import { PaperText } from "../PaperText";
import { cx } from "../../utils/cx";
import { dismissToast, shownToasts, stopToastTimers, type PaperToastVariant } from "../../utils/toasts";

export {
    createFailureToast,
    dismissToast,
    showError,
    showToast,
    type FailureToastOptions,
    type ShowErrorOptions,
    type PaperToastAction,
    type PaperToastOptions,
    type PaperToastVariant,
} from "../../utils/toasts";

const DEFAULT_ICONS: Record<PaperToastVariant, string> = {
    danger: "error",
    warning: "warning",
    success: "check_circle",
    info: "info",
};

/**
 * Where toasts appear. PaperProvider renders one, so showToast works
 * anywhere inside it; render it yourself only outside a PaperProvider.
 */
export function PaperToastRegion(props: JSX.HTMLAttributes<HTMLDivElement>) {
    onCleanup(stopToastTimers);
    return (
        <Show when={shownToasts().length > 0}>
            <Portal>
                <div {...props} class={cx(styles.region, props.class)} role="region" aria-label="Notifications" data-paper-toasts>
                    <For each={shownToasts()}>
                        {(toast) => (
                            <div
                                class={styles.toast}
                                classList={{ [styles[toast.variant ?? "info"]]: true }}
                                role={toast.variant === "danger" ? "alert" : "status"}
                            >
                                <PaperIcon class={styles.icon}>{toast.icon ?? DEFAULT_ICONS[toast.variant ?? "info"]}</PaperIcon>
                                <div class={styles.text}>
                                    <PaperText preset="label" breakWord>{toast.title}</PaperText>
                                    <Show when={toast.message}>
                                        <PaperText preset="hint" breakWord>{toast.message}</PaperText>
                                    </Show>
                                    <Show when={toast.action}>
                                        {(action) => (
                                            <div class={styles.actions}>
                                                <PaperButton
                                                    size="small"
                                                    onClick={() => {
                                                        dismissToast(toast.id);
                                                        action().onClick();
                                                    }}
                                                >
                                                    {action().label}
                                                </PaperButton>
                                            </div>
                                        )}
                                    </Show>
                                </div>
                                <PaperButton
                                    size="tiny"
                                    variant="text"
                                    icon
                                    aria-label="Close"
                                    title="Close"
                                    onClick={() => dismissToast(toast.id)}
                                >
                                    <PaperIcon>close</PaperIcon>
                                </PaperButton>
                            </div>
                        )}
                    </For>
                </div>
            </Portal>
        </Show>
    );
}
