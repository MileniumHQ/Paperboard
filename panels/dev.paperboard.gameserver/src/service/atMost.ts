/**
 * Tasks that run at most `limit` at a time: one past the limit starts as
 * soon as a running one settles, and each caller gets its own task's outcome.
 */
export function atMost(limit: number) {
    let running = 0;
    const waiting: (() => void)[] = [];
    return async <T>(task: () => Promise<T>): Promise<T> => {
        if (running >= limit) await new Promise<void>((start) => waiting.push(start));
        else running++;
        try {
            return await task();
        } finally {
            // the slot passes straight to the next in line, or is given back
            const next = waiting.shift();
            if (next) next();
            else running--;
        }
    };
}
