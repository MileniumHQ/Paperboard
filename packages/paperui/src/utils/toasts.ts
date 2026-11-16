// The toasts a page shows, and the calls that show and close them. No
// component and no CSS: a read or an action helper shows a failure from
// here, and code a test runs outside a browser can too. PaperToastRegion
// (components/PaperToast) draws them.
import { createEffect, createMemo, getOwner, on, onCleanup, untrack, type Accessor } from "solid-js";
import { createStore } from "solid-js/store";
import { errorMessage } from "./errorMessage";

export type PaperToastVariant = "danger" | "warning" | "success" | "info";

export interface PaperToastAction {
    label: string;
    onClick: () => void;
}

export interface PaperToastOptions {
    title: string;
    /** Why, in one line under the title. */
    message?: string;
    /**
     * Anything longer, such as what a tool printed: hidden under Details,
     * where it can be read whole and copied.
     */
    details?: string;
    variant?: PaperToastVariant;
    /** A Material Symbols name; each variant has its own by default. */
    icon?: string;
    /** One button beside the message: Retry, Open, Undo. Pressing it closes the toast. */
    action?: PaperToastAction;
    /**
     * Milliseconds before it goes by itself; null keeps it until it is
     * closed. Danger toasts stay by default, so a failure is never missed.
     */
    duration?: number | null;
    /**
     * Names what the toast is about: while a toast with the same key is
     * showing, another isn't added. That toast takes the newest title,
     * message, icon and action in place, and its id is returned. A failure
     * that repeats says so once.
     */
    key?: string;
}

export interface ToastEntry extends PaperToastOptions {
    id: string;
}

const DEFAULT_DURATION = 6000;
// a toast stays readable: past this many, the oldest go first
const MAX_TOASTS = 5;

// a store, so a toast told something newer keeps its element
const [toasts, setToasts] = createStore<ToastEntry[]>([]);
const timers = new Map<string, ReturnType<typeof setTimeout>>();
let nextId = 0;

/** The toasts showing, oldest first. */
export const shownToasts = (): readonly ToastEntry[] => toasts;

/**
 * Shows a toast: what failed or finished, said where it will be seen. It
 * shows in the middle of the window where it covers no control, or inside
 * the dialog that is open, above its buttons.
 * Returns its id, for dismissToast.
 */
export function showToast(options: PaperToastOptions): string {
    const at = options.key === undefined ? -1 : toasts.findIndex((toast) => toast.key === options.key);
    if (at >= 0) {
        setToasts(at, { title: options.title, message: options.message, details: options.details, icon: options.icon, action: options.action });
        return toasts[at].id;
    }
    const id = `toast-${++nextId}`;
    const variant = options.variant ?? "info";
    const next = [...toasts, { ...options, variant, id }];
    for (const dropped of next.slice(0, Math.max(0, next.length - MAX_TOASTS))) clearTimer(dropped.id);
    setToasts(next.slice(-MAX_TOASTS));
    const duration = options.duration === undefined ? (variant === "danger" ? null : DEFAULT_DURATION) : options.duration;
    if (duration !== null) timers.set(id, setTimeout(() => dismissToast(id), duration));
    return id;
}

export interface ShowErrorOptions {
    /** Adds a Try again button that calls it. Never the only way to try again: the view keeps its own. */
    retry?: () => void;
    /** What the failure is about (default its title): while one with the same key shows, it takes the newest reason. */
    key?: string;
    /** More than the reason's first line, such as what a tool printed; default the reason's other lines. */
    details?: string;
}

/**
 * A failure's words as a toast says them: the first line is the reason,
 * and the lines after it (what a tool printed, a stack of causes) are its
 * details, read and copied under Details.
 */
export function failureWords(words: string): { message: string; details?: string } {
    const [first = "", ...rest] = words.split(/\r?\n/);
    const details = rest.join("\n").trim();
    return { message: first.trim(), details: details === "" ? undefined : details };
}

/**
 * Says a failure as a danger toast: `title` is what failed ("Couldn't save
 * the server"), `err` whatever was caught (an Error, a string, anything),
 * shown in words: its first line, and the rest under Details. It stays
 * until it is closed, and a failure that repeats shows once. Returns the
 * toast's id.
 *
 *     save().catch((err) => showError("Couldn't save the server", err, { retry: save }));
 */
export function showError(title: string, err: unknown, options: ShowErrorOptions = {}): string {
    const words = failureWords(errorMessage(err));
    return showToast({
        variant: "danger",
        title,
        message: words.message,
        details: options.details ?? words.details,
        key: options.key ?? title,
        action: options.retry ? { label: "Try again", onClick: options.retry } : undefined,
    });
}

export function dismissToast(id: string): void {
    clearTimer(id);
    if (toasts.some((toast) => toast.id === id)) setToasts((list) => list.filter((toast) => toast.id !== id));
}

/** Stops every toast's timer: the region that drew them is gone. */
export function stopToastTimers(): void {
    for (const id of [...timers.keys()]) clearTimer(id);
}

function clearTimer(id: string): void {
    const timer = timers.get(id);
    if (timer) clearTimeout(timer);
    timers.delete(id);
}

export interface FailureToastOptions {
    /** What failed, as a toast's title: "Couldn't load the worlds". */
    title: string;
    /**
     * A button that repeats one the view shows itself, such as Try again.
     * Never the only way to it: a closed toast takes its button away.
     */
    action?: PaperToastAction;
}

let nextFailure = 0;

/**
 * A standing failure, said as a danger toast: while `failure` gives
 * something (an Error, a string, whatever was caught) the toast shows it in
 * words (its first line, and the rest under Details), the newest in place, and it closes when it clears to `null`,
 * `undefined`, `false` or "". A toast the person closed stays closed until
 * the failure's words change, or it clears and comes back.
 *
 * Call it in a component, which owns it: the toast closes with it.
 */
export function createFailureToast(failure: Accessor<unknown>, options: FailureToastOptions): void {
    const key = `failure-${++nextFailure}`;
    // the toast showing, and the words the person closed it on
    let shown: string | null = null;
    let closed: string | null = null;

    const close = () => {
        const id = shown;
        shown = null;
        if (id) dismissToast(id);
    };

    // in words, and the same words are no change
    const reason = createMemo(() => {
        const now = failure();
        return now === null || now === undefined || now === false || now === "" ? null : errorMessage(now);
    });

    createEffect(
        on(reason, (words) => {
            if (words === null) {
                closed = null;
                close();
                return;
            }
            if (words === closed) return;
            closed = null;
            shown = showToast({ key, variant: "danger", title: options.title, ...failureWords(words), action: options.action });
        }),
    );

    // gone while the failure stands: the person closed it (or its button)
    createEffect(
        on(
            () => toasts.map((toast) => toast.id).join(" "),
            () => {
                if (shown === null || toasts.some((toast) => toast.id === shown)) return;
                shown = null;
                closed = untrack(reason);
            },
        ),
    );

    if (getOwner()) onCleanup(close);
}
