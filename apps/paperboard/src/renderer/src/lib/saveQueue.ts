import { SerialQueue } from "@mileniumhq/paperapi";

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
    const line = new SerialQueue();
    let queued = 0;
    return (save) => {
        queued++;
        return line.run(() => save(() => queued > 1)).finally(() => {
            queued--;
        });
    };
}
