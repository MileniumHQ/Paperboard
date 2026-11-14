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
