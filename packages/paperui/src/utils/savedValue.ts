import { batch, createEffect, createMemo, createSignal, on, untrack, type Accessor } from "solid-js";
import { sameData } from "./keepUnchanged";

/** Runs a task after the ones before it, however they ended. PaperAPI's `new SerialQueue().run` is one. */
export type SaveQueue = <R>(task: () => Promise<R>) => Promise<R>;

export interface SavedValueOptions {
    /**
     * The line the saves wait in (default one of this value's own). Pass one
     * queue to every setting of a view, and the work that must not run between
     * their saves, to keep all of them in order.
     */
    queue?: SaveQueue;
}

export interface SavedValue<T> {
    /** what the control shows: the change being saved, else what is saved */
    value: Accessor<T>;
    /**
     * Shows `next` at once and saves it after the saves made before it.
     * Resolves once its save is done, called off, or replaced by a newer
     * change before its turn. Rejects with the save's own failure, after the
     * control is back on what is saved: catch it to show the error beside
     * the control, or return it to PaperToggle's onChange and the uncaught
     * error toast shows it.
     */
    set: (next: T) => Promise<void>;
    /** a change of this value is saving or waiting to */
    saving: Accessor<boolean>;
}

type Outcome = "saved" | "called-off" | "replaced";

/**
 * The one way a control saves. A change shows at once; saves run one at a
 * time in the order they were made, so an older one never lands over a newer
 * one, and a change a newer one replaced before its turn is not written at
 * all. When the newest save fails (or `save` resolves `false`, the person
 * called it off), the control goes back to what is saved. The control is
 * never disabled for its own save.
 *
 * `stored` is what is saved, as last read or pushed. A save that landed shows
 * its value until `stored` catches up; `stored` changing while nothing is
 * saving is the truth, and shows. Equal pushes (by sameData) are no change.
 * Call it in a component, which owns it.
 */
export function createSavedValue<T>(stored: Accessor<T>, save: (value: T) => Promise<boolean | void>, options: SavedValueOptions = {}): SavedValue<T> {
    const queue = options.queue ?? ownQueue();
    // a push that leaves the value as it was is no news for it
    const known = createMemo(stored, undefined, { equals: sameData });
    const [draft, setDraft] = createSignal<{ value: T } | null>(null);
    const [saving, setSaving] = createSignal(false);
    let newest = 0;
    let pending = 0;
    // the newest change that saved and that `stored` hasn't moved past since:
    // what the control goes back to when a later save fails
    let landed: { value: T } | null = null;

    createEffect(
        on(
            known,
            () => {
                landed = null;
                if (pending === 0) setDraft(null);
            },
            { defer: true },
        ),
    );

    const settle = (value: T, outcome: Outcome, movedDuring: boolean) =>
        batch(() => {
            // a save whose own answer moved `stored` is told by `stored`
            if (outcome === "saved") landed = movedDuring ? null : { value };
            pending--;
            if (pending > 0) return;
            setSaving(false);
            const now = untrack(known);
            const shown = landed && !sameData(now, landed.value) ? landed : null;
            setDraft(shown);
        });

    const set = (next: T): Promise<void> => {
        const mine = ++newest;
        pending++;
        batch(() => {
            setDraft({ value: next });
            setSaving(true);
        });
        let before: T | undefined;
        return queue(async (): Promise<Outcome> => {
            // a newer change of this value is waiting, and saves in this one's place
            if (mine !== newest) return "replaced";
            before = untrack(known);
            return (await save(next)) === false ? "called-off" : "saved";
        }).then(
            (outcome) => settle(next, outcome, outcome === "saved" && !sameData(untrack(known), before)),
            (err: unknown) => {
                settle(next, "called-off", false);
                throw err;
            },
        );
    };

    return {
        value: () => {
            const shown = draft();
            return shown ? shown.value : known();
        },
        set,
        saving,
    };
}

function ownQueue(): SaveQueue {
    // never rejects: it is each save's end, whichever way it went
    let tail: Promise<void> = Promise.resolve();
    return (task) => {
        const result = tail.then(task);
        tail = result.then(
            () => undefined,
            () => undefined,
        );
        return result;
    };
}
