import styles from "./index.module.css";
import { createEffect, createSignal, For, on, onCleanup, Show, type JSX } from "solid-js";
import { isServer, Portal } from "solid-js/web";
import { PaperButton } from "../PaperButton";
import { PaperCode } from "../PaperCode";
import { PaperCollapsible } from "../PaperCollapsible";
import { PaperIcon } from "../PaperIcon";
import { PaperText } from "../PaperText";
import { cx } from "../../utils/cx";
import { dismissToast, pauseToast, resumeToast, shownToasts, stopToastTimers, type PaperToastVariant, type ToastEntry } from "../../utils/toasts";

export {
    dismissToast,
    showError,
    showToast,
    type ShowErrorOptions,
    type PaperToastAction,
    type PaperToastOptions,
    type PaperToastVariant,
} from "../../utils/toasts";

// how long a toast shows, which its line takes to shrink away
const TIME_VAR = "--paper-toast-time";

const DEFAULT_ICONS: Record<PaperToastVariant, string> = {
    danger: "error",
    warning: "warning",
    success: "check_circle",
    info: "info",
};

/**
 * Where toasts appear: the window's bottom-right corner, over everything,
 * an open dialog included. PaperProvider renders one, so showToast works
 * anywhere inside it; render it yourself only outside a PaperProvider.
 */
export function PaperToastRegion(props: JSX.HTMLAttributes<HTMLDivElement>) {
    // a page rendered on a server has no toasts yet, and no document to put them in
    if (isServer) return null;
    onCleanup(stopToastTimers);
    return (
        <Show when={shownToasts().length > 0}>
            <Portal>
                <div {...props} class={cx(styles.region, props.class)} role="region" aria-label="Notifications" data-paper-toasts>
                    <For each={shownToasts()}>{(toast) => <Toast toast={toast} />}</For>
                </div>
            </Portal>
        </Show>
    );
}

/**
 * One toast, and the line along its bottom that shrinks with the time it
 * has left. Pointing at it or focusing in it holds the time and the line;
 * leaving lets both run on from where they were.
 */
function Toast(props: { toast: ToastEntry }) {
    const [pointed, setPointed] = createSignal(false);
    const [focused, setFocused] = createSignal(false);
    const held = () => pointed() || focused();
    let line: HTMLDivElement | undefined;

    createEffect(on(held, (now) => (now ? pauseToast(props.toast.id) : resumeToast(props.toast.id)), { defer: true }));
    // told something newer: its time starts again, and the line with it
    createEffect(
        on(
            () => props.toast.round,
            () => {
                for (const animation of line?.getAnimations() ?? []) animation.currentTime = 0;
            },
            { defer: true },
        ),
    );

    const variant = () => props.toast.variant ?? "info";
    return (
        <div
            class={styles.toast}
            classList={{ [styles[variant()]]: true, [styles.held]: held() }}
            role={variant() === "danger" ? "alert" : "status"}
            style={{ [TIME_VAR]: `${props.toast.duration}ms` }}
            // a move, not an enter: a toast that shows up under a pointer
            // resting there isn't being read, and goes in its time
            onPointerMove={() => setPointed(true)}
            onPointerLeave={() => setPointed(false)}
            onFocusIn={() => setFocused(true)}
            onFocusOut={(e) => setFocused(e.currentTarget.contains(e.relatedTarget as Node | null))}
        >
            <PaperIcon class={styles.icon}>{props.toast.icon ?? DEFAULT_ICONS[variant()]}</PaperIcon>
            <div class={styles.text}>
                <PaperText preset="label" breakWord>{props.toast.title}</PaperText>
                <Show when={props.toast.message}>
                    {(message) => <PaperText preset="hint" breakWord>{message()}</PaperText>}
                </Show>
                <Show when={props.toast.details}>
                    {(details) => (
                        <PaperCollapsible title="Details">
                            <div class={styles.details}>
                                <PaperCode block wrap language="text">{details()}</PaperCode>
                            </div>
                        </PaperCollapsible>
                    )}
                </Show>
                <Show when={props.toast.action}>
                    {(action) => (
                        <div class={styles.actions}>
                            <PaperButton
                                size="small"
                                onClick={() => {
                                    dismissToast(props.toast.id);
                                    action().onClick();
                                }}
                            >
                                {action().label}
                            </PaperButton>
                        </div>
                    )}
                </Show>
            </div>
            <PaperButton size="tiny" variant="text" icon aria-label="Close" title="Close" onClick={() => dismissToast(props.toast.id)}>
                <PaperIcon>close</PaperIcon>
            </PaperButton>
            <div ref={line} class={styles.time} aria-hidden="true" data-paper-toast-time />
        </div>
    );
}
