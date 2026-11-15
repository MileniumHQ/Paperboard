/**
 * Tasks that run one at a time, in the order they were queued: each starts
 * once the one before it has settled, whichever way it ended, and each
 * caller gets its own task's outcome. A task that fails rejects only its own
 * promise; the ones behind it still run.
 */
export class SerialQueue {
    // never rejects: it is each task's end, whichever way it went
    private tail: Promise<void> = Promise.resolve();

    /** Queues `task` and resolves or rejects as it does. A bound function, so it can be passed on. */
    readonly run = <T>(task: () => T | Promise<T>): Promise<T> => {
        const result = this.tail.then(() => task());
        // the caller has the failure; the queue only waits for it
        this.tail = result.then(
            () => undefined,
            () => undefined,
        );
        return result;
    };

    /** Resolves once every task queued so far has settled. */
    async settled(): Promise<void> {
        await this.tail;
    }
}
