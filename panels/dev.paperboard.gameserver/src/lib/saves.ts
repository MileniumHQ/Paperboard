import { createSavedValue, type SavedValue } from "@mileniumhq/paperui/headless";
import { SerialQueue } from "@mileniumhq/paperapi";
import { createSignal, type Accessor } from "solid-js";

/** One setting a tab saves: what its control shows, and how it changes. */
export interface SavedSetting<T> extends Omit<SavedValue<T>, "set"> {
    /** shows `next` at once and saves it after the saves made before it */
    set(next: T): void;
}

/** A tab's saves: its settings, and other work that must not run between them. */
export interface Saves {
    /**
     * A setting whose control flips the moment it is changed (PaperUI's
     * createSavedValue). `stored` is what is saved, as the tab last read it;
     * `write` saves a value and may update what `stored` reads, or resolve
     * `false` when the user called the change off (a location picker closed).
     * Made inside the control's component, which owns it.
     */
    setting<T>(key: string, stored: Accessor<T>, write: (value: T) => Promise<boolean | void>): SavedSetting<T>;
    /** runs `work` in turn with the saves, so it never overlaps one */
    run<T>(work: () => Promise<T>): Promise<T>;
    /** anything of this tab's is saving or waiting to */
    saving: Accessor<boolean>;
}

/**
 * The one way a tab saves its settings: every setting of the tab waits in
 * one line, with the tab's other work. A failed save is handed to `failed`,
 * which toasts it, and `changed` hears each change as it is made.
 */
export function createSaves(report: {
    /** saving `value` failed: the tab toasts `err` */
    failed(err: unknown, key: string, value: unknown): void;
    /** a change was made: the tab clears a notice the last save left */
    changed?(key: string): void;
}): Saves {
    const queue = new SerialQueue();
    const [queued, setQueued] = createSignal(0);

    const run = <T>(work: () => Promise<T>): Promise<T> => {
        setQueued((n) => n + 1);
        return queue.run(work).finally(() => setQueued((n) => n - 1));
    };

    const setting = <T>(key: string, stored: Accessor<T>, write: (value: T) => Promise<boolean | void>): SavedSetting<T> => {
        const saved = createSavedValue(stored, write, { queue: run });
        return {
            value: saved.value,
            saving: saved.saving,
            set: (next) => {
                report.changed?.(key);
                saved.set(next).catch((err: unknown) => report.failed(err, key, next));
            },
        };
    };

    return { setting, run, saving: () => queued() > 0 };
}
