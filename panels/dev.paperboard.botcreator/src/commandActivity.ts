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

/** How often one slash command was used, and when it last was. */
export interface CommandUses {
    count: number;
    /** epoch ms */
    last: number;
}

/**
 * Each slash command's uses, by its scope and name, so a recreated command
 * keeps counting. In the service's memory only, like the hourly activity:
 * the counts start when Bot Creator does.
 */
export class CommandUseCounter {
    private readonly uses = new Map<string, CommandUses>();
    readonly since: number;

    constructor(now: number = Date.now()) {
        this.since = now;
    }

    record(command: { scope: string; name: string }, now: number = Date.now()): void {
        const key = `${command.scope}:${command.name}`;
        const known = this.uses.get(key);
        this.uses.set(key, { count: (known?.count ?? 0) + 1, last: now });
    }

    get(command: { scope: string; name: string }): CommandUses | undefined {
        const known = this.uses.get(`${command.scope}:${command.name}`);
        return known ? { ...known } : undefined;
    }
}
