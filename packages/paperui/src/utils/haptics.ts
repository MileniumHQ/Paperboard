// Phones buzz under the finger: a switch flipping, a held item lifting, a
// page let go. Components ask for a named kind, never a raw pattern, so every
// buzz is short and one table says what each one feels like. A native shell
// (an iOS app) plays the same names through its own haptic engine.
//
// Browsers refuse navigator.vibrate inside a cross-origin frame, and every
// panel is one. So a framed document only reports the kind on window
// (HAPTIC_EVENT); PaperAPI forwards it to the shell, which plays it with
// playHaptic.

/** dispatched on window when a framed document asks for a haptic */
export const HAPTIC_EVENT = "paperui:haptic";

/**
 * One moment of a haptic, for an engine that can shape it (Core Haptics on
 * iOS): a tap at `at` ms, or with `hold` a rumble lasting that many ms.
 * `strength` is how hard (0-1); `sharpness` how crisp, from a dull thud (0)
 * to a click (1).
 */
export interface HapticEvent {
    at: number;
    strength: number;
    sharpness: number;
    hold?: number;
}

interface HapticShape {
    /** for a plain vibrator (navigator.vibrate): ms on, off, on… */
    vibrate: readonly number[];
    /** for an engine that shapes taps and rumbles */
    events: readonly HapticEvent[];
}

const tap = (at: number, strength: number, sharpness: number): HapticEvent => ({ at, strength, sharpness });
const rumble = (at: number, hold: number, strength: number, sharpness: number): HapticEvent => ({ at, hold, strength, sharpness });

const SHAPES = {
    /** a value stepped: a selector moved, a slider crossed a detent */
    selection: { vibrate: [5], events: [tap(0, 0.4, 0.8)] },
    light: { vibrate: [10], events: [tap(0, 0.45, 0.5)] },
    medium: { vibrate: [18], events: [tap(0, 0.7, 0.5)] },
    heavy: { vibrate: [30], events: [tap(0, 1, 0.45)] },
    success: { vibrate: [12, 70, 20], events: [tap(0, 0.55, 0.6), tap(90, 0.9, 0.7)] },
    warning: { vibrate: [25, 90, 25], events: [tap(0, 0.85, 0.5), tap(120, 0.85, 0.5)] },
    error: { vibrate: [35, 60, 35, 60, 35], events: [tap(0, 0.9, 0.8), tap(90, 0.9, 0.8), tap(180, 0.9, 0.8)] },
    /** paper pressed into its shadow, then springing back */
    paper: { vibrate: [12, 45, 5], events: [tap(0, 0.6, 0.45), tap(60, 0.25, 0.7)] },
    /** a danger-colored paper: a heavier press with an echo */
    thud: { vibrate: [24, 35, 10], events: [tap(0, 0.95, 0.3), tap(55, 0.35, 0.4)] },
    /** something held lifts off the page */
    lift: { vibrate: [8, 30, 16], events: [tap(0, 0.35, 0.6), tap(40, 0.6, 0.4)] },
    /** something carried is set down */
    land: { vibrate: [16, 40, 6], events: [tap(0, 0.75, 0.35), tap(55, 0.2, 0.6)] },
    /**
     * A switch's knob gathering speed, then hitting the far edge: a faint,
     * building rumble while it travels (PaperToggle's slide), and a thump as
     * it lands.
     */
    toggle: {
        vibrate: [4, 70, 4, 60, 4, 50, 26],
        events: [rumble(0, 100, 0.12, 0.05), rumble(100, 90, 0.2, 0.1), rumble(190, 80, 0.3, 0.15), tap(285, 1, 0.4)],
    },
    /** a loader finished: the check pops, and its ripple runs out (PaperLoader) */
    loaded: {
        vibrate: [22, 110, 10, 90, 6],
        events: [tap(60, 0.85, 0.55), tap(220, 0.45, 0.3), tap(330, 0.28, 0.25), tap(450, 0.16, 0.2), tap(590, 0.08, 0.2)],
    },
    /** a loader failed: two firm knocks */
    failed: { vibrate: [30, 90, 30], events: [tap(0, 0.95, 0.85), tap(150, 0.95, 0.85)] },
    /** a character typed in front of the person: barely there */
    typing: { vibrate: [3], events: [tap(0, 0.28, 0.75)] },
    /** a message sent: a crisp tap as it leaves */
    send: { vibrate: [14, 40, 6], events: [tap(0, 0.75, 0.85), rumble(20, 70, 0.18, 0.3)] },
    /** a message arrived: two soft knocks, the second firmer */
    receive: { vibrate: [10, 90, 18], events: [tap(0, 0.4, 0.35), tap(110, 0.7, 0.45)] },
} as const satisfies Record<string, HapticShape>;

export type HapticKind = keyof typeof SHAPES;

export interface HapticDetail {
    kind: HapticKind;
}

export function isHapticKind(value: unknown): value is HapticKind {
    return typeof value === "string" && Object.prototype.hasOwnProperty.call(SHAPES, value);
}

/** what `kind` feels like, for a native host's haptic engine */
export function hapticEvents(kind: HapticKind): readonly HapticEvent[] {
    return SHAPES[kind].events;
}

/** plays a kind with a native host's own feedback; returns whether it played */
export type HapticPlayer = (kind: HapticKind) => boolean;

let player: HapticPlayer | null = null;

/**
 * A native shell (an iOS app has no navigator.vibrate) plays every kind
 * through its own haptic engine instead, shaping it from hapticEvents.
 * Pass null to vibrate again.
 */
export function setHapticPlayer(next: HapticPlayer | null): void {
    player = next;
}

/**
 * Plays `kind` on this document's device: through the native host's player
 * when one is set, else its vibrator, if it has one. The shell
 * calls it for kinds its panel frames forward; anything not in the table is
 * ignored. Returns whether a vibration was started.
 */
export function playHaptic(kind: unknown): boolean {
    if (!isHapticKind(kind)) return false;
    if (player) return player(kind);
    if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return false;
    // a new pattern replaces one still playing; nothing queues
    return navigator.vibrate(SHAPES[kind].vibrate as unknown as number[]);
}

/** Asks for a haptic: played here at the top, reported to the shell from a frame. */
export function haptic(kind: HapticKind): void {
    if (typeof window === "undefined") return;
    if (window.parent !== window) {
        window.dispatchEvent(new CustomEvent<HapticDetail>(HAPTIC_EVENT, { detail: { kind } }));
        return;
    }
    playHaptic(kind);
}
