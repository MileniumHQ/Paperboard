// Bounded concurrency for widget frame loads. Twenty-five frames booting at
// once stalls the shell's own frames; four at a time measured smooth and
// finished sooner. A waiter that gives up (its tile scrolled away or was
// removed) leaves the queue without ever holding a slot.

export interface LoadSlot {
    /** Resolves when the slot is granted; never resolves once cancelled. */
    granted: Promise<void>;
    /** Gives the slot back, or leaves the queue if it was never granted. Idempotent. */
    release: () => void;
}

export interface LoadQueue {
    acquire: () => LoadSlot;
    readonly active: number;
    readonly waiting: number;
}

export function createLoadQueue(limit: number): LoadQueue {
    let active = 0;
    const waiting: (() => void)[] = [];

    const pump = () => {
        while (active < limit && waiting.length > 0) {
            active += 1;
            waiting.shift()!();
        }
    };

    return {
        acquire() {
            let state: "waiting" | "granted" | "released" = "waiting";
            let grant!: () => void;
            const granted = new Promise<void>((resolve) => {
                grant = () => {
                    state = "granted";
                    resolve();
                };
            });
            waiting.push(grant);
            pump();
            return {
                granted,
                release() {
                    if (state === "granted") {
                        active -= 1;
                        pump();
                    } else if (state === "waiting") {
                        const index = waiting.indexOf(grant);
                        if (index >= 0) waiting.splice(index, 1);
                    }
                    state = "released";
                },
            };
        },
        get active() {
            return active;
        },
        get waiting() {
            return waiting.length;
        },
    };
}
