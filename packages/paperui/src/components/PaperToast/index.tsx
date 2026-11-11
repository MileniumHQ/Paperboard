import styles from "./index.module.css";
import { createSignal, For, onCleanup, Show, type JSX } from "solid-js";
import { Portal } from "solid-js/web";
import { PaperButton } from "../PaperButton";
import { PaperIcon } from "../PaperIcon";
import { PaperText } from "../PaperText";

export type PaperToastVariant = "danger" | "warning" | "success" | "info";

export interface PaperToastOptions {
    title: string;
    message?: string;
    variant?: PaperToastVariant;
    /** A Material Symbols name; each variant has its own by default. */
    icon?: string;
    /** One button beside the message: Retry, Open, Undo. Pressing it closes the toast. */
    action?: { label: string; onClick: () => void };
    /**
     * Milliseconds before it goes by itself; null keeps it until it is
     * closed. Danger toasts stay by default, so a failure is never missed.
     */
    duration?: number | null;
}

interface ToastEntry extends PaperToastOptions {
    id: string;
}

const DEFAULT_ICONS: Record<PaperToastVariant, string> = {
    danger: "error",
    warning: "warning",
    success: "check_circle",
    info: "info",
};
const DEFAULT_DURATION = 6000;
// a toast stays readable: past this many, the oldest go first
const MAX_TOASTS = 5;

const [toasts, setToasts] = createSignal<ToastEntry[]>([]);
const timers = new Map<string, ReturnType<typeof setTimeout>>();
let nextId = 0;

/**
 * Shows a toast in the bottom right corner of the window: what failed or
 * finished, said where it will be seen. Returns its id, for dismissToast.
 */
export function showToast(options: PaperToastOptions): string {
    const id = `toast-${++nextId}`;
    const variant = options.variant ?? "info";
    setToasts((list) => {
        const next = [...list, { ...options, variant, id }];
        for (const dropped of next.slice(0, Math.max(0, next.length - MAX_TOASTS))) clearTimer(dropped.id);
        return next.slice(-MAX_TOASTS);
    });
    const duration = options.duration === undefined ? (variant === "danger" ? null : DEFAULT_DURATION) : options.duration;
    if (duration !== null) timers.set(id, setTimeout(() => dismissToast(id), duration));
    return id;
}

export function dismissToast(id: string): void {
    clearTimer(id);
    setToasts((list) => list.filter((toast) => toast.id !== id));
}

function clearTimer(id: string): void {
    const timer = timers.get(id);
    if (timer) clearTimeout(timer);
    timers.delete(id);
}

/**
 * Where toasts appear. PaperProvider renders one, so showToast works
 * anywhere inside it; render it yourself only outside a PaperProvider.
 */
export function PaperToastRegion(props: JSX.HTMLAttributes<HTMLDivElement>) {
    onCleanup(() => {
        for (const id of [...timers.keys()]) clearTimer(id);
    });
    return (
        <Show when={toasts().length > 0}>
            <Portal>
                <div {...props} class={[styles.region, props.class].filter(Boolean).join(" ")} role="region" aria-label="Notifications">
                    <For each={toasts()}>
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
