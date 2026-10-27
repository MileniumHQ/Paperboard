// Phones buzz under the finger: a switch flipping, a held item lifting, a
// page let go. Components ask for a named kind, never a raw pattern, so every
// buzz is short and one table says what each one feels like. A native shell
// (an iOS app) maps the same names onto its own feedback generators.
//
// Browsers refuse navigator.vibrate inside a cross-origin frame, and every
// panel is one. So a framed document only reports the kind on window
// (HAPTIC_EVENT); PaperAPI forwards it to the shell, which plays it with
// playHaptic.

/** dispatched on window when a framed document asks for a haptic */
export const HAPTIC_EVENT = "paperui:haptic";

/** vibration patterns in ms: on, off, on… */
const PATTERNS = {
    /** a value stepped: a selector moved, a slider crossed a detent */
    selection: [5],
    light: [10],
    medium: [18],
    heavy: [30],
    success: [12, 70, 20],
    warning: [25, 90, 25],
    error: [35, 60, 35, 60, 35],
    /** paper pressed into its shadow, then springing back */
    paper: [12, 45, 5],
    /** a danger-colored paper: a heavier press with an echo */
    thud: [24, 35, 10],
    /** something held lifts off the page */
    lift: [8, 30, 16],
    /** something carried is set down */
    land: [16, 40, 6],
} as const satisfies Record<string, readonly number[]>;

export type HapticKind = keyof typeof PATTERNS;

export interface HapticDetail {
    kind: HapticKind;
}

export function isHapticKind(value: unknown): value is HapticKind {
    return typeof value === "string" && Object.prototype.hasOwnProperty.call(PATTERNS, value);
}

/** plays a kind with a native host's own feedback; returns whether it played */
export type HapticPlayer = (kind: HapticKind) => boolean;

let player: HapticPlayer | null = null;

/**
 * A native shell (an iOS app has no navigator.vibrate) plays every kind
 * through its own feedback generators instead. Pass null to vibrate again.
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
    return navigator.vibrate(PATTERNS[kind] as unknown as number[]);
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
