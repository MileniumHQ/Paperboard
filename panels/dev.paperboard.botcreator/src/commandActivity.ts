// Slash commands run over the last 24 hours, in hourly buckets, for the
// Command activity widget. Fixed memory: one count per hour, 24 hours,
// whatever the traffic. Kept in the service's memory only, so it survives
// bot reconnects but not a service restart; `since` says when recording
// began, so a reader never mistakes a fresh start for a quiet day.

export const ACTIVITY_BUCKET_MS = 60 * 60 * 1000;
export const ACTIVITY_BUCKETS = 24;

export interface CommandActivity {
    /** counts per hour, oldest first; the last bucket is the current hour */
    counts: number[];
    /** start of the last (current) bucket, epoch ms */
    currentBucketStart: number;
    bucketMs: number;
    /** when recording began, epoch ms: buckets before it were not observed */
    since: number;
    total: number;
}

export class CommandActivityRecorder {
    // ring of counts indexed by absolute hour % ACTIVITY_BUCKETS; hours[i]
    // says which absolute hour slot i currently holds, so a stale slot reads 0
    private readonly counts = new Array<number>(ACTIVITY_BUCKETS).fill(0);
    private readonly hours = new Array<number>(ACTIVITY_BUCKETS).fill(-1);
    readonly since: number;

    constructor(now: number = Date.now()) {
        this.since = now;
    }

    record(now: number = Date.now()): void {
        const hour = Math.floor(now / ACTIVITY_BUCKET_MS);
        const slot = hour % ACTIVITY_BUCKETS;
        if (this.hours[slot] !== hour) {
            this.hours[slot] = hour;
            this.counts[slot] = 0;
        }
        this.counts[slot]++;
    }

    snapshot(now: number = Date.now()): CommandActivity {
        const current = Math.floor(now / ACTIVITY_BUCKET_MS);
        const counts: number[] = [];
        for (let hour = current - ACTIVITY_BUCKETS + 1; hour <= current; hour++) {
            const slot = hour % ACTIVITY_BUCKETS;
            counts.push(this.hours[slot] === hour ? this.counts[slot] : 0);
        }
        return {
            counts,
            currentBucketStart: current * ACTIVITY_BUCKET_MS,
            bucketMs: ACTIVITY_BUCKET_MS,
            since: this.since,
            total: counts.reduce((sum, n) => sum + n, 0),
        };
    }
}
