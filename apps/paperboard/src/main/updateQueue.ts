// The update queue (electron-free, so its rules are tested without a
// window): jobs run one at a time and report their progress into the items
// the top bar lists. A job whose target is in use ends held, and its hold
// waits until someone chooses Stop and update or the user stops it.
import {
    initialUpdateQueueState,
    pendingUpdates,
    type UpdateHold,
    type UpdateItem,
    type UpdateQueueState,
    type UpdateStage,
} from "../shared/updateQueue";

export type UpdateItemIdentity = Pick<UpdateItem, "key" | "kind" | "computerId" | "computerName" | "panelId" | "name" | "version">;

export interface UpdateProgress {
    stage?: UpdateStage;
    percent?: number | null;
    bytesLoaded?: number | null;
    bytesTotal?: number | null;
}

export interface UpdateJob {
    // one job can carry several items (Stop and update for everything one
    // panel holds back): they run together and finish together
    items: UpdateItemIdentity[];
    /**
     * Resolves with a hold when what the update replaces is in use. report
     * names the item it is about; with no key it is the job's first.
     */
    run(report: (progress: UpdateProgress, key?: string) => void): Promise<UpdateHold | void>;
}

/** Some of a job's items failed and the others finished: why, by item key. */
export class PartialUpdateError extends Error {
    constructor(readonly failures: Record<string, string>) {
        super(Object.values(failures).join("; "));
    }
}

export type HoldSource = "panels" | "packages";

export class UpdateQueue {
    private state: UpdateQueueState = { ...initialUpdateQueueState };
    private readonly jobs: UpdateJob[] = [];
    // who waits for each listed job to finish, by item key
    private readonly settles = new Map<string, Array<(item: UpdateItem) => void>>();
    private working = false;
    private readonly holds: Record<HoldSource, UpdateHold[]> = { panels: [], packages: [] };
    private idleWaiters: Array<() => void> = [];
    private readonly reported = new Set<string>();

    constructor(private readonly publish: (state: UpdateQueueState) => void) {}

    snapshot(): UpdateQueueState {
        return this.state;
    }

    setChecking(checking: boolean, checkError: string | null = null): void {
        this.commit({ checking, checkError: checking ? null : checkError });
    }

    /**
     * Adds a job to the list; resolves with its items once it has run. A job
     * whose items are all already waiting or running is the same job.
     */
    enqueue(job: UpdateJob): Promise<UpdateItem[]> {
        if (job.items.length === 0) throw new Error("An update job needs an item");
        const settled = Promise.all(job.items.map((identity) => new Promise<UpdateItem>((resolve) =>
            this.settles.set(identity.key, [...(this.settles.get(identity.key) ?? []), resolve]))));
        const active = (key: string) => {
            const existing = this.state.items.find((item) => item.key === key);
            return existing?.status === "queued" || existing?.status === "running";
        };
        if (job.items.every((identity) => active(identity.key))) return settled;
        if (job.items.some((identity) => active(identity.key))) {
            throw new Error("Part of that update is already in the list");
        }
        this.startBatchIfIdle();
        const keys = new Set(job.items.map((identity) => identity.key));
        const items = job.items.map((identity): UpdateItem => ({
            ...identity,
            status: "queued",
            stage: null,
            percent: null,
            bytesLoaded: null,
            bytesTotal: null,
            error: null,
        }));
        this.commit({ items: [...this.state.items.filter((i) => !keys.has(i.key)), ...items] });
        // the holds it answers are no longer waiting: they are in the list now
        for (const key of keys) this.dropHold(key);
        this.jobs.push(job);
        void this.work();
        return settled;
    }

    /** An item the queue does not run itself (Paperboard's own download). */
    upsertItem(item: UpdateItem): void {
        const active = item.status === "queued" || item.status === "running";
        const current = this.state.items.find((i) => i.key === item.key);
        if (!current && !active) {
            // a finished item that was never listed has nothing to show
            return;
        }
        if (active && !current) this.startBatchIfIdle();
        this.commit({ items: current
            ? this.state.items.map((i) => (i.key === item.key ? item : i))
            : [...this.state.items, item] });
    }

    /**
     * A failure found outside the queue's own jobs (a staged package whose
     * install failed): listed once, so it is shown once.
     */
    report(item: UpdateItem): void {
        const signature = `${item.key}\u0000${item.version}\u0000${item.error ?? ""}`;
        if (this.reported.has(signature)) return;
        this.reported.add(signature);
        this.startBatchIfIdle();
        this.commit({ items: [...this.state.items.filter((i) => i.key !== item.key), item] });
    }

    setHolds(source: HoldSource, holds: UpdateHold[]): void {
        // a hold whose update is in the list is not waiting
        const listed = new Set(pendingUpdates(this.state).map((item) => item.key));
        this.holds[source] = holds.filter((hold) => !listed.has(hold.key));
        this.commit({ holds: [...this.holds.panels, ...this.holds.packages] });
    }

    hold(key: string): UpdateHold | undefined {
        return this.state.holds.find((h) => h.key === key);
    }

    /** resolves once every job in the list has run */
    idle(): Promise<void> {
        if (!this.working && this.jobs.length === 0) return Promise.resolve();
        return new Promise((resolve) => this.idleWaiters.push(resolve));
    }

    private dropHold(key: string): void {
        for (const source of ["panels", "packages"] as const) {
            this.holds[source] = this.holds[source].filter((h) => h.key !== key);
        }
        this.commit({ holds: [...this.holds.panels, ...this.holds.packages] });
    }

    // a new batch starts when nothing is left to do: what finished before
    // leaves the list, so the count and progress describe this batch
    private startBatchIfIdle(): void {
        if (pendingUpdates(this.state).length > 0) return;
        this.commit({ items: [] });
    }

    private async work(): Promise<void> {
        if (this.working) return;
        this.working = true;
        try {
            for (let job = this.jobs.shift(); job; job = this.jobs.shift()) {
                const keys = job.items.map((identity) => identity.key);
                for (const key of keys) this.patch(key, { status: "running" });
                const finished = new Map<string, Partial<UpdateItem>>();
                const done: Partial<UpdateItem> = { status: "done", stage: null, percent: 100 };
                try {
                    const held = await job.run((progress, key = keys[0]) => {
                        if (!keys.includes(key)) throw new Error(`${key} is not part of this update`);
                        this.patch(key, clean(progress));
                    });
                    for (const key of keys) finished.set(key, done);
                    if (held) {
                        finished.set(held.key, { status: "held", stage: null });
                        const source: HoldSource = held.kind === "package" ? "packages" : "panels";
                        this.holds[source] = [...this.holds[source].filter((h) => h.key !== held.key), held];
                        this.commit({ holds: [...this.holds.panels, ...this.holds.packages] });
                    }
                } catch (err) {
                    for (const key of keys) {
                        const why = err instanceof PartialUpdateError ? err.failures[key] : err instanceof Error ? err.message : String(err);
                        finished.set(key, why === undefined ? done : { status: "failed", stage: null, error: why });
                    }
                }
                for (const key of keys) {
                    this.patch(key, finished.get(key)!);
                    const item = this.state.items.find((i) => i.key === key)!;
                    const waiting = this.settles.get(key) ?? [];
                    this.settles.delete(key);
                    for (const resolve of waiting) resolve(item);
                }
            }
        } finally {
            this.working = false;
            const waiters = this.idleWaiters;
            this.idleWaiters = [];
            for (const resolve of waiters) resolve();
        }
    }

    private patch(key: string, change: Partial<UpdateItem>): void {
        this.commit({ items: this.state.items.map((item) => (item.key === key ? { ...item, ...change } : item)) });
    }

    private commit(change: Partial<UpdateQueueState>): void {
        this.state = { ...this.state, ...change, revision: this.state.revision + 1 };
        this.publish(this.state);
    }
}

function clean(progress: UpdateProgress): Partial<UpdateItem> {
    const out: Partial<UpdateItem> = {};
    if (progress.stage !== undefined) out.stage = progress.stage;
    if (progress.percent !== undefined) {
        out.percent = progress.percent === null ? null : Math.max(0, Math.min(100, Math.round(progress.percent)));
    }
    if (progress.bytesLoaded !== undefined) out.bytesLoaded = progress.bytesLoaded;
    if (progress.bytesTotal !== undefined) out.bytesTotal = progress.bytesTotal;
    return out;
}
