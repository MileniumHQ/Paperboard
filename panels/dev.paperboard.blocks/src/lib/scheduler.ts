// Starts the schedule hats of the switched-on projects on time, in the
// service, whether or not a window is open.
//
// Each schedule keeps when it last ran (its anchor) in schedules.json, written
// before its flow starts, so a restart never runs it twice. A run missed while
// the service was away, or the computer slept, runs once when it is back (a
// minute after the service starts, so the panels it drives are up too) and the
// schedule goes on from then: never a run for every one it missed. A clock set
// back starts the schedules ahead of it from then, so none waits out the time
// it was set back by. A schedule turned off, edited, or in a project turned off
// or deleted lets go of its anchor; switched on again, it starts from then.
import { errorMessage, isRecord } from "@mileniumhq/paperapi";
import { HeldQueue } from "./heldQueue";
import type { ProjectStorage } from "./projects";
import { isScheduleHat, nextRun, scheduleOf, type Schedule } from "./schedule";
import type { SavedFlows } from "../panel";
import { PANEL_ID } from "../panel";

export const SCHEDULES_FILE = "schedules.json";
export const SCHEDULES_VERSION = 1;
/**
 * The longest the scheduler waits before it looks at the clock again. A
 * timer doesn't count the time a computer sleeps, so one set for hours would
 * run late; the clock is read at least this often.
 */
export const MAX_SLEEP_MS = 30_000;
/** How long after the service starts a run it missed waits. */
export const CATCH_UP_DELAY_MS = 60_000;

/** What the scheduler reads the time and waits with; the tests turn it by hand. */
export interface Clock {
    now(): number;
    setTimeout(run: () => void, ms: number): unknown;
    clearTimeout(timer: unknown): void;
}

export const systemClock: Clock = {
    now: () => Date.now(),
    setTimeout: (run, ms) => setTimeout(run, ms),
    clearTimeout: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
};

interface Armed {
    project: string;
    hat: string;
    schedule: Schedule;
    /** the schedule as text: one edited is a new schedule */
    signature: string;
    /** when it last ran, or was switched on */
    anchor: number;
    /** a run it missed while the service was away waits until then, so the panels it drives are up */
    notBefore?: number;
}

type Anchors = Record<string, Record<string, { signature: string; anchor: number }>>;

export interface SchedulerDeps {
    storage: ProjectStorage;
    clock: Clock;
    /** starts the hat's flow, and resolves once that run ends */
    start(project: string, hat: string): Promise<void>;
    log(project: string, level: "info" | "error", text: string, blockId: string): void;
    /** when each schedule next runs: by project, then by hat */
    announce(next: Record<string, Record<string, number>>): void;
}

const keyOf = (project: string, hat: string) => `${project}\u0000${hat}`;

/** The anchors as stored; nothing stored is none. */
export function readAnchors(saved: unknown): Anchors {
    if (saved === null || saved === undefined) return {};
    if (!isRecord(saved) || !isRecord(saved.schedules)) throw new Error("the file is damaged");
    if (typeof saved.version === "number" && saved.version > SCHEDULES_VERSION) {
        throw new Error(`it was saved by a newer version of Blocks (schedules version ${saved.version})`);
    }
    const out: Anchors = {};
    for (const [project, hats] of Object.entries(saved.schedules)) {
        if (!isRecord(hats)) throw new Error("the file is damaged");
        out[project] = {};
        for (const [hat, kept] of Object.entries(hats)) {
            if (!isRecord(kept) || typeof kept.signature !== "string" || typeof kept.anchor !== "number" || !Number.isFinite(kept.anchor)) throw new Error("the file is damaged");
            out[project][hat] = { signature: kept.signature, anchor: kept.anchor };
        }
    }
    return out;
}

export class Scheduler {
    private armed = new Map<string, Armed>();
    // the anchors read from the file, until the first sync takes them up
    private stored: Anchors = {};
    // why the file couldn't be read, said in each project with a schedule once the projects are known
    private unread: string | null = null;
    private readonly queue = new HeldQueue();
    private writeWaiting: Promise<void> | null = null;
    private timer: unknown = null;
    // the schedules whose last run is still going
    private readonly going = new Set<string>();
    // what each schedule that can't run last said, so an edit elsewhere doesn't say it again
    private refused = new Map<string, string>();
    // when the service read the anchors: a schedule whose next run was before then missed it
    private openedAt = 0;

    constructor(private readonly deps: SchedulerDeps) {}

    /** Reads when each schedule last ran. A file that can't be read is said, and the schedules start from now. */
    async open(): Promise<void> {
        this.openedAt = this.deps.clock.now();
        try {
            this.stored = readAnchors(await this.deps.storage.get(SCHEDULES_FILE));
            this.unread = null;
        } catch (err) {
            this.stored = {};
            this.unread = errorMessage(err);
            console.error(`[${PANEL_ID}] ${SCHEDULES_FILE} couldn't be read, so the schedules start again from now:`, err);
        }
    }

    /** Follows the schedule hats of these projects (the switched-on ones): a new one starts from now. */
    sync(projects: { id: string; flows: SavedFlows }[]): void {
        const now = this.deps.clock.now();
        const wanted = new Map<string, Armed>();
        const refused = new Map<string, string>();
        // whether the file needs writing: a schedule came, went or moved its anchor
        let changed = false;
        for (const { id: project, flows } of projects) {
            for (const hat of flows.workspace.blocks?.blocks ?? []) {
                if (hat.enabled === false || !isScheduleHat(hat.type)) continue;
                const key = keyOf(project, hat.id);
                let schedule: Schedule;
                try {
                    schedule = scheduleOf(hat);
                } catch (err) {
                    const why = errorMessage(err);
                    refused.set(key, why);
                    if (this.refused.get(key) !== why) this.deps.log(project, "error", `This schedule doesn't run: ${why}`, hat.id);
                    continue;
                }
                const signature = JSON.stringify(schedule);
                const armed = this.armed.get(key);
                if (armed && armed.signature === signature) {
                    // the same schedule stays the same one, so a run being noted as this runs still starts
                    wanted.set(key, armed);
                    continue;
                }
                const stored = armed ? undefined : this.stored[project]?.[hat.id];
                const anchor = stored && stored.signature === signature ? Math.min(stored.anchor, now) : now;
                if (anchor !== stored?.anchor) changed = true;
                const next: Armed = { project, hat: hat.id, schedule, signature, anchor };
                // only an anchor read from the file can be from before the service started
                if (nextRun(schedule, anchor) <= this.openedAt) next.notBefore = this.openedAt + CATCH_UP_DELAY_MS;
                wanted.set(key, next);
            }
        }
        if (this.unread) {
            const why = this.unread;
            this.unread = null;
            for (const project of new Set([...wanted.values()].map((a) => a.project))) {
                this.deps.log(project, "error", `When the schedules last ran couldn't be read (${why}), so they start again from now`, [...wanted.values()].find((a) => a.project === project)!.hat);
            }
        }
        if ([...this.armed.keys()].some((key) => !wanted.has(key))) changed = true;
        // anchors read for schedules that are gone are written away
        const leftovers = Object.entries(this.stored).some(([project, hats]) => Object.keys(hats).some((hat) => !wanted.has(keyOf(project, hat))));
        this.armed = wanted;
        if (this.clamp(now)) changed = true;
        this.refused = refused;
        this.stored = {};
        if (changed || leftovers) this.write().catch((err: unknown) => this.writeFailed(err));
        this.reschedule();
    }

    /** Stops looking at the clock; nothing runs until the next sync. */
    stop(): void {
        if (this.timer !== null) this.deps.clock.clearTimeout(this.timer);
        this.timer = null;
    }

    get paused(): boolean {
        return this.queue.paused;
    }

    pause(): Promise<void> {
        return this.queue.pause();
    }

    /**
     * Lets the held write go. After a restore the file is the backup's, with when the schedules
     * ran back then: the anchors kept here are written over it, so a restart doesn't run them again.
     */
    async resume(restored: boolean): Promise<void> {
        await this.queue.resume();
        if (restored) await this.write();
    }

    private nextOf(a: Armed): number {
        return nextRun(a.schedule, a.anchor);
    }

    /** When it runs: its next run, or once the service has been up a minute for one it missed. */
    private whenOf(a: Armed): number {
        return Math.max(this.nextOf(a), a.notBefore ?? -Infinity);
    }

    /**
     * A clock set back leaves no anchor ahead of now, and no run it missed waiting longer than
     * the catch-up delay: otherwise each would wait out the time the clock went back by. Whether
     * an anchor moved, so the file needs writing.
     */
    private clamp(now: number): boolean {
        let moved = false;
        for (const a of this.armed.values()) {
            if (a.anchor > now) {
                a.anchor = now;
                moved = true;
            }
            if (a.notBefore !== undefined && a.notBefore > now + CATCH_UP_DELAY_MS) a.notBefore = now + CATCH_UP_DELAY_MS;
        }
        return moved;
    }

    private reschedule(): void {
        this.stop();
        const next: Record<string, Record<string, number>> = {};
        let soonest = Infinity;
        for (const a of this.armed.values()) {
            const at = this.whenOf(a);
            (next[a.project] ??= {})[a.hat] = at;
            soonest = Math.min(soonest, at);
        }
        this.deps.announce(next);
        if (soonest === Infinity) return;
        const wait = Math.min(Math.max(soonest - this.deps.clock.now(), 0), MAX_SLEEP_MS);
        this.timer = this.deps.clock.setTimeout(() => void this.tick(), wait);
    }

    private async tick(): Promise<void> {
        this.timer = null;
        const now = this.deps.clock.now();
        const moved = this.clamp(now);
        const due = [...this.armed.values()].filter((a) => this.whenOf(a) <= now);
        for (const a of due) {
            const next = this.nextOf(a);
            // on time, the next run is counted from this one's; one missed, from now: it runs once, not once per run missed
            a.anchor = nextRun(a.schedule, next) <= now ? now : next;
            delete a.notBefore;
        }
        this.reschedule();
        if (!due.length) {
            if (moved) this.write().catch((err: unknown) => this.writeFailed(err));
            return;
        }
        // noted before the flows start, so a restart from here on never runs them again
        let unwritten: string | null = null;
        try {
            await this.write();
        } catch (err) {
            unwritten = errorMessage(err);
            console.error(`[${PANEL_ID}] ${SCHEDULES_FILE} couldn't be written:`, err);
        }
        for (const a of due) {
            const key = keyOf(a.project, a.hat);
            // turned off, edited or deleted while the run was being noted
            if (this.armed.get(key) !== a) continue;
            if (unwritten) this.deps.log(a.project, "error", `This run couldn't be noted, so a restart may run it again: ${unwritten}`, a.hat);
            if (this.going.has(key)) {
                this.deps.log(a.project, "info", "A scheduled run was skipped: the last one is still going", a.hat);
                continue;
            }
            this.going.add(key);
            void this.deps.start(a.project, a.hat).finally(() => this.going.delete(key));
        }
    }

    private writeFailed(err: unknown): void {
        console.error(`[${PANEL_ID}] ${SCHEDULES_FILE} couldn't be written:`, err);
        for (const project of new Set([...this.armed.values()].map((a) => a.project))) {
            const hat = [...this.armed.values()].find((a) => a.project === project)!.hat;
            this.deps.log(project, "error", `When the schedules last ran couldn't be saved, so a restart may run one again: ${errorMessage(err)}`, hat);
        }
    }

    /** Writes the anchors as they are when the write starts; a write already waiting carries every change. */
    private write(): Promise<void> {
        if (this.writeWaiting) return this.writeWaiting;
        const write = this.queue.run(async () => {
            this.writeWaiting = null;
            const schedules: Anchors = {};
            for (const a of this.armed.values()) (schedules[a.project] ??= {})[a.hat] = { signature: a.signature, anchor: a.anchor };
            await this.deps.storage.set({ version: SCHEDULES_VERSION, schedules }, SCHEDULES_FILE);
        });
        this.writeWaiting = write;
        return write;
    }
}
