/**
 * A line of tasks that run one at a time: each starts once the one before it
 * has settled, whichever way, and each caller gets its own task's outcome.
 */
export function inOrder() {
    let tail: Promise<unknown> = Promise.resolve();
    return <T>(task: () => Promise<T>): Promise<T> => {
        const run = tail.then(task, task);
        // the caller has the failure; the line only waits for it
        tail = run.catch(() => undefined);
        return run;
    };
}
