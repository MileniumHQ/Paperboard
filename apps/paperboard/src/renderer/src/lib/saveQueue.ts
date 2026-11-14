import { createSignal, type Accessor } from "solid-js";

/**
 * Saves that must land in the order they were made: each one starts only
 * when the one before it has finished, so an older save can never overwrite
 * a newer one. A save is told whether a newer one is waiting behind it,
 * which carries its change on, so a failure can tell "kept by the next
 * save" from "lost".
 *
 * A save that fails rejects its own promise, for whoever made it to show;
 * the saves behind it still run.
 */
export function createSaveQueue(): (save: (superseded: () => boolean) => Promise<void>) => Promise<void> {
    let tail: Promise<void> = Promise.resolve();
    let queued = 0;
    return (save) => {
        queued++;
        const run = tail.then(() => save(() => queued > 1)).finally(() => {
            queued--;
        });
        // the next save waits for this one to finish, whichever way it went
        tail = new Promise<void>((resolve) => {
            run.then(resolve, resolve);
        });
        return run;
    };
}

export interface SavedValue<T> {
    /** what the control shows */
    value: Accessor<T>;
    /** shows `next` at once and saves it after the saves before it; rejects with why it wasn't kept */
    change: (next: T) => Promise<void>;
    /** a value read from where it is saved; a change still saving is newer, and stays */
    loaded: (value: T) => void;
}

/**
 * A control's value, saved the one way a control saves: a change shows at
 * once, the saves run in order, and a save that fails with no newer one
 * behind it puts back the value last saved and rejects, for the control to
 * show why. A control is never disabled for its own save.
 */
export function createSavedValue<T>(initial: T, save: (value: T) => Promise<void>): SavedValue<T> {
    const [value, setValue] = createSignal<T>(initial);
    const queue = createSaveQueue();
    let saved = initial;
    let saving = 0;
    return {
        value,
        change: (next) => {
            setValue(() => next);
            saving++;
            return queue(async (superseded) => {
                try {
                    await save(next);
                    saved = next;
                } catch (err) {
                    // a newer change behind this one carries on from what shows
                    if (!superseded()) setValue(() => saved);
                    throw err;
                }
            }).finally(() => {
                saving--;
            });
        },
        loaded: (read) => {
            saved = read;
            if (saving === 0) setValue(() => read);
        },
    };
}
