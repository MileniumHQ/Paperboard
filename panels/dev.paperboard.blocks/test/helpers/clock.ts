// A clock a test turns by hand. `advance` moves time on and runs each timer
// as its time comes, letting the promises it starts settle; `sleep` moves
// time on without running any, as a computer that slept: its timers come due
// together when it wakes; `setBack` turns the wall clock back while the timers
// go on counting, as an NTP fix of a clock that ran ahead.
import type { Clock } from "../../src/lib/scheduler";

/** Lets every promise that is ready run, and the ones they start. */
export async function settle(): Promise<void> {
    for (let i = 0; i < 50; i++) await new Promise((resolve) => setImmediate(resolve));
}

export function testClock(start: Date | number) {
    let now = typeof start === "number" ? start : start.getTime();
    let nextId = 1;
    const timers = new Map<number, { at: number; run: () => void }>();
    const clock: Clock = {
        now: () => now,
        setTimeout: (run, ms) => {
            const id = nextId++;
            timers.set(id, { at: now + ms, run });
            return id;
        },
        clearTimeout: (timer) => void timers.delete(timer as number),
    };
    return {
        clock,
        now: () => now,
        /** Moves time on by `ms`, running each timer when its time comes. */
        async advance(ms: number): Promise<void> {
            const end = now + ms;
            for (;;) {
                const [id, timer] = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0] ?? [];
                if (id === undefined || !timer) break;
                timers.delete(id);
                now = Math.max(now, timer.at);
                timer.run();
                await settle();
            }
            now = end;
            await settle();
        },
        /** Moves time to `at`, running each timer when its time comes. */
        async to(at: Date): Promise<void> {
            await this.advance(at.getTime() - now);
        },
        /** Moves time on by `ms` without running a timer: the computer slept. */
        sleep(ms: number): void {
            now += ms;
        },
        /** Turns the wall clock back by `ms`; a timer still fires as long after it was set. */
        setBack(ms: number): void {
            now -= ms;
            for (const timer of timers.values()) timer.at -= ms;
        },
        pending: () => timers.size,
    };
}
