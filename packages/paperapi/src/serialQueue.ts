/**
 * Tasks that run one at a time, in the order they were queued: each starts
 * once the one before it has settled, whichever way it ended, and each
 * caller gets its own task's outcome. A task that fails rejects only its own
 * promise; the ones behind it still run.
 */
export class SerialQueue {
    // never rejects: it is each task's end, whichever way it went
    private tail: Promise<void> = Promise.resolve();
    private queued = 0;

    /** Queues `task` and resolves or rejects as it does. A bound function, so it can be passed on. */
    readonly run = <T>(task: () => T | Promise<T>): Promise<T> => {
        this.queued++;
        const result = this.tail.then(() => {
            this.queued--;
            return task();
        });
        // the caller has the failure; the queue only waits for it
        this.tail = result.then(
            () => undefined,
            () => undefined,
        );
        return result;
    };

    /**
     * How many tasks are queued and not yet started. Read inside a task, more
     * than 0 means a newer one is waiting behind it: a save can tell that a
     * later save carries its change on.
     */
    get waiting(): number {
        return this.queued;
    }

    /** Resolves once every task queued so far has settled. */
    async settled(): Promise<void> {
        await this.tail;
    }
}

/**
 * A SerialQueue per key: tasks with the same key (a file's path, a
 * computer's id) run one at a time in order, tasks with different keys run
 * side by side. A key's line is forgotten once its last task settles, so
 * keys that come and go don't pile up.
 */
export class KeyedQueue {
    private readonly lines = new Map<string, { queue: SerialQueue; tasks: number }>();

    /** Queues `task` behind the others with `key` and resolves or rejects as it does. A bound function. */
    readonly run = <T>(key: string, task: () => T | Promise<T>): Promise<T> => {
        let line = this.lines.get(key);
        if (!line) {
            line = { queue: new SerialQueue(), tasks: 0 };
            this.lines.set(key, line);
        }
        const mine = line;
        mine.tasks++;
        const result = mine.queue.run(task);
        const forget = () => {
            if (--mine.tasks === 0 && this.lines.get(key) === mine) this.lines.delete(key);
        };
        result.then(forget, forget);
        return result;
    };

    /** How many keys have a task queued or running. */
    get size(): number {
        return this.lines.size;
    }
}

/**
 * Tasks that run at most `limit` at a time, in the order they were queued:
 * one past the limit starts as soon as a running one settles, whichever way
 * it ended, and each caller gets its own task's outcome.
 */
export class LimitedQueue {
    private running = 0;
    private readonly waiters: (() => void)[] = [];

    constructor(readonly limit: number) {
        if (!Number.isInteger(limit) || limit < 1) throw new Error(`A LimitedQueue runs at least one task at a time, not ${limit}`);
    }

    /** Queues `task` and resolves or rejects as it does. A bound function, so it can be passed on. */
    readonly run = async <T>(task: () => T | Promise<T>): Promise<T> => {
        if (this.running >= this.limit) await new Promise<void>((start) => this.waiters.push(start));
        else this.running++;
        try {
            return await task();
        } finally {
            // the slot passes straight to the next in line, or is given back
            const next = this.waiters.shift();
            if (next) next();
            else this.running--;
        }
    };

    /** How many tasks are queued and not yet started. */
    get waiting(): number {
        return this.waiters.length;
    }
}
