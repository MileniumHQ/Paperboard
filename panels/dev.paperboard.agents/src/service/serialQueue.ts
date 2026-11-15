/**
 * Tasks that run one at a time, in order: each starts once the one before it has settled, whichever way,
 * and each caller gets its own task's outcome.
 */
export class SerialQueue {
    private tail: Promise<unknown> = Promise.resolve();

    run<T>(task: () => Promise<T>): Promise<T> {
        const run = this.tail.then(task, task);
        // the caller has the failure; the queue only waits for it
        this.tail = run.catch(() => undefined);
        return run;
    }

    /** Resolves once every task queued so far has settled. */
    async settled(): Promise<void> {
        await this.tail;
    }
}
