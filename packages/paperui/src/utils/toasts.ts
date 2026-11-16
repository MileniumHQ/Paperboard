// The toasts a page shows, and the calls that show and close them. No
// component and no CSS: a read or an action helper shows a failure from
// here, and code a test runs outside a browser can too. PaperToastRegion
// (components/PaperToast) draws them.
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
     * Milliseconds it shows before it goes by itself: 10 seconds for danger
     * and warning, 6 for the rest. Every toast goes; a failure that stands
     * is said in place, with PaperError.
     */
    duration?: number;
    /**
     * Names what the toast is about: while a toast with the same key is
     * showing, another isn't added. That toast takes the newest title,
     * message, icon and action in place, and its id is returned. A failure
     * that repeats says so once, and its time starts again.
     */
    key?: string;
}

export interface ToastEntry extends PaperToastOptions {
    id: string;
    /** How long it shows, in milliseconds, counted from its latest words. */
    duration: number;
    /** Goes up each time its time starts again: its line starts again with it. */
    round: number;
}

const DEFAULT_DURATION = 6000;
// what went wrong, or what to watch, is read longer
const LONG_DURATION = 10000;
// a toast stays readable: past this many, the oldest go first
const MAX_TOASTS = 5;

// a store, so a toast told something newer keeps its element
const [toasts, setToasts] = createStore<ToastEntry[]>([]);
// each toast's countdown: the time it has left, and its timer while it runs
interface Countdown {
    left: number;
    startedAt: number;
    timer: ReturnType<typeof setTimeout> | null;
}
const timers = new Map<string, Countdown>();
let nextId = 0;

/** The toasts showing, oldest first. */
export const shownToasts = (): readonly ToastEntry[] => toasts;

/**
 * Shows a toast: what failed or finished, said in the window's corner over
 * everything, an open dialog included. It goes by itself after its
 * duration; pointing at it or focusing in it holds it. Returns its id, for
 * dismissToast.
 */
export function showToast(options: PaperToastOptions): string {
    const at = options.key === undefined ? -1 : toasts.findIndex((toast) => toast.key === options.key);
    if (at >= 0) {
        const id = toasts[at].id;
        setToasts(at, { title: options.title, message: options.message, details: options.details, icon: options.icon, action: options.action, round: toasts[at].round + 1 });
        startCountdown(id, toasts[at].duration);
        return id;
    }
    const id = `toast-${++nextId}`;
    const variant = options.variant ?? "info";
    const duration = options.duration ?? (variant === "danger" || variant === "warning" ? LONG_DURATION : DEFAULT_DURATION);
    const next = [...toasts, { ...options, variant, duration, round: 0, id }];
    for (const dropped of next.slice(0, Math.max(0, next.length - MAX_TOASTS))) clearTimer(dropped.id);
    setToasts(next.slice(-MAX_TOASTS));
    startCountdown(id, duration);
    return id;
}

/** Its full time from now: running, unless it is held, which it stays. */
function startCountdown(id: string, duration: number): void {
    const held = timers.get(id)?.timer === null;
    clearTimer(id);
    const countdown: Countdown = { left: duration, startedAt: Date.now(), timer: null };
    timers.set(id, countdown);
    if (!held) countdown.timer = setTimeout(() => dismissToast(id), duration);
}

/** Holds a toast's time while the person points at it or works in it. */
export function pauseToast(id: string): void {
    const countdown = timers.get(id);
    if (!countdown || countdown.timer === null) return;
    clearTimeout(countdown.timer);
    countdown.timer = null;
    countdown.left = Math.max(0, countdown.left - (Date.now() - countdown.startedAt));
}

/** Lets a held toast's time run on from where it was. */
export function resumeToast(id: string): void {
    const countdown = timers.get(id);
    if (!countdown || countdown.timer !== null) return;
    countdown.startedAt = Date.now();
    countdown.timer = setTimeout(() => dismissToast(id), countdown.left);
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
 * shown in words: its first line, and the rest under Details. It goes
 * after 10 seconds, and a failure that repeats shows once, its time
 * started again. Returns the toast's id. A failure that stands, such as a
 * view that won't load, is no toast: say it in place with PaperError.
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
    const timer = timers.get(id)?.timer;
    if (timer) clearTimeout(timer);
    timers.delete(id);
}
