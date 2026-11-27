// Writes made one at a time, which a backup can hold back: `pause` resolves
// once every write queued before it is done, and holds the later ones until
// `resume`, so the files can be copied or swapped meanwhile. The projects,
// the Data and the schedules each write through one.
import { SerialQueue } from "@mileniumhq/paperapi";

export class HeldQueue {
    private readonly queue = new SerialQueue();
    // while paused, one task holds the queue: nothing is written until letGo
    private held: Promise<void> | null = null;
    private letGo: (() => void) | null = null;

    /** Queues `task` behind every write before it; it resolves or rejects as the task does. */
    readonly run = <T>(task: () => T | Promise<T>): Promise<T> => this.queue.run(task);

    get paused(): boolean {
        return this.held !== null;
    }

    pause(): Promise<void> {
        if (this.held) throw new Error("The writes are already paused");
        return new Promise<void>((paused) => {
            this.held = this.queue.run(
                () =>
                    new Promise<void>((go) => {
                        this.letGo = go;
                        paused();
                    }),
            );
        });
    }

    /**
     * Lets the held writes run. `first` runs before them, while they are still
     * held; when it fails it is thrown and the queue stays paused, so a later
     * `resume` goes on once the files are as they were.
     */
    async resume(first?: () => Promise<void>): Promise<void> {
        const held = this.held;
        const go = this.letGo;
        if (!held || !go) throw new Error("The writes are not paused");
        if (first) await first();
        this.held = null;
        this.letGo = null;
        go();
        await held;
    }
}
