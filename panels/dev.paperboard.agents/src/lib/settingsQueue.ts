// The settings are saved whole, and the service replaces what it has, so two
// saves built from the same old copy would revert each other. Every change
// goes through one queue: each waits for the one before, reads the settings
// as they then stand, and says what to write (or that there's nothing to).

import type { Settings } from "../contract";

export interface SettingsQueueOptions {
    /** the settings as they stand now; null until they're loaded */
    current(): Settings | null;
    /** write the whole settings */
    write(settings: Settings): Promise<unknown>;
    /** bring `current` up to what was just written */
    refresh(): Promise<unknown>;
}

/** What to write, built from the latest settings; null when nothing needs to change. */
export type SettingsChange = (current: Settings) => Settings | null;

export function createSettingsQueue(options: SettingsQueueOptions) {
    let last: Promise<void> = Promise.resolve();
    return (change: SettingsChange): Promise<void> => {
        const step = async () => {
            const current = options.current();
            if (!current) throw new Error("The settings aren't loaded yet.");
            const next = change(current);
            if (!next) return;
            await options.write(next);
            try {
                await options.refresh();
            } catch (e) {
                throw new Error(`The settings were saved, but couldn't be read back: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
            }
        };
        // a failed save is the caller's to show; the next one in line still runs
        const run = last.then(step, step);
        last = run;
        return run;
    };
}
