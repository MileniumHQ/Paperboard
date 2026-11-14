/** how long a blink takes, shut and open again */
export const BLINK_MS = 170;

/**
 * How far into a blink a frame is, in ms, or null when the face isn't blinking. `blinkAt` is read from
 * performance.now() when the blink is asked for, but a frame's own timestamp is when that frame began,
 * which can be a few ms earlier: so a frame is never counted as before the blink it was woken for.
 */
export function blinkSince(now: number, blinkAt: number): number | null {
    const since = Math.max(0, now - blinkAt);
    return since < BLINK_MS ? since : null;
}

/** The seconds a frame advances the springs by: never backwards (a frame's timestamp can precede the clock read when the loop woke) and never more than a hiccup's worth. */
export const frameSeconds = (now: number, last: number) => Math.max(0, Math.min(0.05, (now - last) / 1000));
