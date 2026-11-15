import { sameData } from "@mileniumhq/paperui";
import { batch, createEffect, createMemo, createSignal, on, untrack, type Accessor } from "solid-js";

/** One setting a tab saves: what its control shows, and how it changes. */
export interface SavedSetting<T> {
    /** the change being saved, or else what is stored */
    value: Accessor<T>;
    /** shows `next` at once and saves it after the saves made before it */
    set(next: T): void;
    /** a change of this setting is saving or waiting to */
    saving: Accessor<boolean>;
}

/** A tab's saves: its settings, and other work that must not run between them. */
export interface Saves {
    /**
     * A setting whose control flips the moment it is changed. `stored` is
     * what is saved, as the tab last read it; `write` saves a value and may
     * update what `stored` reads, or resolve `false` when the user called
     * the change off (a location picker closed), which shows `stored` again.
     * Made inside the control's component, which owns it.
     */
    setting<T>(key: string, stored: Accessor<T>, write: (value: T) => Promise<boolean | void>): SavedSetting<T>;
    /** runs `work` in turn with the saves, so it never overlaps one */
    run<T>(work: () => Promise<T>): Promise<T>;
    /** anything of this tab's is saving or waiting to */
    saving: Accessor<boolean>;
}

/**
 * The one way a tab saves its settings. A change shows at once, over what is
 * stored. Saves run one at a time in the order they were made, so a change
 * made while another saves cannot be lost to it; a change that a newer one
 * of the same setting replaced before its turn is not written at all. A
 * failed save is handed to `failed` for the tab's own error quote (which
 * `changed` clears as the next change is made), and once
 * nothing newer of that setting is waiting, the control falls back to what is
 * stored. A save that landed shows its value until what is stored catches up:
 * when the save's own answer updates it, or a later read or push does.
 */
export function createSaves(report: {
    /** saving `value` failed: the tab quotes `err` */
    failed(err: unknown, key: string, value: unknown): void;
    /** a change was made: the tab clears what the last failure left on screen */
    changed?(key: string): void;
}): Saves {
    let tail: Promise<unknown> = Promise.resolve();
    const [queued, setQueued] = createSignal(0);

    const run = <T>(work: () => Promise<T>): Promise<T> => {
        setQueued((n) => n + 1);
        const result = tail.then(work);
        // the next waits for this one to finish, whichever way it went
        tail = result.then(
            () => undefined,
            () => undefined,
        );
        return result.finally(() => setQueued((n) => n - 1));
    };

    const setting = <T>(key: string, stored: Accessor<T>, write: (value: T) => Promise<boolean | void>): SavedSetting<T> => {
        // a push that leaves this setting as it was is no news for it
        const known = createMemo(stored, undefined, { equals: sameData });
        const [draft, setDraft] = createSignal<{ value: T } | null>(null);
        const [saving, setSaving] = createSignal(false);
        let newest = 0;
        let pending = 0;
        // what was stored when the changes now saving began
        let before: T | undefined;

        // what is stored now is the truth, once none of this setting's saves is running
        createEffect(
            on(
                known,
                () => {
                    if (pending === 0) setDraft(null);
                },
                { defer: true },
            ),
        );

        const settle = (value: T, saved: boolean) =>
            batch(() => {
                pending--;
                if (pending > 0) return;
                setSaving(false);
                const now = untrack(known);
                // failed or called off, it shows what is stored; landed, it
                // waits for what is stored to change, unless it already has
                if (!saved || sameData(now, value) || !sameData(now, before)) setDraft(null);
            });

        const set = (next: T) => {
            if (pending === 0) before = untrack(known);
            report.changed?.(key);
            const mine = ++newest;
            pending++;
            batch(() => {
                setDraft({ value: next });
                setSaving(true);
            });
            run(async () => {
                // a newer change of this setting is waiting, and saves it in this one's place
                if (mine !== newest) return true;
                return (await write(next)) !== false;
            }).then(
                (saved) => settle(next, saved),
                (err) => {
                    report.failed(err, key, next);
                    settle(next, false);
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
    };

    return { setting, run, saving: () => queued() > 0 };
}
